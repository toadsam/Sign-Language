#!/usr/bin/env python3
"""Extract VQ training viewer data without executing HTML or JavaScript."""
import argparse
import base64
import json
import math
import re
import struct
import tempfile
from pathlib import Path

PARTS = {'body': [0, 13], 'lhand': [13, 34], 'rhand': [34, 55], 'face': [55, 125]}


def read_viewer(path):
    if path.stat().st_size > 100_000_000:
        raise ValueError('100MB 이하 viewer.html을 사용하세요.')
    text = path.read_text(encoding='utf-8')
    marker = re.search(r'\bconst\s+DATA\s*=\s*', text)
    if not marker:
        raise ValueError('팀 viewer.html의 const DATA 선언을 찾을 수 없습니다.')
    value, end = json.JSONDecoder().raw_decode(text[marker.end():])
    if not text[marker.end()+end:].lstrip().startswith(';'):
        raise ValueError('JSON 데이터 뒤의 선언 형식이 다릅니다.')
    if not isinstance(value, dict) or value.get('parts') != PARTS:
        raise ValueError('125관절 부위 순서가 팀 형식과 다릅니다.')
    fps = value.get('fps')
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or not 0 < fps <= 240:
        raise ValueError('유효한 FPS가 필요합니다.')
    clips = value.get('clips')
    if not isinstance(clips, list) or not clips or len(clips) > 1000:
        raise ValueError('1~1000개 clips가 필요합니다.')
    return value


def motion(data, clip, key, demo):
    frames = clip.get('frames')
    if type(frames) is not int or not 1 <= frames <= 18000:
        raise ValueError('프레임 수가 올바르지 않습니다.')
    coordinates = clip.get(key)
    if not isinstance(coordinates, list) or len(coordinates) != frames * 125 * 3:
        raise ValueError(f'{key}: 프레임 수와 좌표 길이가 다릅니다.')
    if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or abs(n) > 100 for n in coordinates):
        raise ValueError(f'{key}: 유효하지 않은 좌표가 있습니다.')
    tokens = clip.get('tokens', [])
    if not isinstance(tokens, list) or any(type(n) is not int or n < 0 or n > 9007199254740991 for n in tokens):
        raise ValueError('토큰 번호가 올바르지 않습니다.')
    raw = struct.pack('<' + str(len(coordinates)) + 'f', *coordinates)
    return {'fps': data['fps'], 'joints': 125, 'frames': frames, 'units': 'shoulder',
            'data': base64.b64encode(raw).decode('ascii'),
            'tokens': tokens if key == 'recon' else [], 'segments': [], 'unknown': [],
            'source': 'model' if key == 'recon' else 'baseline', 'demo': demo}


def convert(input_path, output_path, index, demo=False):
    data = read_viewer(input_path)
    if not 0 <= index < len(data['clips']):
        raise ValueError('선택한 클립 번호가 범위를 벗어났습니다.')
    clip = data['clips'][index]
    if not isinstance(clip, dict):
        raise ValueError('클립 객체가 필요합니다.')
    original, reconstructed = motion(data, clip, 'orig', demo), motion(data, clip, 'recon', demo)
    output = output_path.resolve()
    if output.exists():
        raise ValueError('새 출력 폴더를 지정하세요. 기존 결과는 덮어쓰지 않습니다.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ai-viewer-', dir=output.parent) as temporary:
        stage = Path(temporary) / 'result'
        stage.mkdir()
        for filename, result in [('original.json', original), ('reconstructed.json', reconstructed)]:
            (stage / filename).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        manifest = {'schema': 'signlingo-viewer-conversion-v1', 'input': input_path.name,
                    'clipIndex': index, 'clipName': clip.get('name'), 'split': clip.get('split'),
                    'active': clip.get('active'), 'down': data.get('down'), 'demo': demo,
                    'files': {'original': 'original.json', 'reconstructed': 'reconstructed.json'},
                    'notes': ['현재 팀 VQ export의 관절 순서와 어깨너비 정규화를 전제로 합니다.',
                              '자막은 생성하지 않으며 active 구간을 자르거나 시작 시각을 변경하지 않습니다.',
                              '토큰은 reconstructed에만 포함합니다. baseline은 원본 참조를 표시하는 플레이어 출처 값입니다.',
                              '수치는 입력 HTML에 저장된 정밀도 그대로 float32로 변환합니다. 원본 정밀도를 복구하지 않습니다.']}
        (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        stage.rename(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--clip', type=int, default=0, help='0부터 시작하는 클립 번호')
    parser.add_argument('--list', action='store_true', help='클립 목록만 확인')
    parser.add_argument('--demo', action='store_true', help='합성 시험 입력인 경우 demo 표시')
    args = parser.parse_args()
    try:
        if args.list:
            for index, clip in enumerate(read_viewer(args.input)['clips']):
                if not isinstance(clip, dict):
                    raise ValueError('클립 객체가 필요합니다.')
                print(f"{index}: {clip.get('name', '(이름 없음)')} · {clip.get('split')} · {clip.get('frames')}프레임")
        else:
            if not args.output:
                raise ValueError('--output 새폴더를 지정하세요.')
            convert(args.input, args.output, args.clip, args.demo)
            print(f'변환 완료: {args.output}')
    except (OSError, ValueError, struct.error) as error:
        parser.exit(1, f'변환 실패: {error}\n')


if __name__ == '__main__':
    main()
