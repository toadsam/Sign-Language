"""Run from ml/: python -m uvicorn serve.app:create_app --factory --workers 1."""
import logging
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Protocol

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .models import GenerateRequest, MotionResponse
from .serialization import InvalidMotion, serialize
from .settings import Settings

logger = logging.getLogger(__name__)


class Generator(Protocol):
    def generate(self, gloss: list[str], nonmanual: list[str] = (), seed: int | None = None) -> dict: ...


def load_generator(settings: Settings) -> Generator:
    if not settings.run_dir:
        raise ValueError("Generator configuration required")
    # B is imported only for deployment, never for injected C1 tests.
    from gen.infer import Generator as DeployedGenerator
    return DeployedGenerator(settings.run_dir, device=settings.device)


def create_app(settings: Settings | None = None,
               generator_factory: Callable[[], Generator] | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    inference_lock = threading.Lock()

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
        yield
        app.state.generator = None

    app = FastAPI(title="Sign motion generation", lifespan=lifespan)
    app.state.generator = None

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        return JSONResponse(status_code=422, content={"detail": "Invalid generation request"})

    @app.get("/health")
    async def health():
        ready = app.state.generator is not None
        return JSONResponse(status_code=200 if ready else 503,
                            content={"status": "ready" if ready else "unavailable"})

    @app.post("/generate", response_model=MotionResponse)
    async def generate(request: GenerateRequest):
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
                return serialize(result, words, settings.max_frames)
            return await run_in_threadpool(infer)
        except InvalidMotion as error:
            raise HTTPException(500, str(error)) from None
        except Exception:
            logger.error("Generator execution failed")
            raise HTTPException(500, "Generation failed") from None
        finally:
            inference_lock.release()

    return app
