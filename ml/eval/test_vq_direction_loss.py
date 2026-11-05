import unittest
import torch
from eval.vq_direction_loss import hand_bone_direction_loss

class DirectionLossTest(unittest.TestCase):
    def setUp(self):
        gen=torch.Generator().manual_seed(42)
        self.a=torch.randn((2,8,375),generator=gen)
    def test_identity_scale_translation_and_rotation(self):
        self.assertLess(hand_bone_direction_loss(self.a,self.a).item(),1e-6)
        self.assertLess(hand_bone_direction_loss(self.a,self.a*2+3).item(),1e-6)
        r=torch.tensor([[0.,-1.,0.],[1.,0.,0.],[0.,0.,1.]])
        b=(self.a.reshape(2,8,125,3)@r).reshape(2,8,375)
        self.assertGreater(hand_bone_direction_loss(self.a,b).item(),.1)
    def test_collapsed_prediction_does_not_mask_out_valid_targets(self):
        b=torch.zeros_like(self.a,requires_grad=True)
        loss=hand_bone_direction_loss(self.a,b)
        self.assertAlmostEqual(loss.item(),1.)
        loss.backward(); self.assertTrue(torch.isfinite(b.grad).all())
        self.assertGreater(b.grad.abs().sum().item(),0.)
    def test_invalid_target_bones_and_nonhand_joints(self):
        b=torch.randn_like(self.a,requires_grad=True)
        loss=hand_bone_direction_loss(torch.zeros_like(self.a),b)
        self.assertEqual(loss.item(),0.); loss.backward()
        self.assertTrue(torch.isfinite(b.grad).all())
        b=self.a.reshape(2,8,125,3).clone(); b[:,:,:13]+=5; b[:,:,55:]-=7
        self.assertLess(hand_bone_direction_loss(self.a,b.reshape_as(self.a)).item(),1e-6)

if __name__=='__main__': unittest.main()
