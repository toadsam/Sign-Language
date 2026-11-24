#!/usr/bin/env python3
"""문장 생성 API 응답 시간 재기 (설계서 IT-06: 새 문장 30건, 요청부터 재생 가능한 응답까지, P95 ≤ 3.0초).

  python3 tools/measure-generate-latency.py --base https://<배포 백엔드>  [--out 결과.json]

- 문장은 아래 SENTENCES 30개(길찾기 · 교통 · 일상, 승혁이 새로 지음. AI Hub 문장이 아님)를 차례로 한 번씩 보낸다.
  추론 서버는 일꾼 하나라 동시에 보내지 않는다(503 방지). 문장 사이 0.5초 쉰다.
- 응답의 좌표는 저장하거나 출력하지 않는다. 상태 · 걸린 시간 · 프레임 수 · 못 그린 낱말 수만 적는다.
- VM이 이미 켜져 데워진 상태에서 재면 "워밍" 값이다. 콜드 스타트는 서버를 껐다 켜야 해서 이 도구로 재지 않는다.
"""
import argparse
import json
import os
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.request

SENTENCES = [
    '지하철역이 어디에 있어요?', '버스를 타고 병원에 가요.', '이 길로 가면 학교가 나와요.', '택시를 어디서 타요?',
    '오늘 친구를 만나러 가요.', '화장실은 이층에 있어요.', '은행 옆에 우체국이 있어요.', '기차가 몇 시에 출발해요?',
    '공항까지 얼마나 걸려요?', '오른쪽으로 가세요.', '왼쪽으로 돌면 시장이 있어요.', '저는 회사에 버스로 가요.',
    '엄마와 함께 병원에 갔어요.', '약국이 어디예요?', '이 버스는 서울역에 가요?', '다음 역에서 내리세요.',
    '길을 잃어버렸어요.', '경찰서에 가고 싶어요.', '도서관은 몇 시에 문을 닫아요?', '집 주소를 알려 주세요.',
    '표를 어디서 사요?', '저는 커피를 좋아해요.', '식당에서 밥을 먹어요.', '친구와 공원에 가요.',
    '횡단보도를 건너세요.', '지하철 이호선을 타세요.', '비가 와서 택시를 탔어요.', '학교 앞에서 기다릴게요.',
    '버스 정류장까지 걸어가요.', '병원 예약을 했어요.',
]
PATH = '/api/sign/generate'


def ssl_context(cafile=None):
    # python.org 판 Python은 macOS 인증서를 모를 때가 있다(CERTIFICATE_VERIFY_FAILED). 시스템 묶음이 있으면 그것을 쓴다
    cafile = cafile or ('/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)
    return ssl.create_default_context(cafile=cafile)


def ask(base, text, timeout, ctx):
    body = json.dumps({'text': text}).encode('utf-8')
    req = urllib.request.Request(base.rstrip('/') + PATH, data=body, method='POST', headers={'Content-Type': 'application/json'})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            data = json.loads(r.read().decode('utf-8'))
            status = r.status
    except urllib.error.HTTPError as e:
        status, data = e.code, {}
        try:
            data = json.loads(e.read().decode('utf-8'))
        except ValueError:
            pass
    except (urllib.error.URLError, TimeoutError) as e:
        return {'status': None, 'ms': round((time.perf_counter() - t0) * 1000), 'error': f'{type(e).__name__}: {str(e)[:80]}'}
    ms = round((time.perf_counter() - t0) * 1000)
    out = {'status': status, 'ms': ms}
    if status == 200:
        out.update(frames=data.get('frames'), unknown=len(data.get('unknown') or []), source=data.get('source'))
    else:
        out['error'] = (data.get('error') or {}).get('code')
    return out


def p95(values):
    s = sorted(values)
    return s[max(0, -(-len(s) * 95 // 100) - 1)] if s else None


def main():
    p = argparse.ArgumentParser(description='문장 생성 API 응답 시간 (IT-06)')
    p.add_argument('--base', required=True, help='백엔드 주소 (예: https://...run.app)')
    p.add_argument('--timeout', type=float, default=15)
    p.add_argument('--pause', type=float, default=0.5)
    p.add_argument('--out', help='결과 JSON 경로 (문장 · 상태 · 시간만, 좌표 없음)')
    p.add_argument('--cafile', help='인증서 묶음 경로 (기본: /etc/ssl/cert.pem이 있으면 그것)')
    a = p.parse_args()
    ctx = ssl_context(a.cafile)
    rows = []
    for i, text in enumerate(SENTENCES, 1):
        r = ask(a.base, text, a.timeout, ctx)
        rows.append({'n': i, 'text': text, **r})
        print(f"{i:2d} {r.get('status')} {r['ms']:5d}ms frames={r.get('frames')} unknown={r.get('unknown')} {r.get('error') or ''}", flush=True)
        time.sleep(a.pause)
    ok = [r for r in rows if r.get('status') == 200 and (r.get('frames') or 0) > 0]
    all_ms = [r['ms'] for r in rows if r.get('status') is not None]
    ok_ms = [r['ms'] for r in ok]
    summary = {
        'requests': len(rows), 'status200': sum(r.get('status') == 200 for r in rows), 'withMotion': len(ok),
        'empty': sum(r.get('status') == 200 and not r.get('frames') for r in rows),
        'errors': {str(r.get('status')): sum(1 for x in rows if x.get('status') == r.get('status')) for r in rows if r.get('status') != 200},
        'p50Ms': statistics.median(all_ms) if all_ms else None, 'p95Ms': p95(all_ms), 'maxMs': max(all_ms) if all_ms else None,
        'p95MsWithMotion': p95(ok_ms), 'targetP95Ms': 3000, 'warm': True,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if a.out:
        with open(a.out, 'w', encoding='utf-8') as f:
            json.dump({'summary': summary, 'rows': rows, 'measuredAt': time.strftime('%Y-%m-%dT%H:%M:%S%z')}, f, ensure_ascii=False, indent=2)
    return 0 if all_ms else 1


if __name__ == '__main__':
    sys.exit(main())
