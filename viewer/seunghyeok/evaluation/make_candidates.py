#!/usr/bin/env python3
"""평가 문장 후보 표 만들기: generated.json(records)에서 단어 열마다 클립 하나를 고른다.

같은 단어 열(gloss)이면 문장 번호 · 화자가 달라도 B1 · Ours-H 동작이 같으므로(2026-11-23 지헌 자료로 확인),
평가 문장은 단어 열 기준으로 고르고 단어 열마다 클립 하나만 쓴다.
고르는 순서: --prefer 화자 순서(기본 REAL03 → REAL12, 지헌 11-23 답장) → 문장 번호 → 클립 이름.
--exclude 로 뺄 클립을 주면 묶기 전에 뺀다. 지헌 11-23: SEN0892_REAL12는 같은 문장의 라벨 차이(내리다 ↔ 차내리다)라
평가에서 빼고 단어 열 42개로 간다.

출력 (모두 --out 폴더 안):
  candidates.tsv  번호 · 낱말 수 · 글로스 · 고른 클립 · 같은 단어 열의 문장 번호 · 클립 수 · 조건별 프레임
  clips_all.txt   고른 클립 전체 (export_motion_json.py --clips 에 그대로 넣을 수 있다)
좌표는 읽기만 하고(프레임 수만 센다) 출력하지 않는다. 데이터가 있는 VM에서 돌린다.

실행: python3 make_candidates.py --manifest <generated.json> --out <폴더> [--conditions B1,Ours-H] [--prefer REAL03,REAL12] [--exclude SEN0892_REAL12]
"""
import argparse
import collections
import json
import sys
from pathlib import Path

import numpy as np


def gloss_key(record):
    g = record.get('gloss')
    return tuple(g) if isinstance(g, list) else tuple(str(g).split())


def build(manifest, conditions, prefer, exclude=()):
    manifest = Path(manifest).resolve()
    records = json.loads(manifest.read_text(encoding='utf-8'))['records']
    missing = set(exclude) - {r['clip'] for r in records}
    if missing:
        raise ValueError(f'뺄 클립이 자료에 없습니다: {", ".join(sorted(missing))}')
    records = [r for r in records if r['clip'] not in set(exclude)]
    rank = {signer: i for i, signer in enumerate(prefer)}
    groups = collections.defaultdict(list)
    for r in records:
        groups[gloss_key(r)].append(r)
    rows = []
    for gloss, rs in groups.items():
        rs.sort(key=lambda r: (rank.get(r.get('signer'), len(rank)), str(r.get('item')), r['clip']))
        pick = rs[0]
        frames = {}
        for c in conditions:
            spec = pick['conditions'].get(c)
            if not spec:
                raise ValueError(f'{pick["clip"]}: {c} 조건이 없습니다.')
            frames[c] = int(np.load(manifest.parent / spec['motions'][0], mmap_mode='r', allow_pickle=False).shape[0])
        rows.append({'words': len(gloss), 'gloss': ' '.join(gloss), 'clip': pick['clip'],
                     'items': sorted({str(r.get('item')) for r in rs}), 'clips': len(rs), 'frames': frames})
    rows.sort(key=lambda r: (r['words'], r['gloss']))
    return rows


def write(rows, out, conditions):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'clips_all.txt').write_text(''.join(r['clip'] + '\n' for r in rows), encoding='utf-8')
    head = ['번호', '낱말수', '글로스', '고른 클립', '같은 단어 열의 문장 번호', '클립 수'] + [f'{c} 프레임' for c in conditions]
    lines = ['\t'.join(head)]
    for i, r in enumerate(rows, 1):
        lines.append('\t'.join([str(i), str(r['words']), r['gloss'], r['clip'], ','.join(r['items']), str(r['clips'])] + [str(r['frames'][c]) for c in conditions]))
    (out / 'candidates.tsv').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main():
    p = argparse.ArgumentParser(description='평가 문장 후보 표 (단어 열마다 클립 하나)')
    p.add_argument('--manifest', required=True, type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--conditions', default='B1,Ours-H')
    p.add_argument('--prefer', default='REAL03,REAL12', help='같은 단어 열에서 먼저 고를 화자 순서 (쉼표로)')
    p.add_argument('--exclude', default='', help='뺄 클립 이름 (쉼표로). 예: SEN0892_REAL12')
    a = p.parse_args()
    conditions = [c.strip() for c in a.conditions.split(',') if c.strip()]
    try:
        prefer = [x.strip() for x in a.prefer.split(',') if x.strip()]
        exclude = [x.strip() for x in a.exclude.split(',') if x.strip()]
        rows = build(a.manifest, conditions, prefer, exclude)
        write(rows, a.out, conditions)
    except (ValueError, OSError, KeyError) as e:
        sys.exit(f'후보 표 실패: {e}')
    counts = dict(sorted(collections.Counter(r['words'] for r in rows).items()))
    print(f'단어 열 {len(rows)}개 · 낱말 수별 {counts} → {a.out}')


if __name__ == '__main__':
    main()
