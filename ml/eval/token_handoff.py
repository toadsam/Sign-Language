"""Build version-bound train/val tokens and evaluate the real segmented token path.

All derived data stays in the personal server folder; only numeric summaries print.
The shared generator and VQ implementations are imported without edits.
"""
import argparse
from collections import Counter
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch

from common.data import apply_split,load_split
from eval.evaluate_backtranslation import digest,read,write
from gen.tokenize import segment
from recog.infer import Recognizer,validate_motion
from vq.model import load_vqvae

CANDIDATE_SHA='79078e288eb3711b5ea08fa9ef8246b66998134d0474616e4454aa8b7a8e94df'
E5_SHA='939540caac85f14dff7180f59b924c3000e65a1d413bf7edb85559a4e11c1e38'


def selected_metadata(metas,sp,partition):
    rows=apply_split(metas,sp)[{'train':0,'val':1}[partition]]
    if not rows or len({m['clip'] for m in rows})!=len(rows): raise ValueError('Empty or duplicate clip set')
    if not all(m['type']=='WORD' and m['label']=='ok' and .85<=m['dur_ratio']<1.5 for m in rows):
        raise ValueError('Quality policy mismatch')
    return rows


def token_header(vq_path,config,down):
    version=config.get('vq_version')
    if not isinstance(version,str) or not version.strip(): raise ValueError('Decoder version missing')
    return {'vq':str(Path(vq_path).resolve()),'vq_version':version,
            'nb_code':config['nb_code'],'down':down,'clips':{}}


@torch.inference_mode()
def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--partition',choices=('train','val'),required=True)
    ap.add_argument('--candidate',required=True); ap.add_argument('--data',required=True)
    ap.add_argument('--recog',required=True); ap.add_argument('--baseline',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--expected-candidate-sha',default=CANDIDATE_SHA)
    ap.add_argument('--candidate-id',default='vq_hand_pair_20261101_lam2_79078e28')
    args=ap.parse_args(); torch.set_num_threads(2)
    started=time.monotonic()
    candidate,data,recog_run,baseline,out=map(lambda v:Path(v).resolve(),(args.candidate,args.data,args.recog,args.baseline,args.out))
    out.mkdir(parents=True,exist_ok=False)
    sp=read(data/'split_snapshot.json'); assert sp==load_split(data)
    assert set(sp['signers']['val'])=={'REAL04','REAL11'}
    assert set(sp['signers']['test'])=={'REAL03','REAL12'}
    groups=[set(sp['signers'][p]) for p in ('train','val','test')]
    assert all(not groups[i]&groups[j] for i in range(3) for j in range(i+1,3))
    metas=[json.loads(l) for l in (data/'meta.jsonl').read_text().splitlines()]
    clips=selected_metadata(metas,sp,args.partition)
    assert len(clips)=={'train':34498,'val':5453}[args.partition]
    files=[candidate/'model.pt',data/'meta.jsonl',data/'split_snapshot.json',data/'classes.json',data/'deduplication.json',recog_run/'model.pt']
    if args.partition=='val': files.append(baseline/'model.pt')
    protected={str(f):digest(f) for f in files}
    assert protected[str(candidate/'model.pt')]==args.expected_candidate_sha
    model,config=load_vqvae(candidate/'model.pt')
    tokens=token_header(candidate,config,model.down)
    classes=read(data/'classes.json')
    assert all(m['item'] in classes for m in clips)
    if args.partition=='val':
        assert protected[str(baseline/'model.pt')]==E5_SHA
        old_model,_=load_vqvae(baseline/'model.pt')
        assert old_model.down==model.down
        recog=Recognizer(str(recog_run))
        assert recog.classes==classes and recog.checkpoint['split']==sp
    rows=[]; forward_checks=0; max_forward_error=0.
    counts={k:Counter() for k in ('full_orig','segmented_orig','e5_roundtrip','candidate_roundtrip')}
    sources=hashlib.sha256()
    write(out/'provenance.json',{'arguments':vars(args),'started_utc':datetime.now(timezone.utc).isoformat(),
        'protected_sha256':protected,'script_sha256':digest(__file__),
        'segment_sha256':digest(Path(__file__).parents[1]/'gen/tokenize.py'),
        'protocol':'Existing gen.tokenize.segment (active +/-4 frames then down multiple), encode/decode token ids, score whole cropped original/reconstruction without extra active cropping.',
        'partition':args.partition,'data':str(data),'device':'cpu','threads':2,
        'attribution':'한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'})
    with (out/'rows.jsonl').open('x') as stream:
        for i,m in enumerate(clips,1):
            file=data/'npy'/(m['clip']+'.npy'); sha=digest(file)
            x,active=validate_motion(np.load(file,allow_pickle=False),m['active'])
            assert len(x)==m['frames']
            start,end=segment({**m,'x':x},model.down)
            if end-start<model.down: raise ValueError(f"Empty token segment: {m['clip']}")
            crop=x[start:end]; tensor=torch.from_numpy(crop)[None]
            ids=model.encode(tensor)
            assert ids.ndim==2 and ids.shape==(1,len(crop)//model.down)
            assert int(ids.min())>=0 and int(ids.max())<config['nb_code']
            tokens['clips'][m['clip']]={'item':m['item'],'signer':m['signer'],'type':m['type'],'frames':[start,end],'tokens':ids[0].tolist()}
            row={'clip':m['clip'],'item':m['item'],'signer':m['signer'],'source_sha256':sha,'frames':[start,end],'token_length':ids.shape[1]}
            if args.partition=='val':
                recon=model.decode(ids)[0].numpy()
                old_ids=old_model.encode(tensor); old_recon=old_model.decode(old_ids)[0].numpy()
                assert recon.shape==old_recon.shape==crop.shape
                assert np.isfinite(recon).all() and np.isfinite(old_recon).all()
                if i==1 or i%500==0:
                    direct=model(tensor)[0][0].numpy()
                    error=float(np.max(np.abs(direct-recon))); max_forward_error=max(max_forward_error,error)
                    assert np.allclose(direct,recon,atol=1e-5,rtol=1e-5)
                    forward_checks+=1
                for name,arr,window in (('full_orig',x,active),('segmented_orig',crop,None),('e5_roundtrip',old_recon,None),('candidate_roundtrip',recon,None)):
                    words=[w for w,_ in recog.score(arr,window)['top5']]
                    row[name]={'top5':words,'top1_correct':words[0]==m['item'],'top5_correct':m['item'] in words}
                    counts[name]['top1']+=words[0]==m['item']; counts[name]['top5']+=m['item'] in words
            assert digest(file)==sha; sources.update((m['clip']+sha).encode())
            rows.append(row); stream.write(json.dumps(row,ensure_ascii=False)+'\n')
            if i%500==0 or i==len(clips):
                stream.flush(); print(json.dumps({'partition':args.partition,'completed':i,'total':len(clips),'seconds':round(time.monotonic()-started,1)}),flush=True)
    assert all(digest(f)==h for f,h in protected.items())
    token_path=out/'tokens.json'; write(token_path,tokens)
    manifest={'partition':args.partition,'data':str(data),'clips':len(clips),'vq_version':tokens['vq_version'],
        'candidate_id':args.candidate_id,'model_sha256':args.expected_candidate_sha,
        'tokens_sha256':digest(token_path),'meta_sha256':digest(data/'meta.jsonl'),
        'split_sha256':digest(data/'split_snapshot.json'),'classes_sha256':digest(data/'classes.json'),
        'source_manifest_sha256':sources.hexdigest(),'segment_sha256':digest(Path(__file__).parents[1]/'gen/tokenize.py'),
        'signers':sorted({m['signer'] for m in clips}),
        'training_entrypoint':'python -m eval.guarded_train_word; do not pass val tokens to training'}
    write(out/'manifest.json',manifest)
    summary={'partition':args.partition,'clips':len(clips),'classes':len({m['item'] for m in clips}),
        'signers':dict(Counter(m['signer'] for m in clips)),'token_length':{'min':min(r['token_length'] for r in rows),'max':max(r['token_length'] for r in rows),'mean':float(np.mean([r['token_length'] for r in rows]))},
        'protected_hashes_unchanged':True,'seconds':time.monotonic()-started,
        'forward_decode_checks':forward_checks,'max_forward_decode_error':max_forward_error,
        'scope':'WORD-only; validation checkpoint selection is not independent final evaluation; historical E5 split snapshot unavailable.'}
    if args.partition=='val':
        summary['metrics']={name:{**{k:v/len(clips) for k,v in c.items()},**{'correct_'+k:v for k,v in c.items()}} for name,c in counts.items()}
        for name in ('e5_roundtrip','candidate_roundtrip'):
            correct=counts['segmented_orig']['top1']
            lost=sum(r['segmented_orig']['top1_correct'] and not r[name]['top1_correct'] for r in rows)
            summary[name+'_lost']=lost
            summary[name+'_conditional_retention']=(correct-lost)/correct if correct else None
        summary['candidate_vs_e5_newly_correct']=sum(not r['e5_roundtrip']['top1_correct'] and r['candidate_roundtrip']['top1_correct'] for r in rows)
        summary['candidate_vs_e5_newly_wrong']=sum(r['e5_roundtrip']['top1_correct'] and not r['candidate_roundtrip']['top1_correct'] for r in rows)
        audit=read(recog_run/'audit.json')['metrics']['val']
        assert all(summary['metrics']['full_orig'][k]==audit[k] for k in ('top1','top5'))
    write(out/'summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__': main()
