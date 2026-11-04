"""Diagnose validation-only token roundtrip losses with fixed models and scoring."""
import argparse
from collections import Counter
from pathlib import Path
import json
import time

import numpy as np
import torch

from eval.evaluate_backtranslation import digest,read,write
from eval.analyze_reconstruction import prediction,restore_component
from eval.review_reconstruction_hands import rotation_aligned
from vq.model import load_vqvae
from recog.infer import Recognizer


def restore_hand_component(original,reconstructed,component):
    """Diagnostic rigid fits, not a linguistically exact shape/orientation separation."""
    a=original.reshape(-1,125,3); b=reconstructed.reshape(-1,125,3).copy()
    for root in (13,34):
        aa=a[:,root:root+21]-a[:,root:root+1]
        bb=b[:,root:root+21]-b[:,root:root+1]
        if component=='shape_with_fitted_recon_orientation': changed=rotation_aligned(aa,bb)
        elif component=='recon_shape_with_fitted_orig_orientation': changed=rotation_aligned(bb,aa)
        else: raise ValueError(component)
        b[:,root:root+21]=changed+b[:,root:root+1]
    return b.reshape(-1,375).astype(np.float32)


@torch.inference_mode()
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--handoff',required=True); ap.add_argument('--out',required=True)
    args=ap.parse_args(); torch.set_num_threads(2); tick=time.monotonic()
    handoff,out=Path(args.handoff),Path(args.out); out.mkdir(exist_ok=False,parents=True)
    p=read(handoff/'provenance.json'); assert p['partition']=='val'
    protected=p['protected_sha256']; assert all(digest(f)==h for f,h in protected.items())
    candidate=Path(p['arguments']['candidate']); data=Path(p['data'])
    model,_=load_vqvae(candidate/'model.pt'); recog=Recognizer(p['arguments']['recog'])
    tokens=read(handoff/'tokens.json'); manifest=read(handoff/'manifest.json')
    assert digest(handoff/'tokens.json')==manifest['tokens_sha256']
    assert digest(candidate/'model.pt')==manifest['model_sha256']
    previous=[json.loads(l) for l in (handoff/'rows.jsonl').read_text().splitlines()]
    wrong=[r for r in previous if not r['candidate_roundtrip']['top1_correct']]
    lost=[r for r in wrong if r['segmented_orig']['top1_correct']]
    assert len(wrong)==1219 and len(lost)==1076
    modes=('body','hands','left_hand','right_hand','wrist_trajectories','finger_shapes',
           'shape_with_fitted_recon_orientation','recon_shape_with_fitted_orig_orientation')
    details=[]
    with (out/'losses.jsonl').open('x') as stream:
        for i,r in enumerate(lost,1):
            file=data/'npy'/(r['clip']+'.npy'); assert digest(file)==r['source_sha256']
            x=np.load(file,allow_pickle=False).reshape(-1,375)
            start,end=r['frames']; a=x[start:end]
            b=model.decode(torch.tensor(tokens['clips'][r['clip']]['tokens'])[None])[0].numpy()
            active=(0,len(a)-1)
            pa,pb=prediction(recog,a,active,r['item']),prediction(recog,b,active,r['item'])
            assert [w for w,_ in pb['top5']]==r['candidate_roundtrip']['top5']
            assert pa['truth_rank']==1
            item={'clip':r['clip'],'item':r['item'],'signer':r['signer'],'new_error_vs_e5':r['e5_roundtrip']['top1_correct'],
                  'reconstructed':pb,'restoration':{}}
            for mode in modes:
                changed=(restore_component(a,b,mode) if mode in modes[:6] else restore_hand_component(a,b,mode))
                pred=prediction(recog,changed,active,r['item'])
                item['restoration'][mode]={'truth_rank':pred['truth_rank'],'top1':pred['top1']}
            details.append(item); stream.write(json.dumps(item,ensure_ascii=False)+'\n')
            if i%200==0 or i==len(lost):
                stream.flush(); print(json.dumps({'completed':i,'total':len(lost),'seconds':round(time.monotonic()-tick,1)}),flush=True)
    def ranks(group):
        return dict(Counter(str(r['candidate_roundtrip']['top5'].index(r['item'])+1) if r['item'] in r['candidate_roundtrip']['top5'] else 'outside5' for r in group))
    confusion=Counter((r['item'],r['candidate_roundtrip']['top5'][0]) for r in wrong)
    report={'val_clips':len(previous),'wrong':len(wrong),'original_correct_but_lost':len(lost),'wrong_ranks':ranks(wrong),
            'lost_ranks':ranks(lost),'new_errors_vs_e5':sum(r['e5_roundtrip']['top1_correct'] for r in wrong),
            'restoration_recoveries':{mode:sum(r['restoration'][mode]['truth_rank']==1 for r in details) for mode in modes},
            'new_errors_recoveries':{mode:sum(r['new_error_vs_e5'] and r['restoration'][mode]['truth_rank']==1 for r in details) for mode in modes},
            'top_confusions':[{'target':a,'prediction':b,'clips':n} for (a,b),n in confusion.most_common(20)],
            'wrong_by_signer':dict(Counter(r['signer'] for r in wrong)),
            'protected_hashes_unchanged':all(digest(f)==h for f,h in protected.items()),'seconds':time.monotonic()-tick,
            'limitations':['Rigid-fit shape/orientation interventions can absorb some deformation; overlapping diagnostic groups are not causal proof.',
                           'Validation only; fixed recognizer, labels and crop protocol. No test-based setting selection or data relabeling.'],
            'attribution':'한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'}
    assert report['protected_hashes_unchanged']
    write(out/'summary.json',report); print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__': main()
