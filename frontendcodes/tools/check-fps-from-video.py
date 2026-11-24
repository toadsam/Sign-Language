#!/usr/bin/env python3
"""fps-from-video.py 검사: 합성 240fps 영상으로 갱신 수 · 늦은 갱신 · 건너뛴 장 수를 맞게 세는지 본다.

실제 화면 촬영이 아니라 ffmpeg으로 만든 흑백 네모 영상이다 (60Hz 화면을 240fps로 찍은 것처럼 화면 갱신 1번 = 영상 4장).
실행: python3 -I tools/check-fps-from-video.py
"""
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fps_from_video', HERE / 'fps-from-video.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def make_video(path, refreshes_per_frame, fps=240, size=32, slow_rise=False):
    """refreshes_per_frame[i] = i번째로 보인 동작 프레임이 60Hz 화면에 몇 번 머물렀는지. 색은 보인 프레임 번호의 홀짝.
    바뀌는 첫 장은 중간 밝기(액정 전환). slow_rise면 흑→백만 영상 3장에 걸쳐 천천히 바뀐다(방향마다 전환 속도가 다른 액정)."""
    frames = bytearray()
    previous = None
    for item in refreshes_per_frame:
        number, refreshes = item[:2]
        # 세 번째 값이 있으면 그 장은 끝까지 바뀌지 못하고 그 밝기에서 멈춘다 (한 화면 갱신만 보인 장)
        color = item[2] if len(item) > 2 else 235 if number % 2 else 20
        if previous is None or previous == color:
            ramp = []
        elif slow_rise and color > previous:
            ramp = [round(previous + (color - previous) * f) for f in (.25, .5, .75)]
        else:
            ramp = [round((previous + color) / 2)]
        for k in range(refreshes * 4):
            value = ramp[k] if k < len(ramp) else color
            frames += bytes([value]) * (size * size)
        previous = color
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray',
           '-s', f'{size}x{size}', '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', str(path)]
    subprocess.run(cmd, input=bytes(frames), check=True)


def measure(path, capture_fps=None):
    times, values = tool.read_brightness(str(path), '16:16:8:8', capture_fps=capture_fps)
    return tool.summarize(tool.transitions(times, values), capture_fps or tool.video_fps(str(path)))


def main():
    ok = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # 1. 고른 30fps: 동작 프레임 0~89를 화면 갱신 2번씩
        steady = tmp / 'steady.mp4'
        make_video(steady, [(n, 2) for n in range(90)], slow_rise=True)
        r = measure(steady)
        assert abs(r['updatesPerSecond'] - 30) < .2, r
        assert r['lateCycles'] == 0 and r['missedFramesEstimate'] == 0, r
        assert abs(r['medianFrameMs'] - 33.3) < 1 and abs(r['maxCycleMs'] - 66.7) < 1, r
        assert abs(r['videoFps'] - 240) < .1, r
        assert r['shortFrames'] == 0 and r['longFrames'] == 0, r
        ok += 1
        print('PASS 고른 30fps (흑→백 느린 전환 포함): 갱신 30/초 · 한 장 33.3ms · 늦은 바퀴 0')

        # 2. 한 장 건너뜀(40번이 안 보이고 39 → 41): 같은 홀짝 색이 두 배로 길게 보인다
        seq = [(n, 2) for n in range(90) if n != 40]
        skipped = tmp / 'skipped.mp4'
        make_video(skipped, seq)
        r = measure(skipped)
        assert r['lateCycles'] == 1 and r['missedFramesEstimate'] == 1, r
        assert abs(r['maxCycleMs'] - 100) < 2, r
        ok += 1
        print('PASS 한 장 건너뜀: 늦은 바퀴 1 · 빠진 장 1 · 최대 바퀴 100ms')

        # 3. 늦게 바뀐 장(20번이 화면 갱신 3번 = 50ms): 한 바퀴 83ms라 늦은 바퀴(90ms 초과)로 세지 않는다
        late = [(n, 3 if n == 20 else 2) for n in range(90)]
        latef = tmp / 'late.mp4'
        make_video(latef, late)
        r = measure(latef)
        assert r['lateCycles'] == 0, r
        assert abs(r['maxCycleMs'] - 83.3) < 2, r
        ok += 1
        print('PASS 50ms 머문 한 장: 한 바퀴 83ms · 늦은 바퀴 아님')

        # 4. 아이폰 슬로모션처럼 240fps로 찍은 것을 30fps 파일로 저장: --capture-fps 240 으로 실제 시각을 되살린다
        slow = tmp / 'slow.mp4'
        make_video(slow, [(n, 2) for n in range(90) if n != 50], fps=30)
        r = measure(slow, capture_fps=240)
        assert abs(r['updatesPerSecond'] - 30) < .6 and r['missedFramesEstimate'] == 1, r
        ok += 1
        print('PASS 8배 느린 파일 + --capture-fps 240: 갱신 약 30/초 · 빠진 장 1')

        # 5. 실제 촬영에서 본 모양: 7번이 50ms, 8번이 16.7ms만 보여 끝까지 검어지지 못하고(150) 다시 하얘진다.
        #    빠진 장이 아니라 고르지 않게 보인 것이므로 고른 영상과 바뀐 횟수가 같고 늦은 바퀴로 세지 않는다.
        brief = [(n, 2) for n in range(90)]
        brief[7], brief[8] = (7, 3), (8, 1, 150)
        brieff = tmp / 'brief.mp4'
        make_video(tmp / 'even.mp4', [(n, 2) for n in range(90)])
        make_video(brieff, brief)
        r = measure(brieff)
        assert r['changes'] == measure(tmp / 'even.mp4')['changes'] and r['lateCycles'] == 0 and r['missedFramesEstimate'] == 0, r
        assert r['shortFrames'] == 1 and r['longFrames'] == 1, r
        ok += 1
        print('PASS 16.7ms만 보인 장(끝까지 안 검어짐): 바뀐 횟수에 포함 · 빠진 장 0 · 짧은 장 1 · 긴 장 1')

        # 6. 흑백 차이가 없는 자리를 잘랐으면 측정을 거부한다
        flat = tmp / 'flat.mp4'
        make_video(flat, [(0, 60)])
        try:
            measure(flat)
        except RuntimeError as e:
            assert '구별할 수 없습니다' in str(e), e
            ok += 1
            print('PASS 흑백 차이 없음: 거부')
        else:
            raise AssertionError('흑백 차이가 없는 영상을 받아들였습니다')
    print(f'{ok}개 항목 통과. 합성 영상 검사이며 실제 화면 촬영 측정이 아닙니다.')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, subprocess.CalledProcessError, RuntimeError) as e:
        sys.exit(f'FAIL {e}')
