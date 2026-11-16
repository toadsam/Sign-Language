#!/usr/bin/env python3
"""평가용 저장 동작(npy)을 비교 화면이 읽는 계약 ⑤ JSON으로 바꾼다. 모델을 돌리지 않고, 있는 파일만 옮긴다.

입력은 ml/eval/compare.py 와 같은 목록 파일이다:
  {"records": [{"clip": "...", "conditions": {"B1": {"motions": ["b1/x.npy", ...], "fps": 30, "boundaries": [...]}, ...}}]}
  motions 경로는 목록 파일이 있는 폴더 기준. npy 는 [T, 375] 또는 [T, 125, 3] float.

출력 (prepare_videos.py 입력 폴더와 같은 모양):
  <출력>/<조건>/sentence-NN.json   비교 화면의 "동작 JSON"에 넣는다
  <출력>/private/clip-map.json      문장 번호 ↔ 클립 ↔ 원본 npy. 평가 참가자에게 주지 않는다
  <출력>/README.txt

실행(프로젝트 루트 기준, 데이터가 있는 VM에서):
  python3 viewer/seunghyeok/evaluation/export_motion_json.py --manifest runs/generated.json --output /새출력폴더
  옵션: --conditions B1,Ours-H  --clips 클립목록.txt(한 줄에 clip 하나, 이 순서가 문장 번호)  --sample 0
"""
import argparse
import base64
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_videos import DEFAULT_CONDITIONS, parse_conditions  # noqa: E402

JOINTS = 125
MAX_FRAMES = 18000      # motion.ts decodeMotion 상한
MAX_ABS = 100.0         # motion.ts 좌표 절댓값 상한
MAX_SENTENCES = 99      # sentence-NN 두 자리
# B1은 실제 단어 클립을 이어 붙인 기준선이라 baseline, 나머지는 모델 결과.
SOURCE = {'B1': 'baseline', 'B2': 'model', 'Ours-H': 'model', 'Ours-HF': 'model'}


def to_response(motion, fps, source):
    """npy 배열 → 계약 ⑤ 응답 dict. 토큰 · 자막 구간은 저장 동작에 없으므로 비운다."""
    x = np.asarray(motion)
    if x.ndim == 2 and x.shape[1] == JOINTS * 3:
        x = x.reshape(len(x), JOINTS, 3)
    if x.ndim != 3 or x.shape[1:] != (JOINTS, 3):
        raise ValueError(f'동작 모양이 [T, 375] 또는 [T, 125, 3]이 아닙니다: {list(np.shape(motion))}')
    if not 1 <= len(x) <= MAX_FRAMES:
        raise ValueError(f'프레임 수가 1~{MAX_FRAMES} 밖입니다: {len(x)}')
    x = x.astype('<f4')
    if not np.isfinite(x).all() or np.abs(x).max() > MAX_ABS:
        raise ValueError(f'좌표에 유한하지 않거나 절댓값 {MAX_ABS:g}을 넘는 값이 있습니다.')
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not 0 < fps <= 240:
        raise ValueError(f'fps가 올바르지 않습니다: {fps}')
    return {'fps': fps, 'joints': JOINTS, 'frames': int(len(x)), 'units': 'shoulder',
            'data': base64.b64encode(x.tobytes()).decode('ascii'),
            'tokens': [], 'segments': [], 'unknown': [], 'source': source}


def plan(manifest_path, conditions, clips=None, sample=0):
    """목록을 읽어 (문장 번호, clip, 조건, npy 경로, fps) 계획을 만든다. 파일은 아직 읽지 않는다."""
    manifest_path = Path(manifest_path).resolve()
    try:
        records = json.loads(manifest_path.read_text(encoding='utf-8'))['records']
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError('목록 파일을 읽을 수 없거나 records가 없습니다.') from None
    if not isinstance(records, list) or not records:
        raise ValueError('records가 비어 있습니다.')
    by_clip = {}
    for record in records:
        clip = record.get('clip') if isinstance(record, dict) else None
        if not isinstance(clip, str) or not clip or clip in by_clip:
            raise ValueError(f'clip 이름이 없거나 중복됩니다: {clip!r}')
        by_clip[clip] = record
    order = list(by_clip) if clips is None else list(clips)
    if len(set(order)) != len(order):
        raise ValueError('클립 목록에 같은 clip이 두 번 있습니다.')
    missing = [c for c in order if c not in by_clip]
    if missing:
        raise ValueError(f'목록 파일에 없는 clip: {", ".join(missing)}')
    if not 1 <= len(order) <= MAX_SENTENCES:
        raise ValueError(f'문장은 1~{MAX_SENTENCES}개여야 합니다: {len(order)}개')
    if isinstance(sample, bool) or not isinstance(sample, int) or sample < 0:
        raise ValueError('--sample은 0 이상의 정수입니다.')
    jobs, problems = [], []
    for number, clip in enumerate(order, 1):
        specs = by_clip[clip].get('conditions') or {}
        for condition in conditions:
            spec = specs.get(condition)
            motions = spec.get('motions') if isinstance(spec, dict) else None
            if not isinstance(motions, list) or not motions:
                problems.append(f'{clip}: {condition} 동작이 없습니다.')
                continue
            if sample >= len(motions):
                problems.append(f'{clip}: {condition} 동작이 {len(motions)}개라 {sample}번째가 없습니다.')
                continue
            jobs.append({'sentence': number, 'clip': clip, 'condition': condition,
                         'npy': manifest_path.parent / motions[sample], 'fps': spec.get('fps', 30)})
    if problems:
        raise ValueError('\n'.join(problems))
    return jobs


def export(manifest_path, output, conditions=DEFAULT_CONDITIONS, clips=None, sample=0):
    conditions = parse_conditions(','.join(conditions))
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('출력 폴더가 이미 있습니다. 기존 파일을 보호하기 위해 새 폴더 이름을 사용해주세요.')
    jobs = plan(manifest_path, conditions, clips, sample)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sign-motion-json-', dir=output.parent) as temporary:
        stage = Path(temporary) / 'out'
        (stage / 'private').mkdir(parents=True)
        mapping = []
        for job in jobs:
            try:
                motion = np.load(job['npy'], allow_pickle=False)
                response = to_response(motion, job['fps'], SOURCE[job['condition']])
            except (OSError, ValueError) as error:
                raise ValueError(f'{job["clip"]} / {job["condition"]} ({job["npy"].name}): {error}') from None
            folder = stage / job['condition']
            folder.mkdir(exist_ok=True)
            name = f'sentence-{job["sentence"]:02d}.json'
            (folder / name).write_text(json.dumps(response, separators=(',', ':')), encoding='utf-8')
            mapping.append({'sentence': job['sentence'], 'clip': job['clip'], 'condition': job['condition'],
                            'file': f'{job["condition"]}/{name}', 'npy': str(job['npy']),
                            'frames': response['frames'], 'fps': response['fps'], 'source': response['source']})
        (stage / 'private' / 'clip-map.json').write_text(json.dumps({
            'manifest': str(Path(manifest_path).resolve()), 'conditions': list(conditions), 'sample': sample,
            'sentences': len({j['sentence'] for j in jobs}), 'files': mapping,
            'note': '문장 번호와 클립 대응표입니다. 평가 참가자에게 전달하지 마세요.'}, ensure_ascii=False, indent=2), encoding='utf-8')
        (stage / 'README.txt').write_text(
            '평가용 저장 동작을 비교 화면용 JSON(계약 ⑤)으로 바꾼 결과입니다. 모델을 새로 돌리지 않았습니다.\n'
            '<조건>/sentence-NN.json: 비교 화면(/sign-compare)의 동작 JSON 칸에 넣고, 칸별로 녹화한 영상을\n'
            '  같은 <조건>/sentence-NN.webm 이름으로 모은 뒤 prepare_videos.py로 묶습니다.\n'
            'private/clip-map.json: 문장 번호 ↔ 클립 대응표. 평가 참가자에게 주지 않습니다.\n'
            '주의: AI Hub 수어 데이터에서 나온 좌표입니다(B1은 실제 클립을 이어 붙인 것).\n'
            '  저장소에 커밋하거나 외부에 올리지 마세요. 토큰 · 자막 구간은 비어 있습니다.\n', encoding='utf-8')
        if output.exists():
            raise ValueError('출력 폴더가 작업 중 생성됐습니다. 덮어쓰지 않습니다.')
        shutil.move(str(stage), str(output))
    return len(jobs)


def main():
    parser = argparse.ArgumentParser(description='평가용 저장 동작(npy) → 비교 화면용 계약 ⑤ JSON (조건별 sentence-NN.json)')
    parser.add_argument('--manifest', required=True, type=Path, help='ml/eval/compare.py 와 같은 records 목록 파일')
    parser.add_argument('--output', required=True, type=Path, help='새로 만들 출력 폴더 (이미 있으면 거부)')
    parser.add_argument('--conditions', default=','.join(DEFAULT_CONDITIONS), help='쉼표로 구분, 2개 이상. 기본 B1,B2,Ours-H')
    parser.add_argument('--clips', type=Path, help='한 줄에 clip 하나. 이 순서가 문장 번호. 없으면 records 순서')
    parser.add_argument('--sample', type=int, default=0, help='조건마다 motions 중 몇 번째를 쓸지 (기본 0)')
    args = parser.parse_args()
    try:
        clips = None
        if args.clips:
            clips = [line.strip() for line in args.clips.read_text(encoding='utf-8').splitlines() if line.strip()]
        count = export(args.manifest, args.output, parse_conditions(args.conditions), clips, args.sample)
    except (ValueError, OSError) as error:
        parser.exit(1, f'변환 실패:\n{error}\n')
    print(f'{count}개 동작 JSON 변환 완료: {args.output}')


if __name__ == '__main__':
    main()
