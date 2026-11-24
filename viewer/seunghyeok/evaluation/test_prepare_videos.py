#!/usr/bin/env python3
"""prepare_videos.py 조건 선택 검사. ffmpeg 시험 화면으로 만든 1초 합성 영상만 쓴다 (실제 동작·모델 결과 없음).

실행(프로젝트 루트 기준): python3 -I viewer/seunghyeok/evaluation/test_prepare_videos.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare_videos as P  # noqa: E402


def make_clip(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=30:duration=1',
                    '-c:v', 'libvpx', '-b:v', '200k', str(path)], check=True)


@unittest.skipIf(shutil.which('ffmpeg') is None or shutil.which('ffprobe') is None, 'ffmpeg/ffprobe 필요')
class PrepareVideosTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = Path(tempfile.mkdtemp(prefix='prepare-videos-test-'))
        cls.clip = cls.base / 'source.webm'
        make_clip(cls.clip)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.base, ignore_errors=True)

    def input_with(self, *conditions):
        root = Path(tempfile.mkdtemp(dir=self.base, prefix='in-'))
        for condition in conditions:
            (root / condition).mkdir()
            shutil.copy(self.clip, root / condition / 'sentence-01.webm')
        return root

    def run_package(self, root, conditions=P.DEFAULT_CONDITIONS):
        out = self.base / f'out-{root.name}'
        count = P.package(root, out, test_mode=True, conditions=conditions)
        return count, out, json.loads((out / 'private' / 'condition-map.json').read_text(encoding='utf-8'))

    def test_default_is_three_required_conditions(self):
        self.assertEqual(P.DEFAULT_CONDITIONS, ('B1', 'B2', 'Ours-H'))
        count, out, mapping = self.run_package(self.input_with('B1', 'B2', 'Ours-H'))
        self.assertEqual(count, 3)
        self.assertEqual(mapping['conditions'], ['B1', 'B2', 'Ours-H'])
        self.assertEqual(sorted(c['condition'] for c in mapping['clips']), ['B1', 'B2', 'Ours-H'])
        with zipfile.ZipFile(out / 'evaluation-videos.zip') as archive:
            self.assertEqual(sorted(archive.namelist()), ['001.webm', '002.webm', '003.webm'])
        credit = '한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'
        self.assertEqual(P.CREDIT, credit)
        self.assertEqual(mapping['credit'], credit)
        self.assertIn(f'출처: {credit}', (out / 'README.txt').read_text(encoding='utf-8'))

    def test_two_conditions_when_b2_missing(self):
        count, _, mapping = self.run_package(self.input_with('B1', 'Ours-H'), ('Ours-H', 'B1'))
        self.assertEqual(count, 2)
        self.assertEqual(mapping['conditions'], ['B1', 'Ours-H'])

    def test_four_conditions_opt_in(self):
        count, _, mapping = self.run_package(self.input_with(*P.CONDITIONS), P.CONDITIONS)
        self.assertEqual(count, 4)
        self.assertEqual(mapping['conditions'], list(P.CONDITIONS))

    def test_unselected_condition_folder_is_refused(self):
        root = self.input_with(*P.CONDITIONS)
        with self.assertRaisesRegex(ValueError, '고르지 않은 조건 폴더.*Ours-HF'):
            P.package(root, self.base / 'refused', test_mode=True)
        self.assertFalse((self.base / 'refused').exists())

    def test_missing_selected_folder_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'B2: 폴더가 없습니다'):
            P.package(self.input_with('B1', 'Ours-H'), self.base / 'missing', test_mode=True)

    def test_condition_list_validation(self):
        self.assertEqual(P.parse_conditions(' Ours-H , B1 '), ('B1', 'Ours-H'))
        for bad, message in [('B1,B3', '알 수 없는 조건: B3'), ('B1,B1', '두 번'), ('B1', '2개 이상'), ('', '2개 이상')]:
            with self.assertRaisesRegex(ValueError, message):
                P.parse_conditions(bad)

    def test_cli_default_and_bad_option(self):
        script = Path(P.__file__)
        root = self.input_with('B1', 'B2', 'Ours-H')
        ok = subprocess.run([sys.executable, '-I', str(script), '--input', str(root), '--output', str(self.base / 'cli'), '--test-mode'],
                            capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertIn('3개 영상 정리 완료', ok.stdout)
        bad = subprocess.run([sys.executable, '-I', str(script), '--input', str(root), '--output', str(self.base / 'cli-bad'),
                              '--test-mode', '--conditions', 'B1'], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        self.assertIn('2개 이상', bad.stderr)
        self.assertFalse((self.base / 'cli-bad').exists())

    def test_probe_falls_back_when_frame_rate_missing(self):
        # 브라우저 녹화 WebM은 avg_frame_rate가 "0/0"일 때가 있다 (2026-11-24 평가 녹화 40개 중 1개)
        from unittest import mock
        fake = {'streams': [{'codec_name': 'vp9', 'width': 1280, 'height': 960,
                             'avg_frame_rate': '0/0', 'nb_read_frames': '83'}],
                'format': {'duration': '2.716705'}}
        done = subprocess.CompletedProcess([], 0, stdout=json.dumps(fake), stderr='')
        with mock.patch.object(P.subprocess, 'run', return_value=done):
            info = P.probe(Path('Ours-H/sentence-01.webm'))
        self.assertEqual(info['frames'], 83)
        self.assertAlmostEqual(info['fps'], 83 / 2.716705, places=3)
        fake['format']['duration'] = '0'
        done = subprocess.CompletedProcess([], 0, stdout=json.dumps(fake), stderr='')
        with mock.patch.object(P.subprocess, 'run', return_value=done):
            with self.assertRaises(ValueError):
                P.probe(Path('Ours-H/sentence-01.webm'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
