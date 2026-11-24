#!/usr/bin/env python3
"""export_motion_json.py 검사. 수식으로 만든 합성 동작만 쓴다 (AI Hub 좌표 · 모델 결과 없음).
출력 JSON을 비교 화면의 실제 해독 코드(frontendcodes/components/sign-player/motion.ts)에 넣어 좌표가 같게 돌아오는지도 본다.

실행(프로젝트 루트 기준): python3 -I viewer/seunghyeok/evaluation/test_export_motion_json.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import export_motion_json as E  # noqa: E402

FRONT = HERE.parents[2] / 'frontendcodes'
DECODE_JS = r"""
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require(path.join(process.argv[2],'node_modules','typescript'));
const src=fs.readFileSync(path.join(process.argv[2],'components/sign-player/motion.ts'),'utf8');
const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={};vm.runInNewContext(out,{exports:mod,atob,Uint8Array,DataView,Float32Array,Number,Math,Array,Error});
const r=mod.decodeMotion(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
console.log(JSON.stringify({frames:r.response.frames,source:r.response.source,first:Array.from(r.positions.slice(0,6)),last:r.positions[r.positions.length-1]}));
"""


def wave(frames, phase=0.0):
    t = np.arange(frames, dtype=np.float32)[:, None, None]
    j = np.arange(125, dtype=np.float32)[None, :, None]
    k = np.arange(3, dtype=np.float32)[None, None, :]
    return (0.5 * np.sin(0.1 * t + 0.01 * j + k + phase)).astype(np.float32)


class ExportMotionJsonTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='export-motion-json-test-'))
        self.addCleanup(shutil.rmtree, self.base, True)

    def write_manifest(self, clips, conditions=('B1', 'B2', 'Ours-H'), samples=1, flat=False):
        records = []
        for c, clip in enumerate(clips):
            specs = {}
            for i, condition in enumerate(conditions):
                names = []
                for s in range(samples):
                    name = f'{condition}/{clip}-{s}.npy'
                    (self.base / condition).mkdir(exist_ok=True)
                    motion = wave(40 + 10 * c + i, phase=s)
                    np.save(self.base / name, motion.reshape(len(motion), 375) if flat else motion)
                    names.append(name)
                specs[condition] = {'motions': names, 'fps': 30}
            records.append({'clip': clip, 'conditions': specs})
        path = self.base / 'generated.json'
        path.write_text(json.dumps({'records': records}), encoding='utf-8')
        return path

    def test_default_three_conditions_layout_and_map(self):
        manifest = self.write_manifest(['SEN0001_REAL03', 'SEN0002_REAL12'])
        out = self.base / 'out'
        self.assertEqual(E.export(manifest, out), 6)
        for condition in ('B1', 'B2', 'Ours-H'):
            self.assertEqual(sorted(p.name for p in (out / condition).iterdir()), ['sentence-01.json', 'sentence-02.json'])
        self.assertFalse((out / 'Ours-HF').exists())
        b1 = json.loads((out / 'B1' / 'sentence-02.json').read_text())
        ours = json.loads((out / 'Ours-H' / 'sentence-01.json').read_text())
        self.assertEqual((b1['source'], ours['source']), ('baseline', 'model'))
        self.assertEqual((b1['frames'], b1['joints'], b1['units'], b1['fps']), (50, 125, 'shoulder', 30))
        self.assertEqual((b1['tokens'], b1['segments'], b1['unknown']), ([], [], []))
        mapping = json.loads((out / 'private' / 'clip-map.json').read_text(encoding='utf-8'))
        self.assertEqual(mapping['conditions'], ['B1', 'B2', 'Ours-H'])
        self.assertEqual({(m['sentence'], m['clip']) for m in mapping['files']}, {(1, 'SEN0001_REAL03'), (2, 'SEN0002_REAL12')})
        credit = '한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'
        self.assertIn(f'출처: {credit}', (out / 'README.txt').read_text(encoding='utf-8'))
        self.assertEqual(mapping['credit'], credit)

    @unittest.skipIf(shutil.which('node') is None or not (FRONT / 'node_modules' / 'typescript').exists(), 'node + frontendcodes/node_modules 필요')
    def test_frontend_decoder_reads_same_coordinates(self):
        manifest = self.write_manifest(['SEN0001_REAL03'], flat=True)
        out = self.base / 'out'
        E.export(manifest, out, ('B1', 'Ours-H'))
        script = self.base / 'decode.cjs'
        script.write_text(DECODE_JS, encoding='utf-8')
        result = subprocess.run(['node', str(script), str(FRONT), str(out / 'Ours-H' / 'sentence-01.json')],
                                capture_output=True, text=True, cwd=FRONT)
        self.assertEqual(result.returncode, 0, result.stderr)
        decoded = json.loads(result.stdout)
        expected = np.load(self.base / 'Ours-H' / 'SEN0001_REAL03-0.npy').reshape(-1)
        self.assertEqual((decoded['frames'], decoded['source']), (len(expected) // 375, 'model'))
        np.testing.assert_allclose(decoded['first'], expected[:6], rtol=0, atol=0)
        self.assertEqual(decoded['last'], float(expected[-1]))

    def test_clip_order_sample_and_two_conditions(self):
        manifest = self.write_manifest(['A', 'B', 'C'], conditions=('B1', 'Ours-H'), samples=2)
        clips = self.base / 'clips.txt'
        clips.write_text('C\n\nA\n', encoding='utf-8')
        out = self.base / 'out'
        self.assertEqual(E.export(manifest, out, ('B1', 'Ours-H'), ['C', 'A'], sample=1), 4)
        mapping = json.loads((out / 'private' / 'clip-map.json').read_text(encoding='utf-8'))
        self.assertEqual(sorted({(m['sentence'], m['clip']) for m in mapping['files']}), [(1, 'C'), (2, 'A')])
        self.assertTrue(all(m['npy'].endswith('-1.npy') for m in mapping['files']))
        cli = subprocess.run([sys.executable, '-I', str(HERE / 'export_motion_json.py'), '--manifest', str(manifest),
                              '--output', str(self.base / 'cli'), '--conditions', 'B1,Ours-H', '--clips', str(clips)],
                             capture_output=True, text=True)
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertIn('4개 동작 JSON 변환 완료', cli.stdout)

    def test_refuses_bad_inputs_without_output(self):
        manifest = self.write_manifest(['A', 'B'], conditions=('B1', 'Ours-H'))
        cases = [
            (lambda o: E.export(manifest, o), 'B2 동작이 없습니다'),
            (lambda o: E.export(manifest, o, ('B1', 'Ours-H'), ['A', 'Z']), '없는 clip: Z'),
            (lambda o: E.export(manifest, o, ('B1', 'Ours-H'), ['A', 'A']), '두 번'),
            (lambda o: E.export(manifest, o, ('B1', 'Ours-H'), sample=1), '0번째|1번째가 없습니다'),
            (lambda o: E.export(manifest, o, ('B1',)), '2개 이상'),
        ]
        for i, (run, message) in enumerate(cases):
            out = self.base / f'bad-{i}'
            with self.assertRaisesRegex(ValueError, message):
                run(out)
            self.assertFalse(out.exists())
        exists = self.base / 'exists'
        exists.mkdir()
        with self.assertRaisesRegex(ValueError, '이미 있습니다'):
            E.export(manifest, exists, ('B1', 'Ours-H'))
        bad = self.base / 'bad.json'
        bad.write_text('{"records": [{"clip": "A"}, {"clip": "A"}]}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '중복'):
            E.export(bad, self.base / 'dup', ('B1', 'Ours-H'))

    def test_refuses_bad_motion_values(self):
        for i, (motion, message) in enumerate([
                (np.zeros((10, 124, 3), np.float32), '모양'),
                (np.zeros((0, 375), np.float32), '프레임 수'),
                (np.full((5, 125, 3), np.nan, np.float32), '유한'),
                (np.full((5, 125, 3), 150, np.float32), '절댓값')]):
            manifest = self.write_manifest([f'X{i}'], conditions=('B1', 'Ours-H'))
            np.save(self.base / 'Ours-H' / f'X{i}-0.npy', motion)
            out = self.base / f'motion-{i}'
            with self.assertRaisesRegex(ValueError, f'X{i} / Ours-H.*{message}'):
                E.export(manifest, out, ('B1', 'Ours-H'))
            self.assertFalse(out.exists())
        with self.assertRaisesRegex(ValueError, 'fps'):
            E.to_response(wave(3), 0, 'model')


if __name__ == '__main__':
    unittest.main(verbosity=2)
