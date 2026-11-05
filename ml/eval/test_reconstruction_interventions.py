"""Check that diagnostic interventions isolate the intended joint components."""
import unittest

import numpy as np

from eval.analyze_reconstruction import geometry_metrics, restore_component


class InterventionsTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(73)
        self.a = rng.normal(size=(16, 125, 3)).astype(np.float32)
        self.b = rng.normal(size=(16, 125, 3)).astype(np.float32)

    def test_finger_shapes_keep_reconstructed_wrists(self):
        c = restore_component(self.a, self.b, 'finger_shapes').reshape(16,125,3)
        for start in (13,34):
            np.testing.assert_allclose(c[:,start],self.b[:,start],atol=5e-7)
            np.testing.assert_allclose(c[:,start:start+21]-c[:,start:start+1],
                                       self.a[:,start:start+21]-self.a[:,start:start+1],atol=1e-6)
        np.testing.assert_array_equal(c[:,:13],self.b[:,:13])
        np.testing.assert_array_equal(c[:,55:],self.b[:,55:])

    def test_wrist_paths_keep_reconstructed_relative_shapes(self):
        c = restore_component(self.a,self.b,'wrist_trajectories').reshape(16,125,3)
        for start in (13,34):
            np.testing.assert_allclose(c[:,start],self.a[:,start],atol=5e-7)
            np.testing.assert_allclose(c[:,start:start+21]-c[:,start:start+1],
                                       self.b[:,start:start+21]-self.b[:,start:start+1],atol=1e-6)
        np.testing.assert_array_equal(c[:,:13],self.b[:,:13])

    def test_joint_interventions_leave_other_parts_untouched(self):
        for mode,indices in (('body',slice(0,13)),('hands',slice(13,55)),
                             ('left_hand',slice(13,34)),('right_hand',slice(34,55))):
            expected=self.b.copy()
            expected[:,indices]=self.a[:,indices]
            np.testing.assert_array_equal(restore_component(self.a,self.b,mode).reshape(16,125,3),expected)

    def test_geometry_distinguishes_wrist_translation_from_finger_shape(self):
        b=self.a.copy()
        b[:,13:55]+=np.array([.1,0,0],dtype=np.float32)
        result=geometry_metrics(self.a,b,.4)
        self.assertAlmostEqual(result['hands_mm'],40.,places=4)
        self.assertAlmostEqual(result['wrists_mm'],40.,places=4)
        self.assertLess(result['finger_shape_mm'],.001)
        self.assertEqual(result['body_mm'],0.)


if __name__=='__main__':
    unittest.main()
