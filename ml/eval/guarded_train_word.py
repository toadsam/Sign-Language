"""Validate version/hash/split bindings before delegating to the shared word trainer.

Use --check-only for handoff verification. This wrapper does not edit gen sources.
Training still uses the existing gen implementation; no training starts in check-only.
"""
import argparse
import json
from pathlib import Path
import sys

import numpy as np
import torch

from eval.evaluate_backtranslation import digest,read,write
from eval.token_handoff import selected_metadata
from gen.tokenize import segment
from vq.model import load_vqvae


def validate_payload(tk,manifest,metas,split,config,model_sha):
    groups=[set(split['signers'][part]) for part in ('train','val','test')]
    if split.get('mode')!='signer' or any(groups[i]&groups[j] for i in range(3) for j in range(i+1,3)):
        raise ValueError('Overlapping or unsupported signer split')
    if manifest.get('partition')!='train': raise ValueError('Only train token manifests may enter training')
    if not tk.get('vq_version') or tk['vq_version']!=config.get('vq_version') or tk['vq_version']!=manifest.get('vq_version'):
        raise ValueError('Token/decoder version mismatch')
    if manifest.get('model_sha256')!=model_sha: raise ValueError('Decoder SHA mismatch')
    if tk.get('nb_code')!=config['nb_code'] or tk.get('down')!=4: raise ValueError('Codebook/down mismatch')
    expected={m['clip']:m for m in selected_metadata(metas,split,'train')}
    if set(tk.get('clips',{}))!=set(expected): raise ValueError('Token clip set is not the exact selected train split')
    for name,c in tk['clips'].items():
        m=expected[name]
        if any(c[k]!=m[k] for k in ('item','signer','type')): raise ValueError('Token metadata mismatch')
        start,end=segment({**m,'x':range(m['frames'])},tk['down'])
        ids=c['tokens']
        if c['frames']!=[start,end] or end<=start or len(ids)!=(end-start)//tk['down']:
            raise ValueError('Token length or segment mismatch')
        if any(type(v) is not int or not 0<=v<tk['nb_code'] for v in ids): raise ValueError('Token outside codebook')
    return expected


def check_files(tokens_path,data,vq):
    tokens_path,data,vq=map(lambda p:Path(p).resolve(),(tokens_path,data,vq))
    tk=read(tokens_path); manifest=read(tokens_path.parent/'manifest.json')
    for path,key in ((tokens_path,'tokens_sha256'),(data/'meta.jsonl','meta_sha256'),
                     (data/'split_snapshot.json','split_sha256'),(data/'classes.json','classes_sha256')):
        if digest(path)!=manifest.get(key): raise ValueError(f'Changed file: {path.name}')
    if Path(manifest['data']).resolve()!=data or Path(tk['vq']).resolve()!=vq: raise ValueError('Path binding mismatch')
    model,config=load_vqvae(vq/'model.pt')
    if model.down!=tk['down']: raise ValueError('Decoder down mismatch')
    metas=[json.loads(l) for l in (data/'meta.jsonl').read_text().splitlines()]
    split=read(data/'split_snapshot.json')
    expected=validate_payload(tk,manifest,metas,split,config,digest(vq/'model.pt'))
    sources=[json.loads(line) for line in (tokens_path.parent/'rows.jsonl').read_text().splitlines()]
    if len(sources)!=len(expected) or {r['clip'] for r in sources}!=set(expected):
        raise ValueError('Source manifest clip set mismatch')
    import hashlib
    chain=hashlib.sha256()
    for row in sources:
        chain.update((row['clip']+row['source_sha256']).encode())
        expected[row['clip']]={**expected[row['clip']],'source_sha256':row['source_sha256']}
    if chain.hexdigest()!=manifest.get('source_manifest_sha256'):
        raise ValueError('Source manifest hash mismatch')
    classes=read(data/'classes.json')
    if set(classes)!={m['item'] for m in expected.values()}: raise ValueError('Vocabulary mismatch')
    report={'passed':True,'clips':len(expected),'classes':len(classes),
            'signers':sorted({m['signer'] for m in expected.values()}),
            'vq_version':tk['vq_version'],'candidate_id':manifest['candidate_id'],
            'vq_sha256':manifest['model_sha256'],'tokens_sha256':manifest['tokens_sha256'],
            'partition':'train','training_started':False}
    return tk,manifest,expected,report



def load_training_setup(tokens_path,data_dir,vq):
    """Read only the validated train motions; held-out motion files are never opened."""
    verified,_,selected,_=check_files(tokens_path,data_dir,vq)
    clips=[]
    for name,c in verified['clips'].items():
        if name not in selected: raise ValueError('Non-train clip blocked')
        source=Path(data_dir)/'npy'/(name+'.npy')
        if digest(source)!=selected[name]['source_sha256']: raise ValueError('Training motion changed since tokenization')
        x=np.load(source,allow_pickle=False).reshape(-1,375)
        if len(x)!=selected[name]['frames'] or not np.isfinite(x).all():
            raise ValueError('Invalid training motion')
        start,end=c['frames']
        clips.append({'clip':name,**c,'motion':x[start:end]})
    items=sorted({c['item'] for c in clips}); signers=sorted({c['signer'] for c in clips})
    return verified,clips,{v:i for i,v in enumerate(items)},{v:i for i,v in enumerate(signers)}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--tokens',required=True); ap.add_argument('--data',required=True)
    ap.add_argument('--vq',required=True); ap.add_argument('--model',choices=('gpt','regress'),default='gpt')
    ap.add_argument('--run'); ap.add_argument('--check-only',action='store_true')
    args,extra=ap.parse_known_args()
    tk,manifest,expected,report=check_files(args.tokens,args.data,args.vq)
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
    if args.check_only: return
    if not args.run: ap.error('--run is required for training')
    run=Path(args.run).resolve()
    if not str(run).startswith('/data/work/ryush2002/'):
        raise ValueError('Full training must run in the personal GCP server folder')
    run.mkdir(parents=True,exist_ok=False)
    write(run/'token_binding.json',report)
    from gen import train_word
    original_setup=train_word.load_setup
    original_argv=sys.argv
    def train_only_setup(tokens_path,data_dir):
        return load_training_setup(tokens_path,data_dir,args.vq)
    try:
        train_word.load_setup=train_only_setup
        sys.argv=['gen.train_word','--tokens',args.tokens,'--data',args.data,'--run',args.run,'--model',args.model,*extra]
        train_word.main()
        path=run/'model.pt'
        ck=torch.load(path,map_location='cpu',weights_only=False)
        ck.update({'vq_version':tk['vq_version'],'vq_sha256':manifest['model_sha256'],
                   'tokens_sha256':manifest['tokens_sha256'],'training_partition':'train'})
        tmp=run/'model.binding.tmp'; torch.save(ck,tmp); tmp.replace(path)
        report['training_started']=True; report['checkpoint_binding_written']=True
        write(run/'token_binding.json',report)
    finally:
        train_word.load_setup=original_setup; sys.argv=original_argv


if __name__=='__main__': main()
