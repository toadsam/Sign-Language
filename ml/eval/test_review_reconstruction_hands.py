import unittest
import numpy as np
from eval.review_reconstruction_hands import rotation_aligned, hand_metrics

class GeometryTest(unittest.TestCase):
    def test_rigid_rotation_is_removed_without_scaling(self):
        a=np.random.default_rng(42).normal(size=(8,21,3))*20
        a[:,0]=0
        rot=np.array([[0,-1,0],[1,0,0],[0,0,1]])
        b=a@rot
        np.testing.assert_allclose(rotation_aligned(b,a),a,atol=1e-10)
        self.assertLess(hand_metrics(a,b)['finger_bend_angle_mae_deg'],1e-5)
        self.assertGreater(hand_metrics(a,b*.8)['rotation_aligned_mean_mm'],1.)

    def test_reflection_and_deformation_not_silently_removed(self):
        a=np.random.default_rng(47).normal(size=(8,21,3))*20; a[:,0]=0
        b=a.copy(); b[:,:,0]*=-1
        self.assertGreater(hand_metrics(a,b)['rotation_aligned_mean_mm'],1.)
        b=a.copy(); b[:,8]+=25
        self.assertGreater(hand_metrics(a,b)['bone_length_mae_mm'],0.)
        self.assertGreater(hand_metrics(a,b)['finger_bend_angle_mae_deg'],0.)

if __name__=='__main__': unittest.main()
