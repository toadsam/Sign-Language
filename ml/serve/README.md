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

For local HTTP checks with explicitly synthetic data, from the repository root:

```powershell
python -m uvicorn serve.demo:create_demo_app --app-dir ml --factory --host 127.0.0.1 --port 8000 --workers 1
```

This demo knows only `화장실` and `있다`; its single-frame array is fabricated and
does not represent sign-language motion. It accepts nonmanual tags but does not
generate expressions. Tag forwarding does not establish model support; E5's face
is an average face, and expression generation has not been validated.

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
disabled. Spring validates required keys, integer fields, source, empty segments,
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
