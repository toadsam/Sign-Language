"""개발용 정적 서버. 캐시를 끄고(no-store) 이 폴더를 그대로 낸다.
python tools/serve.py [포트]  (기본 8766)
"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "200" not in str(args):
            super().log_message(fmt, *args)


http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H) as s:
    print(f"serving {ROOT} on http://127.0.0.1:{PORT}", flush=True)
    s.serve_forever()
