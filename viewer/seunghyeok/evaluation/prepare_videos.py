#!/usr/bin/env python3
"""Validate and anonymously package evaluation clips; never creates model results."""
import argparse
import json
import random
import re
import shutil
import subprocess
import tempfile
import zipfile
from fractions import Fraction
from pathlib import Path

CONDITIONS = ('B1', 'B2', 'Ours-H', 'Ours-HF')
EXTENSIONS = {'.mp4', '.webm'}


def collect(root, count):
    clips, problems = [], []
    for condition in CONDITIONS:
        folder = root / condition
        if not folder.is_dir():
            problems.append(f'{condition}: 폴더가 없습니다.')
            continue
        found = {}
        for path in sorted(folder.iterdir()):
            if path.name.startswith('.'):
                continue
            if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
                problems.append(f'{condition}/{path.name}: MP4 또는 WebM 영상만 넣어주세요.')
                continue
            match = re.fullmatch(r'sentence-(\d{2})', path.stem)
            if not match or not 1 <= int(match[1]) <= count:
                problems.append(f'{condition}/{path.name}: sentence-01부터 sentence-{count:02d}까지의 이름이 필요합니다.')
                continue
            sentence = int(match[1])
            if sentence in found:
                problems.append(f'{condition}: 문장 {sentence:02d} 영상이 중복됩니다.')
            else:
                found[sentence] = path
        for sentence in range(1, count + 1):
            if sentence not in found:
                problems.append(f'{condition}: 문장 {sentence:02d} 영상이 없습니다.')
            else:
                clips.append({'condition': condition, 'sentence': sentence, 'path': found[sentence]})
    if problems:
        raise ValueError('\n'.join(problems))
    return clips


def probe(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                             '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration',
                             '-of', 'json', str(path)], capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f'{path.name}: 영상을 읽을 수 없습니다.')
    try:
        data = json.loads(result.stdout)
        stream = data['streams'][0]
        info = {'codec': stream['codec_name'], 'width': int(stream['width']), 'height': int(stream['height']),
                'fps': float(Fraction(stream['avg_frame_rate'])), 'frames': int(stream['nb_read_frames']),
                'durationSeconds': float(data['format']['duration'])}
        if min(info['width'], info['height'], info['frames'], info['fps'], info['durationSeconds']) <= 0:
            raise ValueError()
        return info
    except (KeyError, IndexError, ValueError, ZeroDivisionError, TypeError):
        raise ValueError(f'{path.name}: 유효한 영상 프레임·재생 정보를 찾지 못했습니다.') from None


def package(root, output, test_mode=False):
    root, output = Path(root).resolve(), Path(output).resolve()
    if not root.is_dir():
        raise ValueError('입력 폴더를 찾을 수 없습니다.')
    if output.is_relative_to(root):
        raise ValueError('출력 폴더는 입력 폴더 바깥에 지정해주세요.')
    if output.exists():
        raise ValueError('출력 폴더가 이미 있습니다. 기존 파일을 보호하기 위해 새 폴더 이름을 사용해주세요.')
    if shutil.which('ffprobe') is None or shutil.which('ffmpeg') is None:
        raise ValueError('ffprobe와 ffmpeg 설치가 필요합니다.')
    count = 1 if test_mode else 20
    clips = collect(root, count)
    for clip in clips:
        clip['video'] = probe(clip['path'])
    if len({(c['video']['width'], c['video']['height']) for c in clips}) != 1:
        raise ValueError('영상 해상도가 서로 다릅니다. 같은 화면 크기로 준비해주세요.')
    random.SystemRandom().shuffle(clips)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Stage the complete package before exposing it. Input clips are never modified.
    with tempfile.TemporaryDirectory(prefix='sign-evaluation-', dir=output.parent) as temporary:
        stage = Path(temporary)
        public, private = stage / 'videos', stage / 'private'
        public.mkdir(); private.mkdir()
        mapping = []
        for number, clip in enumerate(clips, 1):
            filename = f'{number:03d}{clip["path"].suffix.lower()}'
            destination = public / filename
            result = subprocess.run(['ffmpeg', '-v', 'error', '-n', '-i', str(clip['path']),
                                     '-map', '0:v:0', '-c:v', 'copy', '-an', '-map_metadata', '-1',
                                     '-map_metadata:s:v', '-1', '-map_chapters', '-1', str(destination)],
                                    capture_output=True, text=True)
            if result.returncode:
                raise ValueError(f'{clip["condition"]}/문장 {clip["sentence"]:02d}: 영상 정리 실패. 입력 파일은 유지됩니다.')
            exported = probe(destination)
            if (exported['frames'], exported['width'], exported['height'], exported['codec']) != (
                    clip['video']['frames'], clip['video']['width'], clip['video']['height'], clip['video']['codec']):
                raise ValueError(f'{filename}: 정리 전후 영상 정보가 달라졌습니다.')
            mapping.append({'filename': filename, 'sentence': clip['sentence'], 'condition': clip['condition'],
                            'inputFile': str(clip['path']), 'video': exported})
        (private / 'condition-map.json').write_text(json.dumps({'testMode': test_mode, 'sentences': count,
            'conditions': list(CONDITIONS), 'clips': mapping,
            'note': '조건표는 승현에게 별도로 전달할 관리 자료입니다. 평가 참가자에게 전달하지 마세요.'}, ensure_ascii=False, indent=2), encoding='utf-8')
        # Shared archive contains only numbered clips, never the condition map.
        with zipfile.ZipFile(stage / 'evaluation-videos.zip', 'w', zipfile.ZIP_STORED) as archive:
            for video in sorted(public.iterdir()):
                archive.write(video, video.name)
        (stage / 'README.txt').write_text(
            ('기능 점검용 합성 입력 묶음입니다. 실제 평가 자료가 아닙니다.\n' if test_mode else '평가 영상 정리 결과입니다. 내용·시점·프레임 속도는 평가 전에 확인해주세요.\n') +
            'evaluation-videos.zip: 무작위 번호 영상만 포함.\nprivate/condition-map.json: 조건표. 승현에게 별도 전달할 자료이며 참가자 공유 ZIP에 포함되지 않습니다.\n' +
            '입력 파일은 보존했습니다. 영상은 재인코딩하지 않고 영상 트랙만 정리하며 오디오·컨테이너 메타데이터를 제외했습니다.\n' +
            '같은 원본 영상을 여러 조건으로 넣어도 모델 결과의 진위는 자동 검증할 수 없습니다. 정확한30fps/CFR 여부도 보장하지 않습니다.\n', encoding='utf-8')
        if output.exists():
            raise ValueError('출력 폴더가 작업 중 생성됐습니다. 덮어쓰지 않습니다.')
        shutil.move(str(stage), str(output))
    return len(clips)


def main():
    parser = argparse.ArgumentParser(description='20문장×4조건 영상 누락 검사 및 무작위 번호 정리')
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--test-mode', action='store_true', help='1문장×4조건으로 기능만 점검; 실제 평가용이 아님')
    args = parser.parse_args()
    try:
        count = package(args.input, args.output, args.test_mode)
    except (ValueError, OSError) as error:
        parser.exit(1, f'정리 실패:\n{error}\n')
    print(f'{count}개 영상 정리 완료: {args.output}')


if __name__ == '__main__':
    main()
