"""Evaluate a val-selected frozen VQ against its control on the same test token path.

CPU only. No training, token export, checkpoint selection, or deployment.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch

from common.data import apply_split, load_split
from eval.evaluate_backtranslation import digest, read, write
from gen.tokenize import segment
from recog.infer import Recognizer, validate_motion
from vq.model import load_vqvae

RECOG_SHA = '3759b0cd788e268b0ce552e7367a840742aafc2f8a53b44607bafe9d29f6f01f'
MODES = ('full_orig', 'segmented_orig', 'control', 'selected')


def summarize(rows):
    if not rows or len({r['clip'] for r in rows}) != len(rows):
        raise ValueError('Empty or duplicate evaluation clips')
    n = len(rows)
    metrics = {}
    for mode in MODES:
        metrics[mode] = {}
        for k in ('top1', 'top5'):
            hits = sum(r[mode][k + '_correct'] for r in rows)
            metrics[mode]['correct_' + k] = hits
            metrics[mode][k] = hits / n
    gains = sum(not r['control']['top1_correct'] and r['selected']['top1_correct'] for r in rows)
    losses = sum(r['control']['top1_correct'] and not r['selected']['top1_correct'] for r in rows)
    assert gains - losses == metrics['selected']['correct_top1'] - metrics['control']['correct_top1']
    by_signer = {}
    for signer in sorted({r['signer'] for r in rows}):
        group = [r for r in rows if r['signer'] == signer]
        by_signer[signer] = {'clips': len(group), **{
            mode: {'correct_top1': sum(r[mode]['top1_correct'] for r in group),
                   'top1': sum(r[mode]['top1_correct'] for r in group) / len(group)}
            for mode in ('control', 'selected')}}
    return {'partition': 'test', 'clips': n, 'metrics': metrics,
            'newly_correct': gains, 'newly_wrong': losses,
            'delta_top1_pp': 100 * (gains - losses) / n,
            'by_signer': by_signer}


def validate_selection(selection):
    """Verify the pre-test decision against the saved full-val summaries."""
    if selection.get('selection_partition') != 'val' or selection.get('selection_metric') != 'top1':
        raise ValueError('Selection must use val Top-1')
    scores = {}
    for name, info in selection['val_candidates'].items():
        summary_file = Path(info['summary_path'])
        if digest(summary_file) != info['summary_sha256']:
            raise ValueError('Validation evidence changed')
        s = read(summary_file)
        if s['partition'] != 'val' or s['clips'] != 5453 or not s['protected_hashes_unchanged']:
            raise ValueError('Invalid validation evidence')
        scores[name] = s['metrics']['candidate_roundtrip']['correct_top1']
        manifest = read(summary_file.parent / 'manifest.json')
        if manifest['model_sha256'] != info['model_sha256']:
            raise ValueError('Validation/model binding mismatch')
    chosen = selection['selected_id']
    if scores[chosen] != max(scores.values()):
        raise ValueError('Selected model is not the val Top-1 winner')
    if selection['control_id'] == chosen:
        raise ValueError('Control must differ from selected model')
    return {role: selection['val_candidates'][selection[role + '_id']]
            for role in ('control', 'selected')}


@torch.inference_mode()
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--selection', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    torch.set_num_threads(2)
    started = time.monotonic()
    selection_file = Path(a.selection).resolve()
    selection = read(selection_file)
    chosen = validate_selection(selection)
    data, recog_run, out = Path(selection['data']), Path(selection['recog']), Path(a.out)
    assert not out.exists()
    sp = read(data / 'split_snapshot.json')
    assert sp == load_split(data) and sp['mode'] == 'signer'
    assert set(sp['signers']['test']) == {'REAL03', 'REAL12'}
    groups = [set(sp['signers'][p]) for p in ('train', 'val', 'test')]
    assert all(not groups[i] & groups[j] for i in range(3) for j in range(i + 1, 3))
    metas = [json.loads(l) for l in (data / 'meta.jsonl').read_text().splitlines()]
    clips = apply_split(metas, sp)[2]
    assert len(clips) == len({m['clip'] for m in clips}) == 5907
    assert all(m['type'] == 'WORD' and m['label'] == 'ok' and .85 <= m['dur_ratio'] < 1.5 for m in clips)
    files = [selection_file, recog_run / 'model.pt', data / 'meta.jsonl', data / 'classes.json',
             data / 'split_snapshot.json', data / 'deduplication.json']
    files += [Path(i['model_path']) for i in chosen.values()]
    files += [Path(i['summary_path']) for i in selection['val_candidates'].values()]
    protected = {str(f): digest(f) for f in files}
    assert protected[str(recog_run / 'model.pt')] == RECOG_SHA
    models = {}
    for role, info in chosen.items():
        assert protected[info['model_path']] == info['model_sha256']
        models[role], _ = load_vqvae(info['model_path'])
    assert models['control'].down == models['selected'].down == 4
    recog = Recognizer(str(recog_run))
    assert recog.classes == read(data / 'classes.json') and recog.checkpoint['split'] == sp
    assert all(m['item'] in recog.classes for m in clips)
    audit = read(recog_run / 'audit.json')['metrics']['test']
    out.mkdir(parents=True, exist_ok=False)
    ml = Path(__file__).resolve().parents[1]
    write(out / 'provenance.json', {
        'started_utc': datetime.now(timezone.utc).isoformat(), 'arguments': vars(a),
        'selection': selection, 'protected_sha256': protected, 'partition': 'test',
        'code_sha256': {str(f): digest(f) for f in (Path(__file__), ml / 'gen/tokenize.py', ml / 'recog/infer.py', ml / 'vq/model.py')},
        'protocol': 'Same as token_handoff val: active +/-4 then down multiple, encode/decode, score whole cropped motion with active=None.',
        'device': 'cpu', 'threads': 2,
        'limitations': ['Test signers have been inspected in previous project stages; this is not a fresh untouched external test.',
                       'Historical E5 split snapshot unavailable; one seed and two test signers.'],
        'attribution': '한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'})
    rows = []; sources = hashlib.sha256()
    with (out / 'rows.jsonl').open('x') as stream:
        for i, m in enumerate(clips, 1):
            file = data / 'npy' / (m['clip'] + '.npy'); before = digest(file)
            x, active = validate_motion(np.load(file, allow_pickle=False), m['active'])
            assert len(x) == m['frames']
            start, end = segment({**m, 'x': x}, 4)
            crop = x[start:end]; assert len(crop) >= 4
            tensor = torch.from_numpy(crop)[None]
            row = {k: m[k] for k in ('clip', 'item', 'signer')}
            row.update({'frames': [start, end], 'source_sha256': before})
            arrays = {'full_orig': (x, active), 'segmented_orig': (crop, None)}
            for role, model in models.items():
                ids = model.encode(tensor)
                recon = model.decode(ids)[0].numpy()
                assert recon.shape == crop.shape and np.isfinite(recon).all()
                arrays[role] = (recon, None)
            for mode, (arr, act) in arrays.items():
                words = [w for w, _ in recog.score(arr, act)['top5']]
                row[mode] = {'top5': words, 'top1_correct': words[0] == m['item'], 'top5_correct': m['item'] in words}
            assert digest(file) == before
            sources.update((m['clip'] + before).encode())
            rows.append(row); stream.write(json.dumps(row) + '\n')
            if i % 500 == 0 or i == len(clips):
                stream.flush()
                print(json.dumps({'completed': i, 'total': len(clips), 'seconds': round(time.monotonic() - started, 1)}), flush=True)
    result = summarize(rows)
    assert all(result['metrics']['full_orig'][k] == audit[k] for k in ('top1', 'top5'))
    assert all(digest(f) == h for f, h in protected.items())
    result.update({'classes': len({m['item'] for m in clips}), 'seconds': time.monotonic() - started,
                   'protected_hashes_unchanged': True, 'full_original_matches_audit': True,
                   'source_manifest_sha256': sources.hexdigest(), 'selection_changed_using_test': False,
                   'deployed': False})
    write(out / 'summary.json', result)
    print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    main()
