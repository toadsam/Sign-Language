"""Verify matched fine-tuning arms and compare their frozen validation results."""
import argparse
from pathlib import Path
from eval.evaluate_backtranslation import read,write


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pair',required=True); ap.add_argument('--baseline',required=True)
    args=ap.parse_args(); root=Path(args.pair)
    out=root/'comparison.json'
    if out.exists(): raise FileExistsError(out)
    arms=[root/'lam1',root/'lam2']
    manifests=[read(a/'manifest.json') for a in arms]
    summaries=[read(a/'summary.json') for a in arms]
    configs=[{k:v for k,v in m['config'].items() if k not in ('run','vq_version','lam_hand')} for m in manifests]
    assert configs[0]==configs[1]
    assert [m['config']['lam_hand'] for m in manifests]==[1.,2.]
    assert manifests[0]['protected_sha256']==manifests[1]['protected_sha256']
    assert manifests[0]['eligible_train_clip_ids_sha256']==manifests[1]['eligible_train_clip_ids_sha256']
    assert summaries[0]['batch_sequence_sha256']==summaries[1]['batch_sequence_sha256']
    validations=[Path(args.baseline)]+[a/'validation' for a in arms]
    tables=[]; reference=None
    for name,folder in zip(('E5','lam1','lam2'),validations):
        r=read(folder/'summary.json'); p=read(folder/'provenance.json'); checks=read(folder/'checks.json')
        rows=[__import__('json').loads(l) for l in (folder/'rows.jsonl').read_text().splitlines()]
        identity={v['clip']:(v['source_sha256'],v['orig']['top5']) for v in rows}
        if reference is None: reference=identity
        assert identity==reference and p['partition']=='val' and r['clips']==5453
        assert checks['protected_hashes_unchanged'] and checks['original_matches_audit']
        tables.append({'name':name,'metrics':r['metrics']['recon'],
                       'conditional_retention':r['top1_conditional_retention'],
                       'geometry':r['geometry'],'model_sha256':p['protected_sha256'][str(Path(p['arguments']['vq']).resolve()/'model.pt')]})
    result={'matched_arms_verified':True,'same_validation_inputs_and_original_predictions':True,
            'arms':tables,'lam2_minus_lam1_top1_pp':100*(tables[2]['metrics']['top1']-tables[1]['metrics']['top1']),
            'interpretation':'Paired WORD-only fine-tuning with fresh AdamW; not a from-scratch reproduction of historical E5. No test selection or deployment.',
            'attribution':'한국지능정보사회진흥원 AI Hub 「수어 영상」 데이터 활용'}
    write(out,result); print('Saved',out)

if __name__=='__main__': main()
