"""동일 최빈 표기를 개별 클립 라벨로 오인하지 않는지 검증한다."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from eval.review_label_confusions import compare_hands, main, majority, resample_positions
from recog.features import prepare


class LabelReviewTest(unittest.TestCase):
    def test_same_resampling_as_recognizer(self):
        x=np.random.default_rng(3).normal(size=(17,375)).astype(np.float32)
        positions=resample_positions(x,[3,12])
        expected=prepare(x,[3,12],np.arange(55),64)[:,:165].reshape(64,55,3)
        np.testing.assert_array_equal(positions[:,:55],expected)

    def test_wrist_translation_and_finger_shape_are_distinct(self):
        a=np.zeros((64,125,3),np.float32)
        b=a.copy(); b[:,13:55]=1
        m=compare_hands(a,b)
        self.assertFalse(m["wrists"]["exact_equal"])
        self.assertTrue(m["left_fingers"]["exact_equal"])
        self.assertTrue(m["right_fingers"]["exact_equal"])
        b[:,17,0]+=.1
        self.assertFalse(compare_hands(a,b)["left_fingers"]["exact_equal"])

    def test_majority_ties_are_explicit(self):
        _,unique=majority([{"gloss":["A"]},{"gloss":["B"]}])
        self.assertFalse(unique)

    def test_actual_labels_do_not_inherit_training_majority(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/"source/full"; data=root/"prepared/full"; run=root/"run"; out=root/"review"
            (source/"npy").mkdir(parents=True); data.mkdir(parents=True); run.mkdir()
            rows=[]
            for signer in ("A","B"):
                for item in ("WORD0001","WORD0002"):
                    x=np.zeros((8,375),np.float32)
                    if item=="WORD0002": x[:,17*3]=.1
                    clip=f"{item}_{signer}"
                    gloss=["shared"] if signer=="A" else ["actual_"+item]
                    rows.append({"clip":clip,"item":item,"signer":signer,"gloss":gloss,"active":[1,6]})
                    np.save(source/"npy"/f"{clip}.npy",x)
            metadata="".join(json.dumps(r)+"\n" for r in rows)
            (source/"meta.jsonl").write_text(metadata); (data/"meta.jsonl").write_text(metadata)
            (data/"preparation.json").write_text(json.dumps({"source":str(source)}))
            split={"signers":{"train":["A"],"val":[],"test":["B"]}}
            (data/"split_snapshot.json").write_text(json.dumps(split))
            (run/"summary.json").write_text(json.dumps({"config":{"data":str(data)},"split":split}))
            (run/"model.pt").write_bytes(b"model sentinel")
            (run/"audit_failures.json").write_text(json.dumps([{"clip":"WORD0001_B","target":"WORD0001","top5":["WORD0002"]}]))
            with patch.object(sys,"argv",["review","--run",str(run),"--out",str(out),"--expected-cases","1"]),redirect_stdout(io.StringIO()):
                main()
            report=json.loads((out/"review.json").read_text())
            self.assertEqual(report["counts"]["actual_same_gloss_cases"],0)
            self.assertEqual(report["counts"]["hands_numerically_different_cases"],1)
            self.assertEqual(report["cases"][0]["actual_target_gloss"],["actual_WORD0001"])
            self.assertEqual((source/"meta.jsonl").read_text(),metadata)
            self.assertEqual((run/"model.pt").read_bytes(),b"model sentinel")


if __name__=="__main__":
    unittest.main()
