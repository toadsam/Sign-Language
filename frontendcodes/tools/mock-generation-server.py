#!/usr/bin/env python3
"""Local-only synthetic API: no inference or input storage."""
import argparse
import copy
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
ROOT = Path(__file__).resolve().parents[1]
SAMPLE = json.loads((ROOT / 'components/sign-player/demo-motion.json').read_text())


class Handler(BaseHTTPRequestHandler):
    def headers_for(self, status, kind, length):
        self.send_response(status)
        origin = self.headers.get('Origin', '')
        if re.fullmatch(r'http://(localhost|127\.0\.0\.1):\d+', origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Accept')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(length))
        self.end_headers()

    def respond(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.headers_for(status, 'application/json; charset=utf-8', len(raw))
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        self.headers_for(204, 'text/plain', 0)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/health':
            self.respond(200, {'mock': True, 'inference': False})
        elif path == '/sample-video.mp4':
            raw = (ROOT / 'public/sign-demo.mp4').read_bytes()
            self.headers_for(200, 'video/mp4', len(raw))
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.respond(404, {'error': 'not found'})

    def do_POST(self):
        request = urlsplit(self.path)
        if request.path != '/api/sign/generate':
            self.respond(404, {'error': 'not found'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 10000:
                raise ValueError()
            body = json.loads(self.rfile.read(size))
            text = body.get('text') if isinstance(body, dict) else None
            if not isinstance(text, str) or set(body) != {'text'} or not 1 <= len(text.strip()) <= 200:
                raise ValueError()
        except (ValueError, UnicodeError):
            self.respond(400, {'error': 'text required, 1..200 characters'})
            return
        scenario = parse_qs(request.query).get('scenario', ['success'])[0]
        if scenario == 'error':
            self.respond(503, {'error': {'code': 'GENERATION_UNAVAILABLE', 'message': '합성 시험: 동작을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'retryable': True}})
            return
        if scenario == 'all-unknown':
            self.respond(200, {'source': 'baseline', 'fps': 30, 'joints': 125, 'units': 'shoulder', 'frames': 0, 'data': '', 'tokens': [], 'segments': [], 'unknown': ['점검용 미지원 단어'], 'demo': True})
            return
        if scenario == 'slow':
            time.sleep(3)
        if scenario == 'invalid':
            self.respond(200, {'source': 'model', 'frames': 120})
            return
        if scenario == 'non-json':
            raw = b'not JSON'
            self.headers_for(200, 'text/plain', len(raw))
            self.wfile.write(raw)
            return
        if scenario in ('video-list', 'video-empty', 'video-list-error'):
            items = [
                {'word': '샘플 하나', 'id': 1, 'file': 'demo', 'url': '/sample-video.mp4', 'hasVideo': True},
                {'word': '영상 없는 샘플', 'id': 0, 'file': '', 'url': '', 'hasVideo': False},
                {'word': '샘플 둘', 'id': 2, 'file': 'demo', 'url': '/missing.mp4' if scenario == 'video-list-error' else '/sample-video.mp4', 'hasVideo': True},
            ]
            self.respond(200, {'source': 'video', 'items': [] if scenario == 'video-empty' else items, 'unknown': [], 'demo': True})
            return
        if scenario == 'video':
            self.respond(200, {'source': 'video', 'videoUrl': '/sample-video.mp4', 'unknown': [], 'demo': True})
            return
        result = copy.deepcopy(SAMPLE)
        result['demo'] = True
        result['unknown'] = ['점검용 미지원 단어'] if scenario == 'unknown' else []
        self.respond(200, result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8085)
    args = parser.parse_args()
    print(f'Synthetic API only: http://127.0.0.1:{args.port}/api/sign/generate', flush=True)
    print('All text returns synthetic test data. No sign recognition or text storage.', flush=True)
    try:
        ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
