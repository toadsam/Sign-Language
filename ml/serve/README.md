# Motion generation service

`POST /generate` accepts `{"gloss":["화장실","있다"],"nonmanual":["의문"]}`.
`POST /api/sign/generate` on Spring accepts `{"text":"화장실 있어요?"}` and invokes
the existing translation service once before forwarding its normalized tokens.
Existing `/translate` responses remain unchanged. The new Spring route is public
under the same authentication/CSRF policy as `/translate`.

## Run

Python 3.11+, with `numpy`, `fastapi`, `pydantic`, `uvicorn` (tests also need `pytest`,
`httpx`). `requirements.txt` declares service dependencies separately from the ML
environment. Obtain approval before installing packages in the shared environment.
For a fresh isolated environment outside a synchronized folder:

```powershell
python -m venv C:/venvs/sign-serve
C:/venvs/sign-serve/Scripts/python.exe -m pip install -r ml/serve/requirements.txt
```

Deployment, from `ml/`, with B's `gen.infer.Generator` and its model dependencies
installed and a validated `generator.json` bundle already available:

```powershell
$env:SIGN_RUN_DIR = '<absolute path to generator bundle>'
$env:SIGN_DEVICE = 'cpu'
python -m uvicorn serve.app:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
```

The baseline and word-model loaders have synthetic integration checks using B's
actual `gen.infer.Generator`. Real-data and trained-motion quality remain separate.
The production factory never substitutes synthetic coordinates if loading fails.
`GET /health` returns only `{"status":"ready"}` (200) or
`{"status":"unavailable"}` (503). A load failure leaves generation unavailable.
Loading happens once per app lifespan. Restart the process to replace the model.

### 단어 GPT 생성 설정 (`generator.json`의 `sampling`)

| 키 | 기본값 | 뜻 |
|---|---|---|
| `top_k`, `temperature`, `min_len` | 10, 1.0, 2 | 단어마다 토큰을 뽑는 방식 |
| `guidance` | 1 | 1보다 크면 '단어 없음' 예측과 섞어 단어 조건을 강하게 한다. `cond_drop`으로 학습한 체크포인트 필요 |
| `signer` | 체크포인트의 `generation_signer` | 모든 후보에 쓸 화자 조건 |
| `samples` | 1 | 단어당 후보 수(1~32). 몸+손 거리로 가장 가운데 후보(medoid)를 고른다 |
| `signers` | – | `"all"`(`NO_SIGNER`를 뺀 학습 화자 전부) 또는 화자 이름 목록. `signer`·`samples` 대신 쓴다 |
| `per_signer` | 1 | `signers`와 함께: 화자마다 만들 후보 수. 전부 한 묶음으로 계산한다 |

대표 고르기는 정답 동작을 보지 않는다. 배포 중인 단어 모델(2026-11-02):
`{"guidance": 2.0, "signers": "all", "per_signer": 2}` = 단어당 후보 24개.
단어 모델 부분 응답 시간(3단어): T4 GPU(`SIGN_DEVICE=cuda`) 0.40초, CPU 8코어 2.3초.
CPU로 운영하면 `"samples": 5`(0.65초)를 고려한다.

For local HTTP checks with explicitly synthetic data, from the repository root:

```powershell
python -m uvicorn serve.demo:create_demo_app --app-dir ml --factory --host 127.0.0.1 --port 8000 --workers 1
```

This demo knows only `화장실` and `있다`; its single-frame array is fabricated and
does not represent sign-language motion. It accepts nonmanual tags but does not
generate expressions. Tag forwarding does not establish model support; E5's face
is an average face, and expression generation has not been validated.

## 문장 경로와 검증 화면 (P4, 2026-11-14)

한국어 문장 → 번역기 → 글로스 열 → 글로스 표 v2 → 동작 단위 열 → 문장 생성기 → 응답 ⑤.
`/generate` 요청과 응답 ⑤ 형식은 그대로다. 새 경로만 더했다.

| 경로 | 하는 일 |
|---|---|
| `POST /translate` | `{"text": "..."}` → `{"gloss", "units", "senses", "unknown", "dropped", "translator"}` (번역기 공유 인터페이스 dict + 번역기 이름). 빈 글·너무 긴 글 422, 번역기 없음 503 |
| `POST /generate` (문장 모드) | 받은 글로스 이름을 표로 단위로 바꿔 문장 생성기를 부른다. 표에 없거나 생성기가 구간을 주지 않은 이름은 `unknown` |
| `GET /verify` | 검증 화면 HTML 한 장. 문장 입력 → `/translate` → `/generate` → 2D 정면 재생, 글로스·구간 막대, unknown·dropped, 응답 시간. 외부 CDN 없음. `?text=...&frame=N`으로 바로 실행·멈춤 |

두 POST 응답에는 서버 처리 시간이 `Server-Timing` 헤더(`tr;dur=`, `gen;dur=` ms)로 붙는다. JSON 본문은 바뀌지 않는다.

문장 모드에서 `segments`는 `[{"gloss": 글로스 이름, "start": 첫 프레임, "end": 끝 프레임 다음}]`(시간 순, 연결 구간 제외)이다.
단어 모드(기본)는 예전처럼 항상 `[]`다. Spring(2026-11-14~)은 segments를 검증한 뒤 앱에 그대로 전달한다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `SIGN_MODE` | `word` | `word` = 예전 단어 Generator(`SIGN_RUN_DIR`), `sentence` = 문장 경로 |
| `SIGN_GLOSS_TABLE` | – | 글로스 표 v2 JSON. 문장 모드와 stub 번역기에 필요 |
| `SIGN_TRANSLATOR` | `stub` | `stub` 또는 `module:function`(예: `gen.translate:load_translator`) |
| `SIGN_TRANSLATOR_PATH` | – | 실제 번역기의 학습 결과 JSON (load 함수에 그대로 넘김) |
| `SIGN_SENTENCE_GENERATOR` | `synthetic` | `synthetic`(가짜 동작) · `word`(`SIGN_RUN_DIR`의 단어 Generator를 단위마다 불러 잇기) · `module:function`(`load_sentence_generator(run_dir, device=)`) |
| `SIGN_SENTENCE_RUN_DIR` | – | 실제 문장 생성기 run 폴더 |
| `SIGN_SENTENCE_SIGNER` | – | 문장 생성기에 넘길 화자 조건 |
| `SIGN_SEGMENTS` | `1` | 문장 모드에서 segments를 채울지 |
| `SIGN_VERIFY_PAGE` | `1` | `0`이면 `/verify`가 404 |

번역기를 설정하지 않은 단어 모드 배포(`SIGN_GLOSS_TABLE` 없음, `SIGN_TRANSLATOR=stub`)에서는 `/translate`가 503이다.

로컬 확인 (`ml/`에서, GPU·데이터 없이):

```powershell
$env:SIGN_MODE = 'sentence'
$env:SIGN_GLOSS_TABLE = '<글로스 표 v2 JSON>'   # stub 번역기 + 가짜 동작
python -m uvicorn serve.app:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
# 브라우저: http://127.0.0.1:8000/verify
```

표 없이 보려면 `python -m uvicorn serve.demo:create_sentence_demo_app --factory ...`(지어낸 7단어 표).
가짜 동작(`synthetic`)은 단위 이름 해시로 손 위치를 정한 것이라 수어가 아니다. 화면·연결 확인용이다.

실제 부품으로 바꾸기 (①②가 끝난 뒤, 서버에서):

```bash
SIGN_MODE=sentence SIGN_GLOSS_TABLE=<표> \
SIGN_TRANSLATOR=gen.translate:load_translator SIGN_TRANSLATOR_PATH=<번역기 JSON> \
SIGN_SENTENCE_GENERATOR=<모듈>:load_sentence_generator SIGN_SENTENCE_RUN_DIR=/data/runs/sent_gpt_<태그> \
SIGN_DEVICE=cuda python -m uvicorn serve.app:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
```

## Limits and scheduling

Python environment variables:

| Variable | Default |
|---|---:|
| `SIGN_MAX_WORDS` | 128 |
| `SIGN_MAX_WORD_CHARS` | 100 per gloss/tag |
| `SIGN_MAX_INPUT_CHARS` | 4096 across gloss and tags |
| `SIGN_MAX_NONMANUAL` | 16 |
| `SIGN_MAX_FRAMES` | 1800 |

Malformed input returns 422 without invoking the generator. A single model call
and its serialization occupy one slot. Concurrent calls receive 503 with
`Retry-After: 1` immediately; there is no inference queue or automatic retry.
Web requests and health checks can still be handled while inference runs in a
worker thread. Use **one Uvicorn worker**: multiple processes would each load a
model and have separate locks, defeating GPU/RNG serialization across processes.
Caching is disabled. Request bodies are not logged by the service.

The frame limit rejects excessive output; it cannot prevent a faulty generator
from allocating memory before returning. A hung native model call cannot safely
be killed in a Python thread: Spring returns a timeout error while FastAPI's
slot remains busy until the call ends. A process supervisor is needed for recovery.

Spring environment variables (configured URL is never taken from request input):

| Variable | Default |
|---|---|
| `SIGN_GENERATION_URL` | `http://127.0.0.1:8000/generate` |
| `SIGN_GENERATION_CONNECT_TIMEOUT` | `PT1S` |
| `SIGN_GENERATION_RESPONSE_TIMEOUT` | `PT10S` |
| `SIGN_GENERATION_MAX_TEXT_CHARS` | `4096` |
| `SIGN_GENERATION_MAX_FRAMES` | `1800` |

Timeouts are ISO-8601 durations. Response timeout bounds the full HTTP exchange,
including reading the body. Response size is bounded; redirects and retries are
disabled. Spring validates required keys, integer fields, source, segments,
canonical base64, exact byte count, finite float coordinates, and unknown entries
before returning the coordinate response. Align the two frame limits when deploying.
Only `metadata.question` is forwarded, as `nonmanual=["의문"]`.

## Successful coordinates and explicit errors

The coordinate contract uses `fps=30`, `joints=125`, `units="shoulder"`,
`frames=T`, `source="baseline"|"model"`, `tokens`, `segments=[]`, `unknown`,
and `data`. No word timing is inferred. Decode in frame → joint → xyz order:

```python
raw = base64.b64decode(response['data'], validate=True)
assert len(raw) == response['frames'] * 125 * 3 * 4
motion = np.frombuffer(raw, dtype='<f4').reshape(response['frames'], 125, 3)
```

Coordinates use neck origin, shoulder width 1, and downward y. A baseline has no
VQ tokens. These details follow the existing proposed API contract; this service
does not approve or change that team contract.

Unknown-input policies still need consumer agreement:

- Partial unknown: generate known words and return the original unknown gloss.
- All unknown: 200, `frames=0`, `data=""`, `tokens=[]`, and all unknown gloss;
  Spring forwards this coordinate response. Viewer treatment is still undecided.
- These are successful coordinate responses, distinct from system generation failures.

The generation API **never automatically substitutes video**. This replaces the
previous `source="video"` success variant. Existing `/translate` playback behavior
and its DTO are unchanged; the generation controller's error handler is scoped
to that controller and does not change other endpoints.

Spring returns non-success HTTP status with this safe JSON envelope:

```json
{"error":{"code":"GENERATION_UNAVAILABLE","message":"동작을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.","retryable":true}}
```

| Situation | HTTP | error.code | retryable |
|---|---:|---|---|
| Malformed request, blank/overlong text | 400 | INVALID_REQUEST | false |
| No translated gloss, or upstream 400/413/422 rejects input | 422 | NO_GENERATABLE_INPUT | false |
| Translation service fails | 502 | TRANSLATION_UNAVAILABLE | true |
| Connection unavailable, not ready, busy (upstream 429/503) | 503 | GENERATION_UNAVAILABLE | true |
| Full HTTP deadline, or upstream 408/504 | 504 | GENERATION_TIMEOUT | true |
| Malformed coordinates, unexpected status/5xx | 502 | GENERATION_FAILED | true |

Errors have no `source`, `items`, or coordinate `data`. Messages never contain
the upstream body, input text, model configuration, file paths, or stack traces.
Upstream busy/not-ready responses use a fixed `Retry-After: 1`; an upstream header
is never forwarded unchecked. `retryable=true` allows a later **new user request**;
it does not guarantee success. The server performs no automatic retry loop.
Failed requests release their inference slot; a timed-out model may remain busy
until its current call actually ends, as described above.

Frontend handoff (UI implementation remains with the frontend owner): preserve
the original input and visible error state, display `error.message`, enable a
retry action when `retryable=true`, and suppress duplicate submissions while a
request is pending. A user retry sends the original text as a fresh POST. For
non-retryable input errors, keep the text editable. Do not switch to videos or
clear a user's input on failure. Partial/all unknown display still needs a
separate consumer decision. This repository change does not implement UI buttons.

`examples/normal.json`, `unknown.json`, and the legacy-named `video.json` are
synthetic fixtures; `video.json` now holds the explicit 503 error above. See the
examples README for that filename's compatibility note. No actual AI Hub motion
data, real labels bundle, or model weights are included.

## Verify without external services

From repository root, with the test dependencies present:

```powershell
python -m pytest ml/serve/tests -q
cd backend
.\gradlew.bat --offline test --tests 'com.wow.signlanguage.generation.*' --no-daemon
```

The Spring suite mocks `TranslationService`, starts a localhost HTTP stub, and
uses the actual security configuration. It excludes the static clip-directory
configuration from its MVC slice. It does not initialize OpenAI, ETRI, Firebase,
storage, or GCP clients. The existing full `contextLoads` test initializes the
whole application, so it is deliberately outside this isolated test selection.

An additional optional test goes through the Spring controller, mocked translation,
real HTTP client, and the running synthetic FastAPI demo. Start the demo in a
separate terminal, then set `SIGN_TEST_FASTAPI_URL=http://127.0.0.1:8000/generate`
and run the same Gradle selection. It checks all decoded synthetic joint values.
The test is skipped unless this variable is supplied; only localhost is permitted.

To start/stop the temporary demo HTTP server automatically and run the C1 Java
tests, including that optional test, from the repository root:

```powershell
python -m ml.serve.tests.run_http_check
```

This runner uses an available localhost port and shuts down its own server in a
`finally` block. It still requires the existing JDK/Gradle cache; it never installs
or downloads dependencies.

## Actual baseline Generator regression checks

From repository root, with B's baseline code and the existing test dependencies:

```powershell
python -m pytest ml/serve/tests -q -p no:cacheprovider
python -m ml.serve.tests.run_http_check --baseline
```

Set `JAVA_HOME` to an installed JDK 17 and `GRADLE_USER_HOME` to an existing Gradle
cache if the defaults differ. The Java command remains offline and limits test
selection to the `generation` package. No extra dependencies or model weights are
required for the baseline.

The first command retains the C1 mock tests and adds actual baseline tests in
`test_baseline_service.py`. For the B-independent C1 checks alone, select
`ml/serve/tests/test_service.py` instead.

The `--baseline` runner retains the C1 demo and also creates a temporary run with
synthetic metadata, coordinate arrays, a fixed synthetic signer split, vocabulary,
and `generator.json` with `kind="baseline"`. It calls the production app factory
with a run directory, without an injected Generator factory. The loader imports
B's real `gen.infer.Generator`; no B test fixtures are imported. A second temporary
app exercises a bad production configuration. All servers bind to `127.0.0.1` on
available ports and stop before their temporary bundles are cleaned up.

Java `BaselineHttpFlowTests` exercises Spring controller → mocked TranslationService
→ real HTTP FastAPI → actual B baseline → coordinate serialization → Spring response.
It covers normal words, repeated words and requests, partial unknown including
duplicates, all unknown, and explicit 503 errors after failed initialization. These
tests are skipped unless the runner supplies `SIGN_TEST_BASELINE_URL` and
`SIGN_TEST_UNAVAILABLE_URL`. The original demo test and HTTP-stub failure tests
remain distinct from these actual-B checks.

The synthetic oracle assigns coordinate values using exact binary fractions:
`marker*8 + frame/32 + joint/512 + axis/4096`, with markers 1 and 2 identifying two
fabricated words. Source arrays have 20 frames with active `[6,10]`; B's four-frame
padding selects `[2:15]` (13 frames per word). The fixture sets `blend=0`, so the
complete decoded coordinate array independently verifies word, frame, joint, and
axis order. No real motion quality is implied by these fabricated values.

Python additionally checks loaded-object reuse, nonmanual tags leaving baseline
coordinates unchanged, busy rejection and recovery with event-based fault injection,
output frame limits, missing/malformed configuration, and bad coordinate files.
The existing tests retain timeout, malformed response, user retry recovery, authentication, and legacy
`/translate` coverage. Expected initialization-failure logs appear during negative
configuration checks. Baseline tag acceptance does not generate facial expressions.

These checks validate integration on synthetic CPU data. They do not validate E5
receipt, trained models, GPU performance, real sign-language quality, viewer playback,
or the full application context. The response policies marked for team confirmation
above remain unchanged.

## Word GPT and coordinate-regression HTTP checks

With CPU Torch in the service environment, `python -m ml.serve.tests.run_http_check
--models` adds actual A/B model checks to the existing baseline/demo suites.
This flag makes disposable tiny smoke checkpoints through A's public training API,
keeps training runs separate from deployment bundles, and uses the production
startup loader for `word_gpt` and `word_regress`. GPT responses remain stochastic;
the tests do not require repeated requests to have identical coordinates or add a
seed field to the HTTP contract. Regression uses direct coordinates and tokens=[].

Installation requires approval; CPU-only model requirements are separate in
`requirements-models.txt`. See [the test guide](tests/README.md) for exact commands,
environment requirements, genuine inference versus fault injection, and cleanup.
All model weights and input data in these tests are synthetic, not actual E5 or a
validated sign-language model. The public response policies remain unchanged.

## 읽기 경로 `/recognize` (2026-11-15, 재훈이 기능 합치기 브랜치 jjh-sum 에서 추가)

앱의 따라 하기가 끝나면 "친구 동작과 내 동작이 읽는 모델(승현, 계약 ④)에게 어떤 단어로 읽히는지"를 보여 주려고 만든 주소다.
읽는 모델 코드(`ml/recog`)와 계약 ④ `Recognizer.score(motion, active)`는 고치지 않고 그대로 부른다.

```
POST /recognize
{"joints": 125 | 55, "frames": T, "data": "base64(float32 little-endian [T x joints x 3])",
 "spans": [[start, end], ...]}          # 생략하면 동작 전체를 한 번 읽는다. end 는 끝 프레임 다음
-> {"classes": 3000,
    "results": [{"start": 0, "end": T, "top": [{"item": "WORD0773", "name": "병원", "prob": 0.82}, ...]}]}
```

- 좌표는 계약 ①과 같다(목 원점, 어깨너비 1). `joints: 55` 는 앞 55점(상체 13 · 왼손 21 · 오른손 21)만 보낸 것이고 얼굴 70점은 0으로 채워 읽는다. 웹캠으로 받은 내 동작이 55점이다.
- `top` 은 확률이 높은 순서로 5개. `name` 은 단어 번호의 한국어 이름이고 글로스 표나 단어 생성기의 단어표에서 찾는다. 못 찾으면 `null`.
- 켜는 법: 환경 변수 `SIGN_RECOG_RUN_DIR` 에 읽는 모델 run 폴더(`model.pt` 가 든 곳)를 적는다. 비워 두면 서버는 그대로 켜지고 `/recognize` 만 503 이다. 기존 `/generate` · `/translate` · `/verify` 동작은 바뀌지 않는다.
- 답: 요청이 틀리면 422(얼굴 좌표까지 쓰는 읽는 모델에 55점을 보낸 경우도 422), 읽는 모델이 없거나 다른 읽기 요청을 처리 중이면 503(`Retry-After: 1`), 읽다가 실패하면 500. 한 번에 한 요청만 읽는다.
- Spring 은 `POST /api/sign/recognize` 로 이 주소에 전달한다. 주소는 `SIGN_RECOGNITION_URL`, 비워 두면 `SIGN_GENERATION_URL` 의 끝 `/generate` 를 `/recognize` 로 바꿔 쓴다.

한계: 읽는 모델은 스튜디오에서 찍은 **단어 클립**으로 배웠다. 문장 모델이 만든 동작의 낱말 구간(S 단위가 많다)이나 웹캠 좌표(깊이 z 가 부정확하다)는 잘 못 읽을 수 있다.
그래서 이 주소는 읽은 결과만 전하고 맞다 · 틀리다를 판정하지 않으며, 앱도 따라 하기 점수에 넣지 않는다.

확인: `python -m pytest ml/serve/tests/test_recognize_service.py` (가짜 읽는 모델 6개 검사). 로컬 표본 모델(`runs/recog_sample`, 20단어)로는 단어 클립 3개가 125점 · 55점 모두 제 단어로 읽혔다.
VM 의 정식 읽는 모델(3,000단어)로는 아직 켜 보지 않았다.
