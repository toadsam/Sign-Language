"""Review paired val prediction changes without loading motions or test data."""
import argparse
import json
from collections import Counter
from pathlib import Path


def review(old, new):
    assert set(old) == set(new) and old
    groups = {'newly_correct': [], 'newly_wrong': []}
    signers = {}
    words = {}
    for clip, row in new.items():
        prior = old[clip]
        for field in ('item', 'signer', 'source_sha256', 'frames', 'segmented_orig'):
            assert row[field] == prior[field], (clip, field)
        a, b = prior['candidate_roundtrip'], row['candidate_roundtrip']
        delta = int(b['top1_correct']) - int(a['top1_correct'])
        signer = signers.setdefault(row['signer'], {'clips': 0, 'old_correct': 0, 'new_correct': 0})
        signer['clips'] += 1
        signer['old_correct'] += int(a['top1_correct'])
        signer['new_correct'] += int(b['top1_correct'])
        words[row['item']] = words.get(row['item'], 0) + delta
        if delta:
            group = 'newly_correct' if delta > 0 else 'newly_wrong'
            groups[group].append({'clip': clip, 'item': row['item'], 'signer': row['signer'],
                'original_correct': row['segmented_orig']['top1_correct'],
                'old_prediction': a['top5'][0], 'new_prediction': b['top5'][0],
                'old_rank': a['top5'].index(row['item'])+1 if row['item'] in a['top5'] else '>5',
                'new_rank': b['top5'].index(row['item'])+1 if row['item'] in b['top5'] else '>5'})
    summary = {'clips': len(new), 'by_signer': signers, 'groups': {},
               'word_net_changes': dict(Counter('improved' if n > 0 else 'regressed' if n < 0 else 'unchanged' for n in words.values())),
               'largest_word_regressions': sorted(((w, n) for w, n in words.items() if n < 0), key=lambda p: (p[1], p[0]))[:20],
               'test_used': False}
    for name, rows in groups.items():
        summary['groups'][name] = {'clips': len(rows), 'words': len({r['item'] for r in rows}),
            'original_correct': sum(r['original_correct'] for r in rows),
            'old_rank': dict(Counter(str(r['old_rank']) for r in rows)),
            'new_rank': dict(Counter(str(r['new_rank']) for r in rows))}
    return summary, groups


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--control', required=True); p.add_argument('--candidate', required=True); p.add_argument('--out', required=True)
    a = p.parse_args()
    sets = []
    for folder in (a.control, a.candidate):
        folder = Path(folder)
        assert json.loads((folder/'summary.json').read_text())['partition'] == 'val'
        rows = [json.loads(line) for line in (folder/'rows.jsonl').read_text().splitlines()]
        indexed = {r['clip']: r for r in rows}
        assert len(indexed) == len(rows)
        sets.append(indexed)
    summary, groups = review(*sets)
    out = Path(a.out); out.mkdir(exist_ok=False)
    (out/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    for name, rows in groups.items():
        (out/(name+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in rows))
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
