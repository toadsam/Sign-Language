"""기하 분해·경계 진단·품질 기준을 합성 좌표로 검증한다."""
import unittest
import numpy as np

from eval.analyze_errors import descriptors, quality, windows


class ErrorDiagnosticsTest(unittest.TestCase):
    def test_finger_shape_ignores_wrist_translation(self):
        a=np.zeros((64,330),np.float32)
        b=a.copy()
        b[:,:165].reshape(64,55,3)[:,13:55]=1
        da,db=descriptors(a),descriptors(b)
        np.testing.assert_array_equal(da["finger_relative"],db["finger_relative"])
        np.testing.assert_array_equal(da["body"],db["body"])
        self.assertFalse(np.array_equal(da["wrists"],db["wrists"]))
        b[:,:165].reshape(64,55,3)[:,17,0]+=0.1
        self.assertFalse(np.array_equal(da["finger_relative"],descriptors(b)["finger_relative"]))

    def test_windows_remain_valid_at_edges_and_short_intervals(self):
        for frames,active in ((1,[0,0]),(3,[0,2]),(16,[0,1]),(16,[14,15]),(64,[8,40])):
            for interval in windows(active,frames).values():
                if interval is not None:
                    self.assertTrue(0<=interval[0]<=interval[1]<frames)

    def test_quality_uses_strict_team_thresholds(self):
        meta={"check":{"wrist_gap_cm":[5,5]}}
        self.assertEqual(quality(meta,{"gap_peak_cm":20,"step_peak_cm":50}),"usable")
        self.assertEqual(quality(meta,{"gap_peak_cm":100,"step_peak_cm":50}),"review")
        self.assertEqual(quality(meta,{"gap_peak_cm":100.01,"step_peak_cm":50}),"hold")
        self.assertEqual(quality({"check":{"wrist_gap_cm":[5.01]}},{"gap_peak_cm":0,"step_peak_cm":0}),"review")


if __name__=="__main__":
    unittest.main()
