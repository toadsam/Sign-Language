"""Explicit test-only factory. These coordinates are not sign-language motion."""
import numpy as np

from .app import create_app


class SyntheticGenerator:
    def generate(self, gloss, nonmanual=(), seed=None):
        unknown = [word for word in gloss if word not in {"화장실", "있다"}]
        frames = 1 if any(word not in unknown for word in gloss) else 0
        motion = np.zeros((frames, 125, 3), dtype=np.float32)
        if frames:
            motion[0, :, 0] = np.arange(125, dtype=np.float32) / 125
        return dict(fps=30, motion=motion, tokens=[], unknown=unknown, source="baseline")


def create_demo_app():
    return create_app(generator_factory=SyntheticGenerator)
