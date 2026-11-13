"""Model-only localhost harness; normal endpoints always use real A/B loaders."""
from contextlib import contextmanager
from pathlib import Path
import threading

import httpx

from ml.serve.app import create_app
from ml.serve.settings import Settings
from ml.serve.tests.baseline_fixture import write_json
from ml.serve.tests.model_fixture import (
    DOWN, FAILURES, KINDS, MAX_LEN, NB_CODE, REGRESS_LENGTH,
    make_model_bundles, regression_oracle, variant_bundle,
)


@contextmanager
def occupy_slot(app, url):
    """Event-based busy fault; release and finish the real model request on exit."""
    entered, release = threading.Event(), threading.Event()
    original = app.state.generator.generate
    outcome = []

    def delayed(**kwargs):
        entered.set()
        if not release.wait(120):
            raise RuntimeError("Synthetic busy gate expired")
        return original(**kwargs)

    def request():
        try:
            outcome.append(httpx.post(url, json={"gloss": ["화장실"]}, timeout=125).status_code)
        except Exception as error:
            outcome.append(type(error).__name__)

    app.state.generator.generate = delayed
    worker = threading.Thread(target=request, daemon=True)
    worker.start()
    try:
        if not entered.wait(5):
            raise RuntimeError("Could not occupy the temporary model slot")
        def recover():
            release.set()
            worker.join(timeout=10)
            app.state.generator.generate = original
            if worker.is_alive() or outcome != [200]:
                raise RuntimeError("Temporary busy request did not finish successfully")
        yield recover
    finally:
        release.set()
        worker.join(timeout=10)
        app.state.generator.generate = original
        if worker.is_alive() or outcome != [200]:
            raise RuntimeError("Temporary busy request did not finish successfully")


def configure_model_servers(cleanup, root: Path, serve):
    bundles = make_model_bundles(root / "models")
    manifest = {"models": {}, "failures": []}

    def endpoint(bundle, *, max_frames=1800, track_completion=False):
        app = create_app(Settings(run_dir=str(bundle), max_frames=max_frames))
        if track_completion:
            app.state.generation_finished = threading.Event()

            @app.middleware("http")
            async def complete(request, call_next):
                response = await call_next(request)
                if request.url.path == "/generate":
                    app.state.generation_finished.set()  # endpoint finally has released its slot
                return response
        url = cleanup.enter_context(serve(app))
        return app, url

    for kind in KINDS:
        app, url = endpoint(bundles[kind])
        generator = app.state.generator
        if generator is None or generator.kind != kind or type(generator).__module__ != "gen.infer":
            raise RuntimeError("Actual model adapter failed to initialize")
        manifest["models"][kind] = {"url": url, "nb_code": NB_CODE, "down": DOWN,
            "max_len": MAX_LEN, "length": REGRESS_LENGTH}
        if kind == "word_regress":
            manifest["models"][kind]["oracle"] = regression_oracle(bundles[kind])
        def add_failure(name, address, status, code, timeout_ms=3000, recovery_url=None):
            record = {"kind": kind, "failure": name, "url": address, "timeout_ms": timeout_ms,
                      "status": status, "code": code, "retryable": True}
            if recovery_url:
                record["recovery_url"] = recovery_url
            manifest["failures"].append(record)

        for failure in FAILURES:
            bad = variant_bundle(root / "faults" / kind / failure, bundles[kind], failure)
            failed, failed_url = endpoint(bad)
            if failed.state.generator is not None:
                raise RuntimeError("Bad model artifact was reported ready")
            add_failure(failure, failed_url, 503, "GENERATION_UNAVAILABLE")

        bounded = variant_bundle(root / "faults" / kind / "frame_limit", bundles[kind], "frame_limit")
        _, bounded_url = endpoint(bounded)
        add_failure("adapter_frame_limit", bounded_url, 502, "GENERATION_FAILED")
        limit = MAX_LEN * DOWN - 1 if kind == "word_gpt" else REGRESS_LENGTH - 1
        _, limited_url = endpoint(bundles[kind], max_frames=limit)
        add_failure("service_frame_limit", limited_url, 502, "GENERATION_FAILED")

        busy, busy_url = endpoint(bundles[kind])
        recover_busy = cleanup.enter_context(occupy_slot(busy, busy_url))

        # Fault-fixture endpoints only; production apps never register this route.
        register_recovery(busy, recover_busy)
        add_failure("busy", busy_url, 503, "GENERATION_UNAVAILABLE",
                    recovery_url=busy_url.removesuffix("/generate") + "/_test/recover")
        delayed, delayed_url = endpoint(bundles[kind], track_completion=True)
        recover_timeout = gate_timeout(delayed)
        cleanup.callback(recover_timeout)

        register_recovery(delayed, recover_timeout, require_entered=True)
        add_failure("timeout", delayed_url, 504, "GENERATION_TIMEOUT", timeout_ms=250,
                    recovery_url=delayed_url.removesuffix("/generate") + "/_test/recover")
    path = root / "model_http_manifest.json"
    write_json(path, manifest)
    return path


def gate_timeout(app):
    """Hold one actual call until the test explicitly simulates service recovery."""
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    original = app.state.generator.generate

    def delayed(**kwargs):
        entered.set()
        try:
            if not release.wait(120):
                raise RuntimeError("Synthetic timeout gate expired")
            return original(**kwargs)
        finally:
            finished.set()

    app.state.generator.generate = delayed

    def recover(require_entered=False):
        if require_entered and not entered.is_set():
            raise RuntimeError("Timeout did not reach the actual model call")
        release.set()
        if entered.is_set() and not finished.wait(10):
            raise RuntimeError("Timed-out model call did not finish")
        if entered.is_set() and not app.state.generation_finished.wait(10):
            raise RuntimeError("Timed-out HTTP request did not release its slot")
        app.state.generator.generate = original

    return recover


def register_recovery(app, recover, *, require_entered=False):
    def control():
        if require_entered:
            recover(require_entered=True)
        else:
            recover()
        return {"recovered": True}

    app.post("/_test/recover")(control)
