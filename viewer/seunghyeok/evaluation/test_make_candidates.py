#!/usr/bin/env python3
"""make_candidates.py 검사 (합성 records · 합성 npy만 사용).

실행: python3 -I viewer/seunghyeok/evaluation/test_make_candidates.py
"""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('make_candidates', HERE / 'make_candidates.py')
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)


def make_manifest(root):
    """문장 4개: 같은 단어 열을 여러 화자가, REAL03 없는 단어 열, 한 클립만 라벨이 다른 문장."""
    rows = [
        ('S1', 'REAL01', ['가', '나']), ('S1', 'REAL03', ['가', '나']), ('S1', 'REAL12', ['가', '나']),
        ('S2', 'REAL01', ['다', '라', '마']), ('S2', 'REAL12', ['다', '라', '마']),
        ('S3', 'REAL05', ['바', '사']),
        ('S9', 'REAL03', ['아', '자차', '카']), ('S9', 'REAL12', ['아', '자', '카']),
    ]
    records = []
    for i, (item, signer, gloss) in enumerate(rows):
        clip = f'{item}_{signer}'
        conds = {}
        for c, frames in (('B1', 30 + i), ('Ours-H', 40 + i)):
            rel = f'motions/{c}/{clip}.npy'
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            np.save(root / rel, np.zeros((frames, 125, 3), np.float32))
            conds[c] = {'motions': [rel], 'fps': 30}
        records.append({'clip': clip, 'item': item, 'signer': signer, 'gloss': gloss, 'conditions': conds})
    path = root / 'generated.json'
    path.write_text(json.dumps({'records': records}, ensure_ascii=False), encoding='utf-8')
    return path


def main():
    ok = 0
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        manifest = make_manifest(root)
        conds = ['B1', 'Ours-H']

        rows = mc.build(manifest, conds, ['REAL03', 'REAL12'])
        picks = {r['gloss']: r['clip'] for r in rows}
        assert len(rows) == 5, rows
        assert picks['가 나'] == 'S1_REAL03', picks
        assert picks['다 라 마'] == 'S2_REAL12', picks
        assert picks['바 사'] == 'S3_REAL05', picks
        ok += 1
        print('PASS 화자 순서: REAL03 → 없으면 REAL12 → 그 밖의 화자')

        rows = mc.build(manifest, conds, ['REAL03', 'REAL12'], ['S9_REAL12'])
        glosses = [r['gloss'] for r in rows]
        assert len(rows) == 4 and '아 자 카' not in glosses and '아 자차 카' in glosses, glosses
        assert [r['words'] for r in rows] == sorted(r['words'] for r in rows), rows
        ok += 1
        print('PASS --exclude: 라벨만 다른 클립을 빼면 그 단어 열이 사라지고 같은 문장의 다른 라벨은 남는다')

        row = next(r for r in rows if r['gloss'] == '가 나')
        assert row['clips'] == 3 and row['items'] == ['S1'] and row['frames'] == {'B1': 31, 'Ours-H': 41}, row
        ok += 1
        print('PASS 고른 클립의 조건별 프레임 수 · 같은 단어 열 클립 수')

        try:
            mc.build(manifest, conds, ['REAL03'], ['S9_REAL99'])
        except ValueError as e:
            assert 'S9_REAL99' in str(e), e
            ok += 1
            print('PASS 자료에 없는 클립을 빼라고 하면 거부 (이름 오타 방지)')
        else:
            raise AssertionError('없는 클립 제외를 받아들였습니다')

        out = root / 'out'
        mc.write(rows, out, conds)
        tsv = (out / 'candidates.tsv').read_text(encoding='utf-8').splitlines()
        clips = (out / 'clips_all.txt').read_text(encoding='utf-8').split()
        assert len(tsv) == 5 and len(clips) == 4 and 'S9_REAL12' not in clips, (tsv, clips)
        ok += 1
        print('PASS 후보 표 · 클립 목록 파일')
    print(f'{ok}개 항목 통과 (합성 자료).')


if __name__ == '__main__':
    try:
        main()
    except AssertionError as e:
        sys.exit(f'FAIL {e}')
