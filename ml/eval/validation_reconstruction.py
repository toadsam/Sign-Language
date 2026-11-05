"""Freeze a paired E5 validation baseline, streaming REAL04/11 clips on CPU."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import time

import json
import numpy as np
import torch

from common.data import apply_split, load_split
from eval.analyze_reconstruction import geometry_metrics
from eval.evaluate_backtranslation import digest, read, write
from eval.review_reconstruction_hands import EDGES, hand_metrics
from recog.infer import Recognizer, validate_motion
from vq.model import load_vqvae


def bone_direction_error(a, b):
    """Directed bone-vector angle; includes global orientation and local articulation."""
    va=np.stack([a[:,v]-a[:,u] for u,v in EDGES],axis=1)
    vb=np.stack([b[:,v]-b[:,u] for u,v in EDGES],axis=1)
    na,nb=np.linalg.norm(va,axis=-1),np.linalg.norm(vb,axis=-1)
    valid=(na>1e-4)&(nb>1e-4)
    cos=np.sum(va*vb,axis=-1)/np.maximum(na*nb,1e-12)
    angles=np.degrees(np.arccos(np.clip(cos,-1,1)))
    return {'bone_direction_mae_deg':float(angles[valid].mean()) if valid.any() else None,
            'bone_direction_valid_fraction':float(valid.mean())}


def detailed_geometry(a,b,scale):
    a,b=a.reshape(-1,125,3),b.reshape(-1,125,3)
    result={'all':geometry_metrics(a,b,scale)}
    for side,root in (('left',13),('right',34)):
        aa=(a[:,root:root+21]-a[:,root:root+1])*scale*1000
        bb=(b[:,root:root+21]-b[:,root:root+1])*scale*1000
        result[side]={**hand_metrics(aa,bb),**bone_direction_error(aa,bb)}
    # Invalid geometric metrics must be explicit nulls rather than JSON NaN.
    return {side:{k:float(v) if v is not None and np.isfinite(v) else None for k,v in values.items()} for side,values in result.items()}


def aggregate_geometry(rows):
    return {side:{key:{'mean':float(np.mean(values)),'median':float(np.median(values)),
                            'valid_clips':len(values)}
                  for key in rows[0]['geometry'][side]
                  if (values:=[r['geometry'][side][key] for r in rows if r['geometry'][side][key] is not None])}
            for side in rows[0]['geometry']}


@torch.inference_mode()
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--recog',required=True)
    ap.add_argument('--vq',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--expected-vq-sha256',default='939540caac85f14dff7180f59b924c3000e65a1d413bf7edb85559a4e11c1e38',help='Explicitly pin a new candidate checkpoint hash; default is frozen E5.')
    args=ap.parse_args()
    torch.set_num_threads(2)
    started=time.monotonic()
    run,vqrun,out=map(lambda v:Path(v).resolve(),(args.recog,args.vq,args.out))
    out.mkdir(parents=True,exist_ok=False)
    recog=Recognizer(str(run))
    ck=recog.checkpoint; data=Path(ck['config']['data']); sp=ck['split']
    assert sp==load_split(data)==read(data/'split_snapshot.json')
    assert sp['mode']=='signer' and set(sp['signers']['val'])=={'REAL04','REAL11'}
    assert not set(sp['signers']['val']) & set(sp['signers']['train']+sp['signers']['test'])
    assert recog.classes==read(data/'classes.json')
    metas=[json.loads(l) for l in (data/'meta.jsonl').read_text().splitlines()]
    clips=apply_split(metas,sp)[1]
    audit=read(run/'audit.json')['metrics']['val']
    assert len(clips)==audit['clips']==5453
    assert len({m['clip'] for m in clips})==len(clips)
    assert all(m['item'] in recog.classes and m['label']=='ok' and .85<=m['dur_ratio']<1.5 and m['signer'] in ('REAL04','REAL11') for m in clips)
    files=[run/'model.pt',vqrun/'model.pt',data/'meta.jsonl',data/'classes.json',
           data/'split_snapshot.json',data/'preparation.json',data/'deduplication.json',
           Path(__file__).resolve().parents[1]/'splits/full.json']
    before={str(f):digest(f) for f in files}
    assert before[str(run/'model.pt')]=='3759b0cd788e268b0ce552e7367a840742aafc2f8a53b44607bafe9d29f6f01f'
    assert before[str(vqrun/'model.pt')]==args.expected_vq_sha256
    vq,vc=load_vqvae(vqrun/'model.pt')
    write(out/'provenance.json',{'arguments':vars(args),'started_utc':datetime.now(timezone.utc).isoformat(),
        'partition':'val','data':str(data),'device':'cpu','threads':2,'vq_config':vc,
        'protected_sha256':before,'script_sha256':digest(__file__),
        'helper_sha256':{name:digest(Path(__file__).parent/name) for name in ('review_reconstruction_hands.py','analyze_reconstruction.py','evaluate_backtranslation.py')},
        'protocol':'Full original control; paired original/reconstruction truncated to VQ down multiple; identical active and Recognizer.score pad=4; geometry on same active frames without pad',
        'geometry_aggregation':'Equal weight per clip; separate left/right; no DTW. Bone directions include orientation and articulation. Rotation fit has no scale/reflection.',
        'validation_use':'Baseline for candidate comparison. Recognizer was selected using this val; not independent final evidence. Historical VQ split snapshot unavailable.',
        'attribution':'한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'})
    rows=[]
    with (out/'rows.jsonl').open('x') as stream:
        for i,m in enumerate(clips,1):
            file=data/'npy'/(m['clip']+'.npy'); sha=digest(file)
            x,active=validate_motion(np.load(file,allow_pickle=False),m['active'])
            T=len(x)//vq.down*vq.down
            assert T>=max(vq.down,2)
            a=x[:T]; b=vq(torch.from_numpy(a)[None])[0][0].numpy()
            assert a.shape==b.shape and np.isfinite(b).all()
            act=(min(active[0],T-2),min(active[1],T-1))
            row={'clip':m['clip'],'item':m['item'],'signer':m['signer'],'source_sha256':sha,
                 'frames_removed':len(x)-T,'active_clamped':act!=active}
            for name,arr,window in (('full_orig',x,active),('orig',a,act),('recon',b,act)):
                words=[w for w,_ in recog.score(arr,window)['top5']]
                row[name]={'top5':words,'top1_correct':words[0]==m['item'],'top5_correct':m['item'] in words}
            row['geometry']=detailed_geometry(a[act[0]:act[1]+1],b[act[0]:act[1]+1],m['norm']['scale'])
            assert digest(file)==sha
            rows.append(row); stream.write(json.dumps(row,ensure_ascii=False,allow_nan=False)+'\n')
            if i%250==0 or i==len(clips):
                stream.flush(); print(json.dumps({'completed':i,'total':len(clips),'seconds':round(time.monotonic()-started,1)}),flush=True)
    result={'clips':len(rows),'evaluated_classes':len({m['item'] for m in clips}),
            'signers':dict(Counter(m['signer'] for m in clips)),'metrics':{},'by_signer':{},
            'geometry':aggregate_geometry(rows)}
    for name in ('full_orig','orig','recon'):
        counts={k:sum(r[name][k+'_correct'] for r in rows) for k in ('top1','top5')}
        result['metrics'][name]={**{k:v/len(rows) for k,v in counts.items()},**{'correct_'+k:v for k,v in counts.items()}}
    for k in ('top1','top5'):
        oc=result['metrics']['orig']['correct_'+k]; rc=result['metrics']['recon']['correct_'+k]
        lost=sum(r['orig'][k+'_correct'] and not r['recon'][k+'_correct'] for r in rows)
        gained=sum(not r['orig'][k+'_correct'] and r['recon'][k+'_correct'] for r in rows)
        result[k+'_lost']=lost; result[k+'_gained']=gained
        result[k+'_conditional_retention']=(oc-lost)/oc if oc else None
        result[k+'_accuracy_ratio']=rc/oc if oc else None
    for signer in ('REAL04','REAL11'):
        group=[r for r in rows if r['signer']==signer]
        result['by_signer'][signer]={'clips':len(group),'metrics':{name:{k:sum(r[name][k+'_correct'] for r in group)/len(group) for k in ('top1','top5')} for name in ('orig','recon')},'geometry':aggregate_geometry(group)}
    result['seconds']=time.monotonic()-started
    checks={'protected_hashes_unchanged':all(digest(f)==h for f,h in before.items()),
            'original_matches_audit':all(result['metrics']['full_orig'][k]==audit[k] for k in ('top1','top5')),
            'source_files_unchanged':True,'truncated_clips':sum(r['frames_removed']>0 for r in rows),
            'active_clamped_clips':sum(r['active_clamped'] for r in rows),
            'truncation_top1_changed':sum(r['orig']['top5'][0]!=r['full_orig']['top5'][0] for r in rows)}
    write(out/'checks.json',checks)
    assert checks['protected_hashes_unchanged'] and checks['original_matches_audit']
    write(out/'summary.json',result)
    print(json.dumps({k:v for k,v in result.items() if k not in ('geometry','by_signer')},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__': main()
