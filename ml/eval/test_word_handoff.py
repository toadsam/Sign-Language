import unittest
import torch
from eval.check_word_handoff import batch_tensors


class BatchTest(unittest.TestCase):
    def test_padding_end_and_ignored_targets(self):
        clips = [{'item': 'A', 'signer': 'S', 'tokens': [1, 2]},
                 {'item': 'B', 'signer': 'T', 'tokens': [3, 4, 5, 6]}]
        cond, inp, sig, target = batch_tensors(clips, {'A': 0, 'B': 1}, {'S': 0, 'T': 1}, 513, 512)
        self.assertTrue(torch.equal(cond, torch.tensor([0, 1])))
        self.assertTrue(torch.equal(sig, torch.tensor([0, 1])))
        self.assertEqual(inp.tolist(), [[1, 2, 513, 513], [3, 4, 5, 6]])
        self.assertEqual(target.tolist(), [[1, 2, 512, -100, -100], [3, 4, 5, 6, 512]])


if __name__ == '__main__': unittest.main()
