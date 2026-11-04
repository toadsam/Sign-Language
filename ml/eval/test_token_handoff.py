import copy
import unittest
import numpy as np
from eval.guarded_train_word import validate_payload
from eval.token_handoff import token_header
from gen.tokenize import segment

class GuardTest(unittest.TestCase):
    def setUp(self):
        self.sp={'mode':'signer','signers':{'train':['REAL01'],'val':['REAL04'],'test':['REAL03']},'exclude':{'clips':[]}}
        self.metas=[{'clip':s,'signer':s,'type':'WORD','item':'WORD0001','frames':40,'active':[9,31],'label':'ok','dur_ratio':1.} for s in ('REAL01','REAL04','REAL03')]
        self.cfg={'vq_version':'lam2','nb_code':512}
        self.tk=token_header('/tmp/candidate',self.cfg,4)
        self.tk['clips']={'REAL01':{'item':'WORD0001','type':'WORD','signer':'REAL01','frames':[5,33],'tokens':[0]*7}}
        self.manifest={'partition':'train','vq_version':'lam2','model_sha256':'abc'}
    def validate(self): return validate_payload(self.tk,self.manifest,self.metas,self.sp,self.cfg,'abc')
    def test_exact_train_only_passes(self): self.assertEqual(set(self.validate()),{'REAL01'})
    def test_val_and_test_injection_are_blocked(self):
        for signer in ('REAL04','REAL03'):
            with self.subTest(signer=signer):
                self.tk['clips'][signer]={**self.tk['clips']['REAL01'],'signer':signer}
                with self.assertRaises(ValueError): self.validate()
                self.tk['clips'].pop(signer)
    def test_version_hash_and_partition_mismatch_blocked(self):
        for key,value in (('vq_version','old'),('model_sha256','changed'),('partition','val')):
            saved=self.manifest[key]; self.manifest[key]=value
            with self.assertRaises(ValueError): self.validate()
            self.manifest[key]=saved
    def test_overlapping_signer_split_blocked(self):
        self.sp['signers']['train'].append('REAL04')
        with self.assertRaises(ValueError): self.validate()
    def test_bad_ids_or_length_blocked(self):
        for ids in ([512]*7,[True]*7,[0]*6):
            self.tk['clips']['REAL01']['tokens']=ids
            with self.assertRaises(ValueError): self.validate()
    def test_segment_is_existing_pipeline_not_full_clip(self):
        m=self.metas[0]; x=np.zeros((40,375),np.float32)
        self.assertEqual(segment({**m,'x':x},4),(5,33))
    def test_missing_version_and_excluded_clip_blocked(self):
        with self.assertRaises(ValueError): token_header('/tmp/model',{'nb_code':512},4)
        self.sp['exclude']['clips']=['REAL01']
        with self.assertRaises(ValueError): self.validate()


class FileBindingIntegrationTest(unittest.TestCase):
    def test_setup_never_loads_heldout_motion_and_binds_files(self):
        import json
        import tempfile
        from pathlib import Path
        import torch
        from vq.model import MotionVQVAE
        from eval.evaluate_backtranslation import digest
        from eval.guarded_train_word import check_files,load_training_setup
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); data=root/'data'; vq=root/'vq'; tokens_dir=root/'tokens'
            (data/'npy').mkdir(parents=True); vq.mkdir(); tokens_dir.mkdir()
            sp={'mode':'signer','signers':{'train':['REAL01'],'val':['REAL04'],'test':['REAL03']},'exclude':{'clips':[]}}
            metas=[{'clip':s,'signer':s,'type':'WORD','item':'WORD0001','frames':40,'active':[9,31],'label':'ok','dur_ratio':1.} for s in ('REAL01','REAL04','REAL03')]
            (data/'meta.jsonl').write_text(''.join(json.dumps(m)+'\n' for m in metas))
            (data/'split_snapshot.json').write_text(json.dumps(sp)); (data/'classes.json').write_text(json.dumps({'WORD0001':0}))
            # Held-out npy files deliberately do not exist.
            np.save(data/'npy/REAL01.npy',np.zeros((40,375),np.float32))
            cfg={'vq_version':'unit-version','nb_code':512,'width':8,'code_dim':4,'depth':1,'parts':'body_hand'}
            model=MotionVQVAE(375,8,4,512,depth=1,parts='body_hand')
            torch.save({'config':cfg,'model':model.state_dict()},vq/'model.pt')
            tk=token_header(vq,cfg,4)
            tk['clips']={'REAL01':{'item':'WORD0001','type':'WORD','signer':'REAL01','frames':[5,33],'tokens':[0]*7}}
            tp=tokens_dir/'tokens.json'; tp.write_text(json.dumps(tk))
            manifest={'partition':'train','candidate_id':'synthetic','vq_version':'unit-version','data':str(data),
                      'model_sha256':digest(vq/'model.pt'),'tokens_sha256':digest(tp),'meta_sha256':digest(data/'meta.jsonl'),
                      'split_sha256':digest(data/'split_snapshot.json'),'classes_sha256':digest(data/'classes.json')}
            import hashlib
            source_sha=digest(data/'npy/REAL01.npy')
            (tokens_dir/'rows.jsonl').write_text(json.dumps({'clip':'REAL01','source_sha256':source_sha})+'\n')
            manifest['source_manifest_sha256']=hashlib.sha256(('REAL01'+source_sha).encode()).hexdigest()
            (tokens_dir/'manifest.json').write_text(json.dumps(manifest))
            _,clips,classes,signers=load_training_setup(tp,data,vq)
            self.assertEqual([c['clip'] for c in clips],['REAL01']); self.assertEqual(clips[0]['motion'].shape,(28,375))
            self.assertEqual(signers,{'REAL01':0}); self.assertEqual(classes,{'WORD0001':0})
            np.save(data/'npy/REAL01.npy',np.ones((40,375),np.float32))
            with self.assertRaises(ValueError): load_training_setup(tp,data,vq)
            tp.write_text(tp.read_text()+' ')
            with self.assertRaises(ValueError): check_files(tp,data,vq)

if __name__=='__main__': unittest.main()
