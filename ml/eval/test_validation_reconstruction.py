import unittest
import numpy as np
from eval.validation_reconstruction import bone_direction_error, detailed_geometry

class ValidationGeometryTest(unittest.TestCase):
    def test_rotation_changes_direction_not_bending(self):
        a=np.random.default_rng(31).normal(size=(5,125,3)).astype(np.float64)
        rotated=a@np.array([[0,-1,0],[1,0,0],[0,0,1]])
        result=detailed_geometry(a,rotated,.4)['right']
        self.assertGreater(result['bone_direction_mae_deg'],10.)
        self.assertLess(result['finger_bend_angle_mae_deg'],1e-5)
        self.assertLess(result['rotation_aligned_mean_mm'],1e-7)
        self.assertLess(result['bone_length_mae_mm'],1e-8)

    def test_scaling_preserves_direction_and_detects_lengths(self):
        a=np.random.default_rng(32).normal(size=(5,125,3)).astype(np.float64)
        result=detailed_geometry(a,a*1.2,.4)['left']
        self.assertLess(result['bone_direction_mae_deg'],1e-5)
        self.assertGreater(result['bone_length_mae_mm'],1.)

    def test_degenerate_bones_do_not_become_zero_angle_evidence(self):
        a=np.zeros((5,21,3))
        result=bone_direction_error(a,a)
        self.assertIsNone(result['bone_direction_mae_deg'])
        self.assertEqual(result['bone_direction_valid_fraction'],0.)

if __name__=='__main__': unittest.main()
