# Service CPU integration tests

All motion, token, metadata, and weight files used here are fabricated in temporary
directories. Nothing in these tests measures real sign-language quality or uses
OpenAI, ETRI, Firebase, GCP, GPUs, or a sentence model. TranslationService stays mocked.

## Environment

Use one service Python environment containing the HTTP requirements and, for model
tests, CPU Torch. Do not append another venv's site-packages to `sys.path`. The
runner's `ml/` source-path insertion matches production `--app-dir ml`; it does not
combine environments.

The Windows CPU model environment is declared in `../requirements-models.txt`:
`torch==2.14.1+cpu` from `https://download.pytorch.org/whl/cpu`. Install only after
approval, into the service environment. The existing HTTP dependencies are in
`../requirements.txt`. Training/D/system environments need no changes.

```powershell
# Only after approval; run from repository root using the service interpreter.
.\ml\serve\.venv\Scripts\python.exe -m pip --isolated --disable-pip-version-check install --no-cache-dir -r ml/serve/requirements-models.txt
```

## Reproduce

From repository root:

```powershell
# All service Python checks: C1 mock, actual baseline, actual word models.
.\ml\serve\.venv\Scripts\python.exe -m pytest ml/serve/tests -q -p no:cacheprovider

# Gen regression, using the same service environment and this worktree's source.
cd ml
.\serve\.venv\Scripts\python.exe -m unittest discover -s gen/tests -p 'test_*.py' -q
cd ..

# Spring MVC -> real HTTP -> FastAPI -> actual A/B model path, plus existing checks.
$env:JAVA_HOME = '<installed JDK 17>'
$env:GRADLE_USER_HOME = '<existing Gradle cache>'
.\ml\serve\.venv\Scripts\python.exe -m ml.serve.tests.run_http_check --models
```

The runner executes only `com.wow.signlanguage.generation.*` via Gradle `--offline`
and creates its own localhost endpoints on available ports. It never downloads
Gradle dependencies. `--models` includes the baseline checks. Without Torch this
option fails clearly instead of silently claiming model coverage. Pytest marks
the model module skipped if Torch is absent: that is **not** a verified model path.

For smaller scopes, `test_service.py` uses a C mock and `--baseline` uses actual B
baseline code with synthetic arrays. These remain separate from model checks.
Plain Gradle without the runner skips the optional HTTP suites because it has no
runner-owned URLs or manifest. The full application `contextLoads` test remains
outside the selected generation package.

## Actual model path

`model_fixture.py` uses A's public selection/training APIs for four tiny CPU steps
per word model (`d=8`, one layer, two fabricated classes). The tiny VQ has eight
codes, width eight, code dimension four, and a declared synthetic version. A's
inference `model.pt` and recovery `latest.pt` stay in `training/<kind>/`; deployment
JSON stays in `bundles/<kind>/` and references the inference checkpoint by a
relative path. The checkpoint's schema/manifest and every declared file hash are
real. `data_mode="smoke"` is explicit; no production validation is bypassed.

Startup uses the production service factory, actual `gen.infer.Generator`, actual
A loader, and actual VQ provenance loader. Tests spy on loader calls without
replacing their behavior to check one startup load and object reuse. No B test
fixture modules are imported.

- GPT: real sampling and per-word VQ decoding. Test-only config sets min/max length
  to three, making word boundaries known while tokens remain stochastic. Each
  response independently checks codes in `[0,8)`, frames=`tokens*4`, float32
  little-endian bytes, every per-word decoded coordinate, and the constant synthetic
  face. Repeated unseeded responses are never required to equal each other.
- Regression: real direct-coordinate inference, tokens empty. The independent
  oracle uses A forward passes to verify the complete bytes and word order, including
  repeated words and mixed unknown entries. A VQ file identifies provenance; it
  does not turn regression outputs into token-generated motion.
- Both: source=model, fps=30, joints=125, units=shoulder, segments=[], exact byte
  counts, finite coordinates, repeated requests, original unknown order/duplicates,
  zero-frame all-unknown response, and unchanged public HTTP input (no seed field).

Nonmanual tags are accepted but these word models do not generate expressions.
Concatenating individual word motions is not a sentence model.

## Failure checks and cleanup

Corrupt checkpoint, wrong model hash, declared version mismatch, recovery checkpoint,
unsupported checkpoint schema, wrong VQ hash, and mismatched actual VQ version each
exercise startup failure for both models. Readiness stays unavailable; public
errors never disclose local paths. The HTTP runner checks Spring's explicit
non-success error for every such case; it never receives video items.

Adapter and service frame limits use actual model output/validation. Busy faults
use an event gate around an actual model call; timeout faults hold an actual call.
Test-only recovery endpoints release the gates, then Spring resubmits the original
input as a new user request and must succeed. These control routes never exist in
the production app. There is no automatic retry in the client or generation API.
These wrappers exist only on fault endpoints. The normal GPT/regression endpoints
always use unmodified A/B inference. The runner releases/join its gate requests,
stops every server, and only then removes temporary bundles, checkpoints, and its
Java test manifest. No server processes remain running after the command exits.

Existing HTTP-stub tests still cover malformed base64/shape/finite values, body
deadlines, connection failures, explicit error classification, retries after one
failure, legacy `/translate` videos, and security. The generation controller has
a scoped error handler; existing translate responses remain unchanged. See the
service README's status/code/retryable table and frontend handoff. The old
`examples/video.json` name now contains a synthetic 503 error instead of videos.
Expected initialization-failure messages belong to negative tests. Startup success
or tiny synthetic output is not evidence of E5 receipt, trained-model quality,
CUDA compatibility, real data validation, or viewer playback.
