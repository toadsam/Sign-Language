"""Run isolated Spring tests against a temporary synthetic FastAPI on localhost.

From repository root: python -m ml.serve.tests.run_http_check
The caller supplies JAVA_HOME/GRADLE_USER_HOME where needed. No dependencies are installed.
"""
import os
from pathlib import Path
import socket
import subprocess
import threading
import time

import uvicorn

from ml.serve.demo import create_demo_app


def main():
    root = Path(__file__).resolve().parents[3]
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_demo_app(), host="127.0.0.1", port=port, log_level="warning"))
    worker = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    worker.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            if not worker.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError("Synthetic HTTP server failed to start")
            time.sleep(0.05)
        environment = dict(os.environ, SIGN_TEST_FASTAPI_URL=f"http://127.0.0.1:{port}/generate")
        command = (["cmd", "/c", "gradlew.bat"] if os.name == "nt" else ["./gradlew"])
        result = subprocess.run(command + ["--offline", "test", "--tests",
                                "com.wow.signlanguage.generation.*", "--no-daemon"],
                                cwd=root / "backend", env=environment, check=False)
        return result.returncode
    finally:
        server.should_exit = True
        worker.join(timeout=10)
        listener.close()


if __name__ == "__main__":
    raise SystemExit(main())
