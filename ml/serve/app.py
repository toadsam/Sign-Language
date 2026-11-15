"""Run from ml/: python -m uvicorn serve.app:create_app --factory --workers 1."""
import logging
import threading
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Protocol

from fastapi import FastAPI, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from . import recognize as reading
from . import sentence
from .models import GenerateRequest, MotionResponse, TranslateRequest, TranslateResponse
from .serialization import InvalidMotion, serialize
from .settings import Settings
from .verify import verify_html

logger = logging.getLogger(__name__)


class Generator(Protocol):
    def generate(self, gloss: list[str], nonmanual: list[str] = (), seed: int | None = None) -> dict: ...


class Translator(Protocol):
    def translate(self, text: str) -> dict: ...


class Recognizer(Protocol):
    def score(self, motion, active=None) -> dict: ...


def load_word_generator(settings: Settings) -> Generator:
    if not settings.run_dir:
        raise ValueError("Generator configuration required")
    # B is imported only for deployment, never for injected C1 tests.
    from gen.infer import Generator as DeployedGenerator
    return DeployedGenerator(settings.run_dir, device=settings.device)


def load_generator(settings: Settings) -> Generator:
    if settings.mode == "word":
        return load_word_generator(settings)
    if not settings.gloss_table:
        raise ValueError("sentence mode requires a gloss table")
    table = sentence.load_gloss_table(settings.gloss_table)
    kind = settings.sentence_generator
    if kind == "synthetic":
        inner = sentence.SyntheticSentenceGenerator()
    elif kind == "word":
        inner = sentence.WordConcatSentenceGenerator(load_word_generator(settings), table)
    else:  # 실제 문장 생성기: "module:load_sentence_generator"
        inner = sentence.load_object(kind, settings.sentence_run_dir, device=settings.device)
    return sentence.GlossSentenceAdapter(inner, table, signer=settings.sentence_signer)


def load_translator(settings: Settings) -> Translator | None:
    if settings.translator == "stub":
        if not settings.gloss_table:
            return None  # 번역기를 설정하지 않은 배포: /translate는 503
        return sentence.StubTranslator(sentence.load_gloss_table(settings.gloss_table))
    return sentence.load_object(settings.translator, settings.translator_path)


def load_recognizer(settings: Settings) -> Recognizer | None:
    if not settings.recog_run_dir:
        return None  # 읽는 모델을 설정하지 않은 배포: /recognize 는 503
    # 승현의 읽는 모델(계약 ④)을 그대로 쓴다. 배포할 때만 불러온다.
    from recog.infer import Recognizer as DeployedRecognizer
    return DeployedRecognizer(settings.recog_run_dir, device=settings.device)


def create_app(settings: Settings | None = None,
               generator_factory: Callable[[], Generator] | None = None,
               translator_factory: Callable[[], Translator] | None = None,
               recognizer_factory: Callable[[], Recognizer | None] | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    inference_lock = threading.Lock()
    recognize_lock = threading.Lock()
    translate_lock = threading.Lock()
    translator_name = "injected" if translator_factory is not None else settings.translator

    @asynccontextmanager
    async def lifespan(app):
        app.state.generator = None
        try:
            app.state.generator = await run_in_threadpool(
                generator_factory or (lambda: load_generator(settings)))
            if not callable(getattr(app.state.generator, "generate", None)):
                app.state.generator = None
        except Exception:
            # Never expose exception text: loaders can include local paths or secrets.
            logger.error("Generator initialization failed")
        app.state.translator = None
        try:
            app.state.translator = await run_in_threadpool(
                translator_factory or (lambda: load_translator(settings)))
            if not callable(getattr(app.state.translator, "translate", None)):
                app.state.translator = None
        except Exception:
            logger.error("Translator initialization failed")
        app.state.recognizer = None
        app.state.item_names = {}
        try:
            app.state.recognizer = await run_in_threadpool(
                recognizer_factory or (lambda: load_recognizer(settings)))
            if not callable(getattr(app.state.recognizer, "score", None)):
                app.state.recognizer = None
            table = sentence.load_gloss_table(settings.gloss_table) if settings.gloss_table else None
            app.state.item_names = reading.item_names(table, app.state.generator)
        except Exception:
            logger.error("Recognizer initialization failed")
        yield
        app.state.generator = None
        app.state.translator = None
        app.state.recognizer = None

    app = FastAPI(title="Sign motion generation", lifespan=lifespan)
    app.state.generator = None
    app.state.translator = None
    app.state.recognizer = None
    app.state.item_names = {}

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        return JSONResponse(status_code=422, content={"detail": "Invalid generation request"})

    @app.get("/health")
    async def health():
        ready = app.state.generator is not None
        return JSONResponse(status_code=200 if ready else 503,
                            content={"status": "ready" if ready else "unavailable"})

    @app.post("/generate", response_model=MotionResponse)
    async def generate(request: GenerateRequest, response: Response):
        words, tags = request.gloss, request.nonmanual
        if (not words or len(words) > settings.max_words or len(tags) > settings.max_nonmanual
                or any(not word.strip() or len(word) > settings.max_word_chars for word in words)
                or any(not tag.strip() or len(tag) > settings.max_word_chars for tag in tags)
                or sum(map(len, words + tags)) > settings.max_input_chars):
            raise HTTPException(422, "Generation input exceeds limits or contains empty values")
        if app.state.generator is None:
            raise HTTPException(503, "Generator unavailable")
        # Acquire before entering the thread pool: other requests fail immediately.
        if not inference_lock.acquire(blocking=False):
            raise HTTPException(503, "Generator busy", headers={"Retry-After": "1"})
        try:
            def infer():
                result = app.state.generator.generate(gloss=words, nonmanual=tags)
                return serialize(result, words, settings.max_frames,
                                 segments=settings.mode == "sentence" and settings.segments)
            started = time.perf_counter()
            body = await run_in_threadpool(infer)
            response.headers["Server-Timing"] = f"gen;dur={(time.perf_counter() - started) * 1000:.1f}"
            return body
        except InvalidMotion as error:
            raise HTTPException(500, str(error)) from None
        except Exception:
            logger.error("Generator execution failed")
            raise HTTPException(500, "Generation failed") from None
        finally:
            inference_lock.release()

    @app.post("/translate", response_model=TranslateResponse)
    async def translate(request: TranslateRequest, response: Response):
        text = request.text
        if not text.strip() or len(text) > settings.max_input_chars:
            raise HTTPException(422, "Translation input is empty or exceeds limits")
        if app.state.translator is None:
            raise HTTPException(503, "Translator unavailable")

        def run():
            with translate_lock:  # 번역기(형태소 분석기)가 스레드 안전하다고 가정하지 않는다
                return sentence.check_translation(app.state.translator.translate(text))
        started = time.perf_counter()
        try:
            result = await run_in_threadpool(run)
        except Exception:
            logger.error("Translator execution failed")
            raise HTTPException(500, "Translation failed") from None
        response.headers["Server-Timing"] = f"tr;dur={(time.perf_counter() - started) * 1000:.1f}"
        name = getattr(app.state.translator, "name", None)
        return TranslateResponse(**result, translator=name if type(name) is str and name else translator_name)

    @app.post("/recognize", response_model=reading.RecognizeResponse)
    async def recognize(request: reading.RecognizeRequest, response: Response):
        """동작 좌표를 읽는 모델에 넣어 어떤 단어로 읽히는지 돌려준다 (serve/recognize.py)."""
        try:
            motion, spans = reading.decode(request, settings.max_frames)
        except reading.InvalidRecognition as error:
            raise HTTPException(422, str(error)) from None
        recognizer = app.state.recognizer
        if recognizer is None:
            raise HTTPException(503, "Recognizer unavailable")
        if request.joints == 55 and reading.uses_face(recognizer):
            raise HTTPException(422, "this recognizer needs face joints")
        if not recognize_lock.acquire(blocking=False):
            raise HTTPException(503, "Recognizer busy", headers={"Retry-After": "1"})
        try:
            started = time.perf_counter()
            body = await run_in_threadpool(reading.read, recognizer, motion, spans, app.state.item_names)
            response.headers["Server-Timing"] = f"rec;dur={(time.perf_counter() - started) * 1000:.1f}"
            return body
        except Exception:
            logger.error("Recognizer execution failed")
            raise HTTPException(500, "Recognition failed") from None
        finally:
            recognize_lock.release()

    @app.get("/verify", response_class=HTMLResponse)
    async def verify():
        if not settings.verify_page:
            raise HTTPException(404, "Not Found")
        return HTMLResponse(verify_html(), headers={"Cache-Control": "no-store"})

    return app
