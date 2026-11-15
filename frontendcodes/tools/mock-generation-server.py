#!/usr/bin/env python3
"""Local-only synthetic API: no inference or input storage."""
import argparse
import copy
import json
import re
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
ROOT = Path(__file__).resolve().parents[1]
RECOGNIZE_URL = None  # --recognize-url 로 주면 읽기 요청을 그 주소(진짜 추론 서버의 /recognize)로 넘긴다
SAMPLE = json.loads((ROOT / 'components/sign-player/demo-motion.json').read_text(encoding='utf-8'))  # 윈도우 기본 인코딩(cp949)에서도 읽히게


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

    def recognize(self):
        """읽기 주소 흉내 (2026-11-15 재훈). 넘길 곳이 있으면 진짜 읽는 모델의 답을 그대로 전하고,
        없으면 구간마다 '점검 단어'를 돌려준다. 가짜 답은 좌표를 보지 않는다."""
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 12_000_000:
                raise ValueError()
            raw = self.rfile.read(size)
            body = json.loads(raw)
            frames, joints = body['frames'], body['joints']
            if type(frames) is not int or joints not in (55, 125) or frames < 4 or type(body['data']) is not str:
                raise ValueError()
            if len(body['data']) != (frames * joints * 12 + 2) // 3 * 4:
                raise ValueError()
            spans = body.get('spans') or [[0, frames]]
            if any(len(s) != 2 or not 0 <= s[0] < s[1] <= frames for s in spans):
                raise ValueError()
        except (ValueError, KeyError, TypeError, UnicodeError):
            self.respond(400, {'error': {'code': 'INVALID_REQUEST', 'message': '동작 좌표가 올바르지 않습니다.', 'retryable': False}})
            return
        if RECOGNIZE_URL:
            try:
                forward = urllib.request.Request(RECOGNIZE_URL, data=raw, headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(forward, timeout=15) as answer:
                    self.respond(200, json.loads(answer.read()))
            except urllib.error.HTTPError as error:
                status = 503 if error.code in (429, 503) else 400 if error.code in (400, 413, 422) else 502
                code = {503: 'RECOGNITION_UNAVAILABLE', 400: 'INVALID_REQUEST', 502: 'RECOGNITION_FAILED'}[status]
                self.respond(status, {'error': {'code': code, 'message': '읽는 모델이 답하지 못했습니다.', 'retryable': status != 400}})
            except (urllib.error.URLError, OSError, ValueError):
                self.respond(503, {'error': {'code': 'RECOGNITION_UNAVAILABLE', 'message': '읽는 모델을 쓸 수 없습니다. 잠시 후 다시 시도해 주세요.', 'retryable': True}})
            return
        results = [{'start': s[0], 'end': s[1], 'top': [
            {'item': f'MOCK{i * 3 + k + 1:04d}', 'name': f'점검 단어 {i * 3 + k + 1}', 'prob': p}
            for k, p in enumerate((0.62, 0.21, 0.08))]} for i, s in enumerate(spans)]
        self.respond(200, {'classes': 3000, 'results': results})

    def do_POST(self):
        request = urlsplit(self.path)
        if request.path == '/api/sign/recognize':
            self.recognize()
            return
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
        if scenario == 'sentence':
            # 문장 모드 흉내 (2026-11-15 재훈): 띄어 쓴 낱말마다 구간을 하나씩 만들고 낱말 사이는 6프레임 비운다.
            # '집'으로 시작하는 낱말은 못 그린 것으로 친다. 번역도 생성도 하지 않는다. 동작은 늘 같은 합성 120프레임이다.
            words = [w.strip('.,?!~') for w in text.split()][:6]
            words = [w for w in words if w]
            known = [w for w in words if not w.startswith('집')]
            missing = [w for w in words if w.startswith('집')]
            if not known:
                self.respond(200, {'source': 'baseline', 'fps': 30, 'joints': 125, 'units': 'shoulder', 'frames': 0, 'data': '', 'tokens': [], 'segments': [], 'unknown': missing or [text.strip()], 'demo': True})
                return
            result = copy.deepcopy(SAMPLE)
            gap = 6
            span = (result['frames'] - gap * (len(known) - 1)) // len(known)
            result.update({'demo': True, 'source': 'model', 'unknown': missing,
                           'segments': [{'gloss': w, 'start': i * (span + gap), 'end': i * (span + gap) + span} for i, w in enumerate(known)]})
            self.respond(200, result)
            return
        result = copy.deepcopy(SAMPLE)
        result['demo'] = True
        result['unknown'] = ['점검용 미지원 단어'] if scenario == 'unknown' else []
        self.respond(200, result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8085)
    parser.add_argument('--recognize-url', default=None, help='읽기 요청을 넘길 진짜 추론 서버 주소 (예: http://127.0.0.1:8000/recognize). localhost 만')
    args = parser.parse_args()
    if args.recognize_url:
        if not args.recognize_url.startswith(('http://127.0.0.1:', 'http://localhost:')):
            parser.error('--recognize-url 은 localhost 주소만 받습니다')
        RECOGNIZE_URL = args.recognize_url
        print(f'Recognize requests are forwarded to {RECOGNIZE_URL}', flush=True)
    print(f'Synthetic API only: http://127.0.0.1:{args.port}/api/sign/generate', flush=True)
    print('All text returns synthetic test data. No sign recognition or text storage.', flush=True)
    try:
        ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
