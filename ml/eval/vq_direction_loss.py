"""A unitless, masked hand-bone direction objective for private VQ experiments."""
import torch
import torch.nn.functional as F

# Existing OpenPose 21-joint chains, applied symmetrically to both hands.
PARENTS=[0,1,2,3,0,5,6,7,0,9,10,11,0,13,14,15,0,17,18,19]
CHILDREN=list(range(1,21))


def hand_bone_direction_loss(original,reconstructed,min_target_length=1e-4):
    """Mean 1-cos over valid target bones. Translation/positive scale invariant.

    Target-only masking prevents a collapsed prediction from escaping the loss.
    Position and hand-relative terms remain necessary to constrain lengths/locations.
    """
    a=original.reshape(*original.shape[:2],125,3)[...,13:55,:].reshape(*original.shape[:2],2,21,3)
    b=reconstructed.reshape(*reconstructed.shape[:2],125,3)[...,13:55,:].reshape(*reconstructed.shape[:2],2,21,3)
    va=a[...,CHILDREN,:]-a[...,PARENTS,:]
    vb=b[...,CHILDREN,:]-b[...,PARENTS,:]
    valid=torch.linalg.vector_norm(va,dim=-1)>min_target_length
    cos=(F.normalize(va,dim=-1,eps=1e-6)*F.normalize(vb,dim=-1,eps=1e-6)).sum(-1).clamp(-1,1)
    return ((1-cos)*valid).sum()/valid.sum().clamp_min(1)
