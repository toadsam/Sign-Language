import unittest
import numpy as np
from eval.analyze_token_errors import restore_hand_component

class FitInterventionTest(unittest.TestCase):
    def test_shape_and_orientation_interventions_keep_reconstructed_wrists(self):
        a=np.random.default_rng(11).normal(size=(5,125,3)).astype(np.float32)
        b=a@np.array([[0,-1,0],[1,0,0],[0,0,1]],np.float32); b[:,13:55]*=.8
        for mode in ('shape_with_fitted_recon_orientation','recon_shape_with_fitted_orig_orientation'):
            c=restore_hand_component(a,b,mode).reshape(-1,125,3)
            np.testing.assert_allclose(c[:,[13,34]],b[:,[13,34]],atol=1e-6)
            np.testing.assert_array_equal(c[:,:13],b[:,:13]); np.testing.assert_array_equal(c[:,55:],b[:,55:])
        shape=restore_hand_component(a,b,'shape_with_fitted_recon_orientation').reshape(-1,125,3)
        for root in (13,34):
            np.testing.assert_allclose(np.linalg.norm(shape[:,root+1:root+21]-shape[:,root:root+1],axis=-1),np.linalg.norm(a[:,root+1:root+21]-a[:,root:root+1],axis=-1),atol=2e-6)

if __name__=='__main__': unittest.main()
