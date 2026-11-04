"""Verify a frozen train token handoff and a disposable CPU generator smoke run.

Uses only selected train token targets. No production training or deployment.
"""
import argparse
import json
from pathlib import Path
import tempfile
import time

import torch
import torch.nn.functional as F

from eval.evaluate_backtranslation import digest, read, write
from eval.guarded_train_word import check_files
from gen.model import MotionGPT
from gen.train_word import load_generator
from vq.model import load_vqvae


def batch_tensors(clips, classes, signers, pad, end):
    length = max(len(c['tokens']) for c in clips)
    inp = torch.full((len(clips), length), pad, dtype=torch.long)
    target = torch.full((len(clips), length + 1), -100, dtype=torch.long)
    for i, c in enumerate(clips):
        ids = torch.tensor(c['tokens'], dtype=torch.long)
        inp[i, :len(ids)] = ids
        target[i, :len(ids)] = ids
        target[i, len(ids)] = end
    return (torch.tensor([classes[c['item']] for c in clips]), inp,
            torch.tensor([signers[c['signer']] for c in clips]), target)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--tokens', required=True); ap.add_argument('--data', required=True)
    ap.add_argument('--vq', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args(); torch.set_num_threads(2); torch.manual_seed(0)
    tick = time.monotonic()
    tokens_path, data, vq, out = map(lambda p: Path(p).resolve(), (a.tokens, a.data, a.vq, a.out))
    assert not out.exists()
    tk, manifest, selected, binding = check_files(tokens_path, data, vq)
    protected_files = [tokens_path, tokens_path.parent/'manifest.json', vq/'model.pt', data/'meta.jsonl',
                       data/'split_snapshot.json', data/'classes.json']
    protected = {str(p): digest(p) for p in protected_files}
    # Stream hashes, never load held-out motions or retain all source arrays.
    for name, metadata in selected.items():
        if digest(data/'npy'/(name+'.npy')) != metadata['source_sha256']:
            raise ValueError('Training source changed since tokenization')
    clips = list(tk['clips'].values())
    classes = {w: i for i, w in enumerate(sorted({c['item'] for c in clips}))}
    signers = {s: i for i, s in enumerate(sorted({c['signer'] for c in clips}))}
    max_len = max(len(c['tokens']) for c in clips) + 8
    model = MotionGPT(len(classes), tk['nb_code'], 256, 4, max_len=max_len, n_signer=len(signers))
    # Include shortest and longest sequences to exercise padding and END targets.
    ordered = sorted(clips, key=lambda c: len(c['tokens']))
    sample = [ordered[i] for i in (0, len(ordered)//3, 2*len(ordered)//3, len(ordered)-1)]
    cond, inp, sig, target = batch_tensors(sample, classes, signers, model.pad, model.end)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-2)
    losses = []
    for _ in range(2):
        model.train(); logits = model(cond, inp, sig)
        assert logits.shape == (*target.shape, tk['nb_code'] + 1)
        loss = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), target.reshape(-1), ignore_index=-100)
        assert torch.isfinite(loss)
        opt.zero_grad(); loss.backward()
        assert all(p.grad is None or torch.isfinite(p.grad).all() for p in model.parameters())
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step()
        losses.append(loss.item())
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='smoke_only_', dir=out.parent) as temp:
        checkpoint = Path(temp)/'model.pt'
        ck = {'model': model.state_dict(), 'kind': 'gpt', 'classes': classes, 'signers': signers,
              'nb_code': tk['nb_code'], 'max_len': max_len, 'tokens': str(tokens_path),
              'config': {'d': 256, 'layers': 4}, 'smoke_only': True,
              'vq_version': tk['vq_version'], 'vq_sha256': manifest['model_sha256'],
              'tokens_sha256': manifest['tokens_sha256'], 'training_partition': 'train'}
        torch.save(ck, checkpoint)
        loaded, reloaded = load_generator(checkpoint)
        assert all(reloaded[k] == ck[k] for k in ('vq_version', 'vq_sha256', 'tokens_sha256', 'training_partition'))
        model.eval()
        with torch.inference_mode():
            assert torch.equal(model(cond, inp, sig), loaded(cond, inp, sig))
            generated = loaded.generate(cond[:1], signer=sig[:1], top_k=1, temperature=1., min_len=2)[0]
            assert len(generated) >= 2 and all(type(v) is int and 0 <= v < tk['nb_code'] for v in generated)
            decoder, _ = load_vqvae(vq/'model.pt')
            motion = decoder.decode(torch.tensor(generated)[None])
            assert motion.shape == (1, len(generated)*tk['down'], 375) and torch.isfinite(motion).all()
            output_shape = list(motion.shape)
    assert all(digest(p) == h for p, h in protected.items())
    report = {'binding': binding, 'source_hashes_rechecked': len(selected),
              'smoke_steps': 2, 'smoke_batch': 4, 'smoke_losses': losses,
              'gradient_finite': True, 'checkpoint_reload_equal': True,
              'decoded_output_shape': output_shape, 'generated_length': len(generated),
              'checkpoint_binding_preserved': True, 'disposable_checkpoint_removed': True,
              'protected_files_unchanged': True, 'seconds': time.monotonic()-tick,
              'production_training_started': False, 'serving_changed': False,
              'scope': 'Train-only loader guard and MotionGPT->VQ API compatibility; two disposable CPU updates are not a trained model or quality evaluation.',
              'protected_sha256': protected,
              'code_sha256': {str(p): digest(p) for p in (Path(__file__), Path(__file__).parents[1]/'gen/train_word.py', Path(__file__).parents[1]/'gen/model.py')}}
    with out.open('x') as stream: json.dump(report, stream, indent=2)
    print(json.dumps({k:v for k,v in report.items() if not k.endswith('sha256')}, indent=2))


if __name__ == '__main__':
    main()
