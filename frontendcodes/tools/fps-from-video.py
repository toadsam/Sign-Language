#!/usr/bin/env python3
"""슬로모션으로 찍은 화면 영상에서 실제로 보인 동작 갱신 수를 센다 (표시 FPS, TC-VIEW-03).

재생 화면 주소에 ?fpsmark=1 을 붙이면 동작 프레임마다 흑백이 바뀌는 네모가 뜬다.
그 네모를 휴대폰 슬로모션(120fps 이상, 240fps 권장)으로 찍은 뒤 네모 자리만 잘라
밝기가 바뀐 순간(= 화면에 새 동작 프레임이 보인 순간)을 센다.

  python3 tools/fps-from-video.py 영상.MOV --crop 폭:높이:x:y [--capture-fps 240] [--start 초] [--duration 초]

--crop은 영상 화소 기준 네모 안쪽 영역이다 (ffmpeg crop 형식). 테두리(빨강)는 빼고 잡는다.
아이폰 슬로모션을 AirDrop으로 받으면 240fps로 찍은 것이 30fps 파일(8배 느림)로 저장된다.
이때는 --capture-fps 240 을 주면 영상 장 번호 ÷ 240 으로 실제 시각을 계산한다.
앞뒤의 보통 속도 구간은 --start/--duration(파일 시각 기준)으로 빼고 느린 구간만 잰다.

액정은 흑→백과 백→흑 바뀌는 속도가 달라 한 방향만 보면 간격이 번갈아 길고 짧다.
그래서 같은 방향 변화 사이(흑+백 한 바퀴 = 동작 2장, 30fps면 66.7ms)를 잰다.
네모는 프레임 번호의 홀짝만 보여 주므로 한 장이 건너뛰어지면 한 바퀴가 100ms(3장)로 늘어난다.
한 바퀴가 90ms(2.7장)를 넘으면 "늦은 바퀴"로 세고, 장 수로 반올림해 2를 뺀 만큼을 빠지거나 늦은 장으로 추정한다.
(한 장이 50ms 머문 정도는 한 바퀴 83ms라 세지 않는다. 기존 10초 점검의 1.5배 기준과 같다.)
영상 내용은 출력하지 않고 숫자 요약만 낸다.
"""
import argparse
import json
import re
import statistics
import subprocess
import sys

TARGET_FPS = 30.0


def read_brightness(video, crop, start=None, duration=None, capture_fps=None):
    """ffmpeg으로 잘라 낸 영역의 평균 밝기와 시각(초) 목록."""
    cmd = ['ffmpeg', '-hide_banner', '-nostats']
    if start is not None:
        cmd += ['-ss', str(start)]
    cmd += ['-i', video]
    if duration is not None:
        cmd += ['-t', str(duration)]
    cmd += ['-map', '0:v:0', '-vf', f'crop={crop},scale=1:1:flags=area,format=gray,showinfo',
            '-vsync', 'passthrough', '-f', 'rawvideo', '-']
    run = subprocess.run(cmd, capture_output=True)
    if run.returncode != 0:
        raise RuntimeError(run.stderr.decode('utf-8', 'replace').strip().splitlines()[-1])
    times = [float(t) for t in re.findall(rb'pts_time:\s*(-?[0-9.]+)', run.stderr)]
    if capture_fps:
        # 슬로모션 파일: 파일 시각 대신 장 번호 ÷ 실제 촬영 fps
        times = [i / capture_fps for i in range(len(times))]
    values = list(run.stdout)
    n = min(len(times), len(values))
    if n < 10:
        raise RuntimeError(f'읽은 영상 프레임이 {n}개뿐입니다. --crop과 구간을 확인하세요.')
    return times[:n], values[:n]


def video_fps(video):
    run = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=avg_frame_rate,r_frame_rate', '-of', 'json', video], capture_output=True, text=True)
    if run.returncode != 0:
        return None
    stream = (json.loads(run.stdout).get('streams') or [{}])[0]
    for key in ('avg_frame_rate', 'r_frame_rate'):
        num, _, den = str(stream.get(key, '0/0')).partition('/')
        if den and float(den) > 0 and float(num) > 0:
            return float(num) / float(den)
    return None


def transitions(times, values):
    """흑↔백이 바뀌기 시작한 시각과 방향.

    밝기가 꺾이는 지점(가장 밝은 점에서 내려가기 시작, 가장 어두운 점에서 올라가기 시작)을 센다.
    한 화면 갱신(60Hz면 16.7ms)만 보인 장은 액정이 끝까지 검어지거나 하얘지기 전에 다시 바뀌므로
    고정 문턱으로는 놓친다. 그래서 꺾인 폭이 밝기 범위의 25% 이상이면 바뀐 것으로 본다(작은 흔들림은 무시)."""
    ordered = sorted(values)
    low = ordered[int(len(ordered) * .1)]
    high = ordered[int(len(ordered) * .9) - 1]
    if high - low < 40:
        raise RuntimeError(f'밝기 차이가 {high - low}뿐이라 흑백 네모를 구별할 수 없습니다. --crop 위치를 확인하세요.')
    step = (high - low) * .25
    changes, trend = [], None
    ext_v, ext_t = values[0], times[0]
    for t, v in zip(times, values):
        if trend != 'falling' and v > ext_v or trend == 'falling' and v < ext_v:
            ext_v, ext_t = v, t
        if trend != 'falling' and ext_v - v >= step:
            if trend is not None:
                changes.append((ext_t, 'black'))
            trend, ext_v, ext_t = 'falling', v, t
        elif trend != 'rising' and v - ext_v >= step:
            if trend is not None:
                changes.append((ext_t, 'white'))
            trend, ext_v, ext_t = 'rising', v, t
    return changes


def summarize(changes, sample_fps=None):
    if len(changes) < 5:
        raise RuntimeError('색이 바뀐 순간이 5번보다 적습니다. 재생 중인 구간을 찍었는지 확인하세요.')
    budget = 1 / TARGET_FPS
    span = changes[-1][0] - changes[0][0]
    def cycles_of(direction):
        ts = [t for t, d in changes if d == direction]
        return [b - a for a, b in zip(ts, ts[1:])]
    # 흑→백 사이 한 바퀴에는 흰 구간과 검은 구간이 하나씩 들어 있어, 긴 구간 하나가 한 번만 세진다.
    # (양쪽 방향을 다 세면 같은 긴 구간이 두 번 잡힌다.) 가운값은 양쪽을 다 쓴다.
    cycles = cycles_of('white')
    late = [c for c in cycles if c > budget * 2.7]
    both = cycles + cycles_of('black')
    # 한 장이 머문 시간(바뀐 순간 사이). 30fps면 33.3ms. 23ms보다 짧거나 43ms보다 길면 고르지 않게 보인 장이다
    # (60Hz 화면에서 16.7ms나 50ms만 보인 장). 빠진 장은 아니지만 움직임이 살짝 덜컥일 수 있다.
    runs = [b[0] - a[0] for a, b in zip(changes, changes[1:])]
    return {
        'videoFps': round(sample_fps, 2) if sample_fps else None,
        'changes': len(changes),
        'spanSeconds': round(span, 3),
        # 화면에 새 그림(색 바뀜)이 보인 횟수 ÷ 시간
        'updatesPerSecond': round((len(changes) - 1) / span, 3),
        'medianFrameMs': round(statistics.median(both) / 2 * 1000, 1),
        'medianCycleMs': round(statistics.median(both) * 1000, 1),
        'maxCycleMs': round(max(both) * 1000, 1),
        'cycles': len(cycles),
        'lateCycles': len(late),
        'missedFramesEstimate': sum(max(0, round(c / budget) - 2) for c in late),
        'lateCycleThresholdMs': round(budget * 2.7 * 1000, 1),
        'shortFrames': sum(r < budget * .7 for r in runs),
        'longFrames': sum(r > budget * 1.3 for r in runs),
    }


def main():
    p = argparse.ArgumentParser(description='슬로모션 화면 영상에서 표시 FPS 세기')
    p.add_argument('video')
    p.add_argument('--crop', required=True, help='폭:높이:x:y (영상 화소, 흑백 네모 안쪽)')
    p.add_argument('--start', type=float)
    p.add_argument('--duration', type=float)
    p.add_argument('--capture-fps', type=float, help='슬로모션 실제 촬영 fps (예: 240). 주면 파일 시각 대신 장 번호로 시각을 계산')
    a = p.parse_args()
    fps = video_fps(a.video)
    try:
        times, values = read_brightness(a.video, a.crop, a.start, a.duration, a.capture_fps)
        result = summarize(transitions(times, values), a.capture_fps or fps)
    except (RuntimeError, OSError, ValueError) as e:
        sys.exit(f'측정 실패: {e}')
    if not a.capture_fps and fps and fps < 120:
        print(f'주의: 영상이 {fps:.0f}fps라 33ms 간격을 정확히 가르기 어렵습니다. 120fps 이상 슬로모션으로 찍으세요.', file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
