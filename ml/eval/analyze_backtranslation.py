"""Diagnose frozen VQ losses without changing data, labels or selecting models."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch

from eval.analyze_reconstruction import geometry_metrics, prediction, restore_component
from eval.evaluate_backtranslation import digest, read, write
from recog.infer import Recognizer
from vq.model import load_vqvae


@torch.inference_mode()
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--evaluation', required=True)
    ap.add_argument('--old-recog', required=True)
    ap.add_argument('--old-evaluation', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    torch.set_num_threads(2)
    started = time.monotonic()
    evaluation, out = Path(args.evaluation), Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    provenance = read(evaluation/'provenance.json')
    root = evaluation.parents[3]
    resolve = lambda p: Path(p) if Path(p).is_absolute() else root/Path(p)
    protected = {str(resolve(p)): h for p,h in provenance['protected_sha256'].items()}
    assert all(digest(p)==h for p,h in protected.items())
    recog = Recognizer(str(resolve(provenance['arguments']['recog'])))
    old_recog = Recognizer(args.old_recog)
    protected[str(Path(args.old_recog)/'model.pt')] = digest(Path(args.old_recog)/'model.pt')
    assert protected[str(Path(args.old_recog)/'model.pt')]=='c94d9c7f287bff6af642245b5c7628c51277fc0b7b1e71281880911bfda5d52f'
    vq,_ = load_vqvae(resolve(provenance['arguments']['vq'])/'model.pt')
    data = Path(provenance['data'])
    metas = {m['clip']:m for m in (json.loads(s) for s in (data/'meta.jsonl').read_text().splitlines())}
    prior = [json.loads(s) for s in (evaluation/'rows.jsonl').read_text().splitlines()]
    old_eval = read(Path(args.old_evaluation)/'summary.json')
    old_ids = {r['clip'] for r in old_eval['rows']}
    assert len(old_ids)==979 and old_ids <= {r['clip'] for r in prior}
    narrow_idx = sorted(recog.classes[w] for w in old_recog.classes)
    modes = ('body','hands','left_hand','right_hand','wrist_trajectories','finger_shapes')
    rows, narrow = [], []
    confusions = Counter()
    label_names = {}
    for m in metas.values():
        if m['signer'] not in recog.checkpoint['split']['signers']['train']:
            continue
        label_names.setdefault(m['item'],Counter()).update(m.get('gloss',[]))
    with (out/'rows.jsonl').open('x') as stream:
        for i,old in enumerate(prior,1):
            m=metas[old['clip']]
            file=data/'npy'/(m['clip']+'.npy')
            assert digest(file)==old['source_sha256']
            x=np.load(file,allow_pickle=False).reshape(-1,375)
            T=len(x)//vq.down*vq.down
            a=x[:T]; b=vq(torch.from_numpy(a)[None])[0][0].numpy()
            active=(min(m['active'][0],T-2),min(m['active'][1],T-1))
            pa,pb=prediction(recog,a,active,m['item']),prediction(recog,b,active,m['item'])
            assert [v[0] for v in pa['top5']]==old['orig']['top5']
            assert [v[0] for v in pb['top5']]==old['recon']['top5']
            lost=old['orig']['top1_correct'] and not old['recon']['top1_correct']
            row={'clip':m['clip'],'item':m['item'],'signer':m['signer'],
                 'lost':lost,'orig_correct':old['orig']['top1_correct'],
                 'recon_correct':old['recon']['top1_correct'],
                 'original':pa,'reconstructed':pb,
                 'geometry':geometry_metrics(a[active[0]:active[1]+1],b[active[0]:active[1]+1],m['norm']['scale'])}
            if lost:
                row['restoration']={mode:prediction(recog,restore_component(a,b,mode),active,m['item']) for mode in modes}
                confusions[(m['item'],pb['top1'])]+=1
            if m['clip'] in old_ids:
                small={'clip':m['clip']}
                for name,arr in (('orig',a),('recon',b)):
                    full=recog.score(arr,active)
                    probs=full['probs']
                    idx=sorted(narrow_idx,key=lambda j:(-float(probs[j]),j))[:5]
                    words=[recog.items[j] for j in idx]
                    oldwords=[w for w,_ in old_recog.score(arr,active)['top5']]
                    small[name]={'new_3000':full['top5'][0][0]==m['item'],
                                 'new_restricted_500':words[0]==m['item'],
                                 'old_500':oldwords[0]==m['item']}
                narrow.append(small)
            rows.append(row)
            stream.write(json.dumps(row,ensure_ascii=False)+'\n')
            if i%250==0 or i==len(prior):
                stream.flush()
                print(json.dumps({'completed':i,'total':len(prior),'seconds':round(time.monotonic()-started,1)}),flush=True)
    losses=[r for r in rows if r['lost']]
    assert len(losses)==read(evaluation/'summary.json')['top1_lost']==1173
    aggregates={}
    for name,group in (('lost',losses),('retained',[r for r in rows if r['orig_correct'] and r['recon_correct']]),('all',rows)):
        aggregates[name]={'clips':len(group),'geometry':{k:{'mean':float(np.mean(v)),'median':float(np.median(v))} for k in group[0]['geometry'] if (v:=[r['geometry'][k] for r in group if r['geometry'][k] is not None])}}
    restriction={mode:{kind:sum(r[mode][kind] for r in narrow) for kind in narrow[0][mode]} for mode in ('orig','recon')}
    assert restriction['orig']['old_500']==979 and restriction['recon']['old_500']==950
    assert all(digest(p)==h for p,h in protected.items())
    ranks=Counter('2' if r['reconstructed']['truth_rank']==2 else '3-5' if r['reconstructed']['truth_rank']<=5 else '6-10' if r['reconstructed']['truth_rank']<=10 else '11-50' if r['reconstructed']['truth_rank']<=50 else '>50' for r in losses)
    names=lambda item:label_names[item].most_common(1)[0][0] if label_names.get(item) else item
    report={'clips':len(rows),'lost':len(losses),'lost_words':len({r['item'] for r in losses}),
            'lost_by_signer':dict(Counter(r['signer'] for r in losses)),
            'lost_truth_rank':dict(ranks),'restoration_recoveries':{mode:sum(r['restoration'][mode]['truth_rank']==1 for r in losses) for mode in modes},
            'not_recovered_by_hands':[r['clip'] for r in losses if r['restoration']['hands']['truth_rank']!=1],
            'top_confusions':[{'target':a,'prediction':b,'target_training_majority_gloss':names(a),'prediction_training_majority_gloss':names(b),'clips':n} for (a,b),n in confusions.most_common(20)],
            'aggregate':aggregates,'same_979_clip_comparison':restriction,
            'same_979_restriction_recovers':sum(not r['recon']['new_3000'] and r['recon']['new_restricted_500'] for r in narrow),
            'protected_hashes_unchanged':True,'seconds':time.monotonic()-started,
            'limitations':['Coordinate interventions are diagnostic hybrids; overlap and do not prove unique linguistic causes',
                           'Restricted 500 labels only isolates candidate competition within the new recognizer; different recognizers have different decision boundaries',
                           'Training-majority gloss is descriptive, not the actual test clip label or permission to merge WORD codes',
                           'Same-frame geometry, not DTW; original videos were not reviewed; exploratory test diagnostics must not select new settings',
                           'Historical E5 split snapshot unavailable'],
            'attribution':'한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'}
    write(out/'narrow_comparison.json',narrow)
    write(out/'summary.json',report)
    write(out/'provenance.json',{'arguments':vars(args),'protected_sha256':protected,'script_sha256':digest(__file__),'parent_evaluation':str(evaluation)})
    print(json.dumps({k:v for k,v in report.items() if k!='not_recovered_by_hands'},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    main()
