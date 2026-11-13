"""village-map 미리보기 서버.

아티팩트로 올리면 index.html 이 <!doctype html><html><head>…</head><body> 로 감싸진다.
로컬에서도 같은 모양으로 보이도록 "/" 요청에만 그 껍데기를 씌워 준다.
쓰기: python docs/presentation/village-map/tools/serve.py 8768
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEAD = ('<!doctype html><html><head><meta charset=utf8>'
        '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}'
        'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>'
        '</head><body>')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def do_GET(self):
        if self.path.split('?')[0].split('#')[0] in ('/', '/index.html'):
            body = (HEAD + (ROOT / 'index.html').read_text(encoding='utf-8') + '</body></html>').encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        # 미리보기 확인용: 페이지가 만든 PNG 를 tools/shots/ 에 받아 둔다 (저장소에는 올리지 않는다)
        if not self.path.startswith('/__shot/'):
            self.send_error(404); return
        name = ''.join(c for c in self.path[8:] if c.isalnum() or c in '-_')[:60] or 'shot'
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        out = ROOT / 'tools' / 'shots'; out.mkdir(exist_ok=True)
        (out / (name + '.png')).write_bytes(body)
        self.send_response(200); self.send_header('Content-Length', '2'); self.end_headers(); self.wfile.write(b'ok')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8768
    print(f'village-map http://127.0.0.1:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
