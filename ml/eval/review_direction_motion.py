"""Paired hand diagnostics for priority validation regressions; CPU only."""
import json
from pathlib import Path
import numpy as np
import torch
from eval.evaluate_backtranslation import digest, read, write
from eval.analyze_reconstruction import prediction, restore_component, geometry_metrics
from eval.analyze_token_errors import restore_hand_component
from eval.review_reconstruction_hands import hand_metrics
from vq.model import load_vqvae
from recog.infer import Recognizer

@torch.inference_mode()
def main():
    torch.set_num_threads(2)
    base=Path('runs/vq_direction_20261101')
    dirs=[Path('runs/vq_hand_pair_20261101/token_handoff/val'),base/'val']
    rows=[{r['clip']:r for r in map(json.loads,(d/'rows.jsonl').read_text().splitlines())} for d in dirs]
    old,new=rows
    selected=[c for c,r in new.items() if old[c]['candidate_roundtrip']['top1_correct'] and not r['candidate_roundtrip']['top1_correct'] and (not r['candidate_roundtrip']['top5_correct'] or r['item'] in ('WORD0314','WORD2690'))]
    out=base/'motion_review'; out.mkdir(exist_ok=False)
    prov=[read(d/'provenance.json') for d in dirs]
    assert all(p['partition']=='val' for p in prov)
    protected={k:v for p in prov for k,v in p['protected_sha256'].items()}
    assert all(digest(f)==h for f,h in protected.items())
    models=[load_vqvae(Path(p['arguments']['candidate'])/'model.pt')[0] for p in prov]
    tokens=[read(d/'tokens.json') for d in dirs]
    for d,t,p in zip(dirs,tokens,prov):
        m=read(d/'manifest.json')
        assert digest(d/'tokens.json')==m['tokens_sha256']
        assert digest(Path(p['arguments']['candidate'])/'model.pt')==m['model_sha256']
    data=Path(prov[1]['data']); recog=Recognizer(prov[1]['arguments']['recog'])
    metas={m['clip']:m for m in map(json.loads,(data/'meta.jsonl').read_text().splitlines())}
    modes=('body','hands','left_hand','right_hand','wrist_trajectories','finger_shapes','shape_with_fitted_recon_orientation','recon_shape_with_fitted_orig_orientation')
    reports=[]
    for c in selected:
        r=new[c]; m=metas[c]; f=data/'npy'/(c+'.npy')
        assert digest(f)==r['source_sha256']==old[c]['source_sha256']
        assert r['frames']==old[c]['frames']
        start,end=r['frames']; a=np.load(f,allow_pickle=False).reshape(-1,375)[start:end]
        report={'clip':c,'item':r['item'],'outside5':not r['candidate_roundtrip']['top5_correct'],'original_correct':r['segmented_orig']['top1_correct'],'models':{}}
        for label,model,t,rr in zip(('control','direction'),models,tokens,rows):
            b=model.decode(torch.tensor(t['clips'][c]['tokens'])[None])[0].numpy()
            pred=prediction(recog,b,None,r['item'])
            assert [w for w,_ in pred['top5']]==rr[c]['candidate_roundtrip']['top5']
            metric=geometry_metrics(a,b,m['norm']['scale'])
            hands={}
            for side,root in (('left',13),('right',34)):
                aa=a.reshape(-1,125,3); bb=b.reshape(-1,125,3)
                scale=m['norm']['scale']*1000
                hands[side]=hand_metrics((aa[:,root:root+21]-aa[:,root:root+1])*scale,(bb[:,root:root+21]-bb[:,root:root+1])*scale)
            interventions={}
            for mode in modes:
                changed=restore_component(a,b,mode) if mode in modes[:6] else restore_hand_component(a,b,mode)
                interventions[mode]=prediction(recog,changed,None,r['item'])['truth_rank']
            report['models'][label]={'truth_rank':pred['truth_rank'],'prediction':pred['top1'],'geometry':metric,'hands':hands,'restoration_rank':interventions}
        reports.append(report)
    assert all(digest(f)==h for f,h in protected.items())
    summary={'cases':len(reports),'outside5':sum(r['outside5'] for r in reports),'protected_hashes_unchanged':True,
      'original_correct':sum(r['original_correct'] for r in reports),
      'candidate_restored_top1':{mode:sum(r['models']['direction']['restoration_rank'][mode]==1 for r in reports) for mode in modes},
      'geometry_worsened_cases':{key:sum(r['models']['direction']['geometry'][key]>r['models']['control']['geometry'][key] for r in reports) for key in ('body_mm','hands_mm','wrists_mm','finger_shape_mm')},
      'test_used':False,'limitations':'Priority cases only, overlapping interventions; rigid fits mix shape/orientation and do not prove linguistic errors.',
      'attribution':'한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'}
    write(out/'details.json',reports); write(out/'summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    for r in reports:
        print(json.dumps({'clip':r['clip'],'old_rank':r['models']['control']['truth_rank'],'new_rank':r['models']['direction']['truth_rank'],'recovered_by':[k for k,v in r['models']['direction']['restoration_rank'].items() if v==1]},ensure_ascii=False))

if __name__=='__main__': main()
