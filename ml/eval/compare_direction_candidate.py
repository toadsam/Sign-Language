"""Compare one direction-loss candidate with the frozen lam2 control on val only."""
import argparse
from pathlib import Path
import json
from eval.evaluate_backtranslation import read,write,digest


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--control',required=True); ap.add_argument('--candidate',required=True)
    ap.add_argument('--control-val',required=True); ap.add_argument('--candidate-val',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--control-direction',type=float,default=0.)
    ap.add_argument('--candidate-direction',type=float,default=.1)
    a=ap.parse_args(); control,candidate=Path(a.control),Path(a.candidate)
    target=Path(a.out)
    if target.exists(): raise FileExistsError(target)
    manifests=[read(p/'manifest.json') for p in (control,candidate)]
    clean=lambda c:{k:v for k,v in c.items() if k not in ('run','vq_version','experiment','lam_direction')}
    assert clean(manifests[0]['config'])==clean(manifests[1]['config'])
    assert manifests[0]['config'].get('lam_direction',0.)==a.control_direction and manifests[1]['config']['lam_direction']==a.candidate_direction
    assert manifests[0]['config']['lam_hand']==manifests[1]['config']['lam_hand']==2.
    assert manifests[0]['eligible_train_clip_ids_sha256']==manifests[1]['eligible_train_clip_ids_sha256']
    assert manifests[0]['protected_sha256']==manifests[1]['protected_sha256']
    training=[read(p/'summary.json') for p in (control,candidate)]
    assert training[0]['steps']==training[1]['steps']==10000
    assert training[0]['batch_sequence_sha256']==training[1]['batch_sequence_sha256']
    summaries=[]; rowsets=[]
    for folder,model in ((Path(a.control_val),control),(Path(a.candidate_val),candidate)):
        s=read(folder/'summary.json'); p=read(folder/'provenance.json'); m=read(folder/'manifest.json')
        assert s['partition']=='val' and s['clips']==5453 and s['protected_hashes_unchanged']
        assert digest(model/'model.pt')==m['model_sha256']
        rows=[json.loads(l) for l in (folder/'rows.jsonl').read_text().splitlines()]
        assert len(rows)==len({r['clip'] for r in rows})==5453
        for mode in ('full_orig','segmented_orig','e5_roundtrip','candidate_roundtrip'):
            for k in ('top1','top5'):
                assert sum(r[mode][k+'_correct'] for r in rows)==s['metrics'][mode]['correct_'+k]
        summaries.append(s); rowsets.append({r['clip']:r for r in rows})
    old,new=rowsets
    assert set(old)==set(new)
    assert all((r['source_sha256'],r['frames'],r['segmented_orig'])==(old[c]['source_sha256'],old[c]['frames'],old[c]['segmented_orig']) for c,r in new.items())
    result={'matched_training_budget_data_and_batches':True,'matched_validation_inputs_and_scoring':True,
            'control_direction':a.control_direction,'candidate_direction':a.candidate_direction,
            'clips':5453,'control':summaries[0]['metrics']['candidate_roundtrip'],
            'candidate':summaries[1]['metrics']['candidate_roundtrip'],
            'newly_correct':sum(not old[c]['candidate_roundtrip']['top1_correct'] and r['candidate_roundtrip']['top1_correct'] for c,r in new.items()),
            'newly_wrong':sum(old[c]['candidate_roundtrip']['top1_correct'] and not r['candidate_roundtrip']['top1_correct'] for c,r in new.items()),
            'delta_top1_pp':100*(summaries[1]['metrics']['candidate_roundtrip']['top1']-summaries[0]['metrics']['candidate_roundtrip']['top1']),
            'candidate_model_sha256':digest(candidate/'model.pt'),'test_evaluated':False,
            'interpretation':'One seed; val-only incremental direction-loss experiment. No test reuse or deployment.'}
    result['recommendation']='review_candidate' if result['delta_top1_pp']>0 else 'keep_control'
    write(target,result); print(json.dumps(result,indent=2))


if __name__=='__main__': main()
