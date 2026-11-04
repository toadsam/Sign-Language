"""Private train-only E5 fine-tuning with one extra hand-bone direction loss.

benchmark writes timing only. train writes a new version and resumable snapshots.
Neither mode reads val/test motion arrays or edits shared checkpoints.
"""
import argparse
from collections import OrderedDict
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch

from common.data import apply_split, load_split
from eval.evaluate_backtranslation import digest, read, write
from vq.model import load_vqvae
from vq.train import joint_weights, losses
from eval.vq_direction_loss import hand_bone_direction_loss

BASE_SHA='939540caac85f14dff7180f59b924c3000e65a1d413bf7edb85559a4e11c1e38'


def choose_training(metas,split,window):
    train=apply_split(metas,split)[0]
    keep=[m for m in train if m['frames']>=window]
    assert keep and all(m['signer'] in split['signers']['train'] for m in keep)
    assert all(m['label']=='ok' and .85<=m['dur_ratio']<1.5 for m in keep)
    return keep,len(train)-len(keep)


class MotionCache:
    def __init__(self,data,capacity=4096):
        self.data=Path(data); self.capacity=capacity; self.cache=OrderedDict()
    def get(self,m):
        key=m['clip']
        if key in self.cache:
            self.cache.move_to_end(key); return self.cache[key]
        a=np.load(self.data/'npy'/(key+'.npy'),allow_pickle=False).reshape(-1,375)
        assert len(a)==m['frames'] and np.isfinite(a).all()
        self.cache[key]=a
        if len(self.cache)>self.capacity: self.cache.popitem(last=False)
        return a


def sample(clips,cache,rng,batch,window):
    out=np.empty((batch,window,375),np.float32)
    for j in range(batch):
        m=clips[int(rng.integers(len(clips)))]; a=cache.get(m)
        start=int(rng.integers(0,len(a)-window+1)); out[j]=a[start:start+window]
    return torch.from_numpy(out)


def save(path,obj):
    tmp=path.with_suffix('.tmp'); torch.save(obj,tmp); tmp.replace(path)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--mode',choices=('benchmark','train'),required=True)
    ap.add_argument('--base',required=True); ap.add_argument('--data',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--lam-hand',type=float,choices=(1.,2.),required=True)
    ap.add_argument('--steps',type=int,default=10000)
    ap.add_argument('--seed',type=int,default=0)
    ap.add_argument('--lam-direction',type=float,choices=(0.,.05,.1),required=True)
    ap.add_argument('--resume',action='store_true')
    ap.add_argument('--benchmark-pool',type=int,default=512,help='0 uses the full eligible train pool for timing.')
    args=ap.parse_args()
    if args.steps<1 or (args.mode=='benchmark' and args.steps>100):
        raise ValueError('Benchmark is limited to 100 steps; training steps must be positive.')
    torch.set_num_threads(2)
    if not torch.cuda.is_available(): raise RuntimeError('CUDA required; do not train on laptop/CPU.')
    base,data,out=map(lambda v:Path(v).resolve(),(args.base,args.data,args.out))
    protected={str(p):digest(p) for p in (base/'model.pt',data/'meta.jsonl',data/'split_snapshot.json',data/'classes.json',data/'deduplication.json')}
    assert protected[str(base/'model.pt')]==BASE_SHA
    sp=read(data/'split_snapshot.json'); assert sp==load_split(data)
    assert set(sp['signers']['val'])=={'REAL04','REAL11'} and set(sp['signers']['test'])=={'REAL03','REAL12'}
    assert not set(sp['signers']['train']) & set(sp['signers']['val']+sp['signers']['test'])
    metas=[json.loads(l) for l in (data/'meta.jsonl').read_text().splitlines()]
    train,short=choose_training(metas,sp,64)
    train_ids_sha=hashlib.sha256('\n'.join(m['clip'] for m in train).encode()).hexdigest()
    # Only the small timing run restricts the training pool. Both real arms use all eligible train clips.
    if args.mode=='benchmark' and args.benchmark_pool>0: train=train[:args.benchmark_pool]
    model,base_config=load_vqvae(base/'model.pt')
    config={**base_config,'base_vq_sha256':BASE_SHA,'data':str(data),'run':str(out),
            'iters':args.steps,'lr':2e-5,'warmup':200,'batch':32,'window':64,'seed':args.seed,
            'lam_hand':args.lam_hand,'lam_direction':args.lam_direction,'device':'cuda','resume':False,
            'vq_version':out.name,'experiment':'WORD-only E5 fine-tuning; hand bone direction objective; compare against frozen lam2 control'}
    manifest={'config':config,'mode':args.mode,'protected_sha256':protected,
              'train_clips':len(train),'short_training_clips_excluded':short,
              'eligible_train_clip_ids_sha256':train_ids_sha,'train_signers':sp['signers']['train'],
              'selection':'Fixed final step; validation after training. No test input read.',
              'script_sha256':digest(__file__)}
    if args.resume:
        old=read(out/'manifest.json'); assert old==manifest
    else:
        out.mkdir(parents=True,exist_ok=False); write(out/'manifest.json',manifest)
    torch.manual_seed(args.seed); torch.cuda.manual_seed_all(args.seed)
    model.to('cuda').train()
    opt=torch.optim.AdamW(model.parameters(),lr=config['lr'],betas=(.9,.99),weight_decay=0.)
    rng=np.random.default_rng(args.seed)
    # Keep sampled training motions: about 6 GiB for this dataset, avoiding repeated small-file I/O.
    required=sum(m['frames']*375*4 for m in train)
    meminfo={line.split(':')[0]:int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')}
    if required*2+4*1024**3>meminfo['MemAvailable']:
        raise MemoryError('Insufficient free memory for the paired experiment cache')
    cache=MotionCache(data,capacity=len(train))
    w=joint_weights(config['w_body'],config['w_hand'],config['w_face'],model.n_in//3).to('cuda')
    start,elapsed,chain=0,0.,'0'*64
    if args.resume:
        ck=torch.load(out/'latest.pt',map_location='cpu',weights_only=False)
        assert ck['config']==config
        model.load_state_dict(ck['model']); opt.load_state_dict(ck['opt'])
        for state in opt.state.values():
            for k,v in state.items():
                if torch.is_tensor(v): state[k]=v.to('cuda')
        rng.bit_generator.state=ck['numpy_rng']; torch.set_rng_state(ck['torch_rng'])
        torch.cuda.set_rng_state_all(ck['cuda_rng'])
        start,elapsed,chain=ck['iteration'],ck['elapsed_seconds'],ck['batch_sequence_sha256']
        lines=[json.loads(l) for l in (out/'log.jsonl').read_text().splitlines()]
        (out/'log.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in lines if r['iteration']<=start))
    tick=time.monotonic(); step_times=[]
    with (out/'log.jsonl').open('a') as log:
        for iteration in range(start+1,args.steps+1):
            before=time.monotonic()
            batch=sample(train,cache,rng,config['batch'],config['window'])
            batch_hash=hashlib.sha256(batch.numpy().tobytes()).hexdigest()
            chain=hashlib.sha256(bytes.fromhex(chain)+bytes.fromhex(batch_hash)).hexdigest()
            for group in opt.param_groups: group['lr']=config['lr']*min(1.,iteration/config['warmup'])
            x=batch.to('cuda'); recon,commit,ppl,_=model(x)
            pos,vel,hand=losses(x,recon,w,config['beta'])
            direction=hand_bone_direction_loss(x,recon)
            loss=pos+config['lam_vel']*vel+args.lam_hand*hand+config['commit']*commit+args.lam_direction*direction
            if not torch.isfinite(loss): raise RuntimeError('Non-finite loss')
            opt.zero_grad(); loss.backward(); opt.step(); torch.cuda.synchronize()
            step_times.append(time.monotonic()-before)
            if iteration==1 or iteration%100==0 or iteration==args.steps:
                row={'iteration':iteration,'pos':pos.item(),'vel':vel.item(),'hand':hand.item(),
                     'direction':direction.item(),'commit':commit.item(),'loss':loss.item(),'ppl':ppl.item(),'batch_sequence_sha256':chain,
                     'elapsed_seconds':elapsed+time.monotonic()-tick}
                log.write(json.dumps(row)+'\n'); log.flush(); print(json.dumps(row),flush=True)
            if args.mode=='train' and (iteration%2000==0 or iteration==args.steps):
                save(out/'latest.pt',{'model':model.state_dict(),'opt':opt.state_dict(),
                    'config':config,'iteration':iteration,'elapsed_seconds':elapsed+time.monotonic()-tick,
                    'numpy_rng':rng.bit_generator.state,'torch_rng':torch.get_rng_state(),
                    'cuda_rng':torch.cuda.get_rng_state_all(),'batch_sequence_sha256':chain})
    if args.mode=='train':
        save(out/'model.pt',{'model':model.state_dict(),'config':config})
    assert all(digest(p)==h for p,h in protected.items())
    steady=(float(np.median(step_times[20:])) if len(step_times)>20 else float(np.median(step_times))) if step_times else None
    report={'mode':args.mode,'steps':args.steps,'train_clips':len(train),'short_excluded':short,
            'seconds':elapsed+time.monotonic()-tick,'median_step_seconds_after_warmup':steady,
            'paired_10000_steps_estimate_minutes':steady*20000/60 if steady is not None and len(step_times)>20 else None,
            'batch_sequence_sha256':chain,'protected_hashes_unchanged':True,
            'peak_gpu_memory_mb':torch.cuda.max_memory_allocated()/1024**2,
            'timing_limit':'Timing only; warmup, I/O cache, checkpointing and validation affect full runtime.'}
    write(out/'summary.json',report); print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__': main()
