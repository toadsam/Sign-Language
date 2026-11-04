"""Export selected stick-hand figures and numeric orientation/shape diagnostics."""
import argparse
from pathlib import Path

import numpy as np
import torch

from eval.evaluate_backtranslation import digest, read, write
from vq.model import load_vqvae


EDGES = [(p+i,p+i+1) for p in (1,5,9,13,17) for i in range(3)] + [(0,p) for p in (1,5,9,13,17)]
CASES = ('WORD0300_REAL03','WORD1114_REAL03','WORD1309_REAL03','WORD0290_REAL03','WORD1121_REAL03')


def rotation_aligned(source, reference):
    """Fit a proper rotation about the wrist per frame. No scale/reflection/translation."""
    u, _, vh = np.linalg.svd(np.swapaxes(source,-1,-2) @ reference)
    correction = np.broadcast_to(np.eye(3),u.shape).copy()
    correction[:,-1,-1] = np.linalg.det(u @ vh)
    return source @ (u @ correction @ vh)


def bend_angles(x):
    # At each finger base, connect to wrist (not the preceding finger's tip).
    triples=[(0 if p==root else p-1,p,p+1) for root in (1,5,9,13,17) for p in (root,root+1,root+2)]
    a,b,c=zip(*triples)
    v=x[:,a]-x[:,b]; w=x[:,c]-x[:,b]
    den=np.linalg.norm(v,axis=-1)*np.linalg.norm(w,axis=-1)
    angle=np.degrees(np.arccos(np.clip(np.sum(v*w,axis=-1)/np.maximum(den,1e-12),-1,1)))
    angle[den<1e-8]=np.nan
    return angle


def hand_metrics(a,b):
    aligned=rotation_aligned(b,a)
    tips=[4,8,12,16,20]
    base=np.linalg.norm(a[:,tips],axis=-1).mean()
    lengths=lambda x:np.stack([np.linalg.norm(x[:,u]-x[:,v],axis=-1) for u,v in EDGES],axis=-1)
    la,lb=lengths(a),lengths(b)
    return {'wrist_relative_mean_mm':float(np.linalg.norm(a-b,axis=-1)[:,1:].mean()),
            'rotation_aligned_mean_mm':float(np.linalg.norm(a-aligned,axis=-1)[:,1:].mean()),
            'finger_bend_angle_mae_deg':float(np.nanmean(np.abs(bend_angles(a)-bend_angles(b)))),
            'mean_wrist_tip_reach_ratio':float(np.linalg.norm(b[:,tips],axis=-1).mean()/base) if base>1e-8 else None,
            'bone_length_mae_mm':float(np.abs(la-lb).mean())}


@torch.inference_mode()
def main():
    import json
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--evaluation',required=True)
    ap.add_argument('--out',required=True)
    args=ap.parse_args()
    torch.set_num_threads(2)
    evaluation,out=Path(args.evaluation),Path(args.out)
    out.mkdir(parents=True,exist_ok=False)
    p=read(evaluation/'provenance.json'); ml=evaluation.parents[3]
    resolve=lambda x:Path(x) if Path(x).is_absolute() else ml/Path(x)
    protected={str(resolve(f)):h for f,h in p['protected_sha256'].items()}
    assert all(digest(f)==h for f,h in protected.items())
    vq,config=load_vqvae(resolve(p['arguments']['vq'])/'model.pt')
    data=Path(p['data'])
    metas={m['clip']:m for m in (json.loads(l) for l in (data/'meta.jsonl').read_text().splitlines())}
    rows={r['clip']:r for r in (json.loads(l) for l in (evaluation/'loss_analysis/rows.jsonl').read_text().splitlines())}
    source_hashes={r['clip']:r['source_sha256'] for r in (json.loads(l) for l in (evaluation/'rows.jsonl').read_text().splitlines())}
    reports=[]
    for clip in CASES:
        m=metas[clip]; row=rows[clip]
        assert row['lost']
        source_file=data/'npy'/(clip+'.npy')
        assert digest(source_file)==source_hashes[clip]
        x=np.load(source_file,allow_pickle=False).reshape(-1,375)
        T=len(x)//vq.down*vq.down; x=x[:T]
        a=x.reshape(-1,125,3)
        b=vq(torch.from_numpy(x)[None])[0][0].numpy().reshape(-1,125,3)
        start,end=min(m['active'][0],T-2),min(m['active'][1],T-1)
        mm=m['norm']['scale']*1000
        metrics={}
        fig=plt.figure(figsize=(15,8))
        for side,root in enumerate((13,34)):
            aa=(a[:,root:root+21]-a[:,root:root+1])*mm
            bb=(b[:,root:root+21]-b[:,root:root+1])*mm
            metrics[('left','right')[side]]=hand_metrics(aa[start:end+1],bb[start:end+1])
            errors=np.linalg.norm(aa-bb,axis=-1).mean(-1)
            peak=int(start+np.argmax(errors[start:end+1]))
            frames=[int(start+(end-start)*q) for q in (.25,.5,.75)]+[peak]
            extent=max(np.abs(aa[frames]).max(),np.abs(bb[frames]).max(),1)*1.08
            for col,frame in enumerate(frames):
                ax=fig.add_subplot(2,4,side*4+col+1,projection='3d')
                for points,color in ((aa[frame],'#1565c0'),(bb[frame],'#e76f00')):
                    for u,v in EDGES: ax.plot(*points[[u,v]].T,color=color,lw=1.5,alpha=.8)
                    ax.scatter(*points.T,color=color,s=8)
                ax.set(xlim=(-extent,extent),ylim=(-extent,extent),zlim=(-extent,extent))
                ax.tick_params(labelsize=7,pad=0)
                ax.locator_params(nbins=3)
                ax.set_box_aspect((1,1,1)); ax.view_init(20,-65)
                ax.set_title(f"{('Left','Right')[side]} | {('25%','50%','75%','peak error')[col]} | frame {frame}",fontsize=10)
        fig.suptitle(f"{clip} -> {row['reconstructed']['top1']} | wrist-relative hands",fontsize=15,y=.99)
        fig.legend(handles=[Line2D([0],[0],color='#1565c0',label='Original'),Line2D([0],[0],color='#e76f00',label='E5 reconstruction')],loc='upper center',bbox_to_anchor=(.5,.95),ncol=2)
        fig.text(.5,.015,'Axes: x/y/z in mm. Same camera and scale within each hand. Keyframes only; not linguistic validation. Source: NIA AI Hub Sign Language data.',ha='center',fontsize=9)
        fig.subplots_adjust(top=.86,bottom=.09,wspace=.18,hspace=.28)
        fig.savefig(out/(clip+'.png'),dpi=110,metadata={'Source':'한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'})
        plt.close(fig)
        reports.append({'clip':clip,'prediction':row['reconstructed']['top1'],
                        'actual_gloss':m.get('gloss'), 'reconstructed_truth_rank':row['reconstructed']['truth_rank'],
                        'hand_metrics':metrics,'restoration_top1':{k:v['truth_rank']==1 for k,v in row['restoration'].items()}})
    assert all(digest(f)==h for f,h in protected.items())
    write(out/'summary.json',{'cases':reports,'vq_config':config,'protected_hashes_unchanged':True,
          'selection':'Five exploratory diagnostic examples: tree/numeric/same-gloss confusion and a hands-only unrecovered case; not representative prevalence',
          'limitations':['Rotation alignment fits 20 wrist-relative finger joints per frame without scale; it can absorb some deformation',
                         'Finger bend angles and fitted rotation residuals describe coordinate geometry, not linguistic correctness',
                         'Static keyframes and peak-error frame omit temporal behavior'],
          'script_sha256':digest(__file__)})
    print(json.dumps(reports,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
