import unittest
import numpy as np
from eval.vq_hand_ablation import choose_training,sample

class SelectionTest(unittest.TestCase):
    def test_only_train_and_long_clips(self):
        sp={'mode':'signer','signers':{'train':['REAL01'],'val':['REAL04'],'test':['REAL03']},'exclude':{'clips':['excluded']}}
        metas=[{'clip':c,'signer':s,'frames':n,'label':'ok','dur_ratio':1.} for c,s,n in
               [('keep','REAL01',64),('short','REAL01',63),('excluded','REAL01',64),('val','REAL04',64),('test','REAL03',64)]]
        selected,short=choose_training(metas,sp,64)
        self.assertEqual([m['clip'] for m in selected],['keep']); self.assertEqual(short,1)

    def test_paired_batch_sequence_and_resume_rng(self):
        clips=[{'clip':str(i),'frames':80+i} for i in range(4)]
        class Cache:
            def get(self,m): return np.arange(m['frames']*375,dtype=np.float32).reshape(-1,375)
        a,b=np.random.default_rng(0),np.random.default_rng(0)
        for _ in range(3): np.testing.assert_array_equal(sample(clips,Cache(),a,4,64),sample(clips,Cache(),b,4,64))
        state=a.bit_generator.state; resumed=np.random.default_rng(); resumed.bit_generator.state=state
        np.testing.assert_array_equal(sample(clips,Cache(),a,4,64),sample(clips,Cache(),resumed,4,64))

if __name__=='__main__': unittest.main()
