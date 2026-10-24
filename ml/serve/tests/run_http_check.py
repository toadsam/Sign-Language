"""Run isolated Spring tests against temporary FastAPI servers on localhost.

From repository root: python -m ml.serve.tests.run_http_check
Add --baseline for the production loader + actual B Generator on synthetic data.
The caller supplies JAVA_HOME/GRADLE_USER_HOME where needed. No dependencies are installed.
"""
import argparse
from contextlib import ExitStack, contextmanager
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time

import uvicorn

from ml.serve.demo import create_demo_app
from ml.serve.app import create_app
from ml.serve.settings import Settings
from ml.serve.tests.baseline_fixture import make_baseline_bundle, write_json


@contextmanager
def serve_temporarily(app):
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    worker = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    worker.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            if not worker.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError("Synthetic HTTP server failed to start")
            time.sleep(0.05)
        yield f"http://127.0.0.1:{port}/generate"
    finally:
        server.should_exit = True
        worker.join(timeout=10)
        listener.close()
        if worker.is_alive():
            raise RuntimeError("Temporary HTTP server did not stop")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", action="store_true",
                        help="Also test B's production loader using a temporary synthetic bundle")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    with ExitStack() as cleanup:
        environment = dict(os.environ)
        # Opt-in test URLs must come from this runner's own temporary servers.
        for variable in ("SIGN_TEST_BASELINE_URL", "SIGN_TEST_UNAVAILABLE_URL"):
            environment.pop(variable, None)
        environment["SIGN_TEST_FASTAPI_URL"] = cleanup.enter_context(serve_temporarily(create_demo_app()))
        if args.baseline:
            # Match deployment's --app-dir ml without depending on B's test helpers.
            sys.path.insert(0, str(root / "ml"))
            temporary = Path(cleanup.enter_context(tempfile.TemporaryDirectory(prefix="sign-baseline-")))
            run = make_baseline_bundle(temporary)
            baseline = create_app(Settings(run_dir=str(run)))
            environment["SIGN_TEST_BASELINE_URL"] = cleanup.enter_context(serve_temporarily(baseline))
            if (type(baseline.state.generator).__module__, type(baseline.state.generator).__name__) != (
                    "gen.infer", "Generator"):
                raise RuntimeError("Production baseline loader was not ready")
            bad_run = temporary / "bad_run"
            bad_run.mkdir()
            write_json(bad_run / "generator.json", {"schema_version": 1, "kind": "invalid_test_kind"})
            failed = create_app(Settings(run_dir=str(bad_run)))
            environment["SIGN_TEST_UNAVAILABLE_URL"] = cleanup.enter_context(serve_temporarily(failed))
            if failed.state.generator is not None:
                raise RuntimeError("Invalid baseline configuration was reported ready")
        command = (["cmd", "/c", "gradlew.bat"] if os.name == "nt" else ["./gradlew"])
        result = subprocess.run(command + ["--offline", "test", "--tests",
                                "com.wow.signlanguage.generation.*", "--no-daemon"],
                                cwd=root / "backend", env=environment, check=False)
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
