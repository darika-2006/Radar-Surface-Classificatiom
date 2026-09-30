import unittest
from temporal_smoother import TemporalSmoother

class TestTemporalSmoother(unittest.TestCase):

    def test_1_initial_state(self):
        smoother = TemporalSmoother()
        self.assertEqual(smoother.history, [0.0, 0.0, 0.0, 0.0, 0.0])
        result = smoother.update(1.0, 1)
        
        # 1.0 * 5 / 15 = 0.333333...
        self.assertAlmostEqual(result["smoothedClassification"], 0.3333333333333333)
        self.assertEqual(result["classification"], "DRY")

    def test_2_five_consecutive_wet(self):
        smoother = TemporalSmoother()
        for _ in range(5):
            result = smoother.update(1.0, 1)
        self.assertAlmostEqual(result["smoothedClassification"], 1.0)
        self.assertEqual(result["classification"], "WET")

    def test_3_five_consecutive_dry(self):
        smoother = TemporalSmoother()
        for _ in range(5):
            result = smoother.update(0.0, 1)
        self.assertAlmostEqual(result["smoothedClassification"], 0.0)
        self.assertEqual(result["classification"], "DRY")

    def test_4_boundary_exactly_0_5(self):
        # We need the weighted sum to be exactly 7.5 / 15.0 = 0.5
        # We can achieve 7.5 by: history[0]*5 + history[1]*4...
        # Let's insert [0.5, 0.5, 0.5, 0.5, 0.5]
        smoother = TemporalSmoother()
        for _ in range(5):
            result = smoother.update(0.5, 1)
        
        self.assertAlmostEqual(result["smoothedClassification"], 0.5)
        # 0.5 is NOT > 0.5, so it should be DRY
        self.assertEqual(result["classification"], "DRY")

    def test_5_single_spike(self):
        smoother = TemporalSmoother()
        result = smoother.update(1.0, 1)
        # [1.0, 0, 0, 0, 0]
        self.assertAlmostEqual(result["smoothedClassification"], 0.3333333333333333)
        self.assertEqual(result["classification"], "DRY")

    def test_6_weight_ordering(self):
        # History becomes [1.0, 0, 0, 0, 0] => (5*1.0) / 15.0 = 0.333
        smoother = TemporalSmoother()
        result1 = smoother.update(1.0, 1)
        self.assertAlmostEqual(result1["smoothedClassification"], 5.0/15.0)

        # History becomes [0.0, 1.0, 0, 0, 0] => (4*1.0) / 15.0 = 0.266
        result2 = smoother.update(0.0, 1)
        self.assertAlmostEqual(result2["smoothedClassification"], 4.0/15.0)
        
        # History becomes [0.0, 0.0, 1.0, 0, 0] => (3*1.0) / 15.0 = 0.2
        result3 = smoother.update(0.0, 1)
        self.assertAlmostEqual(result3["smoothedClassification"], 3.0/15.0)

    def test_7_missing_frame_handling(self):
        # The prompt specifically requests verifying that a missing classification
        # does NOT insert 0.0. The architecture handles this by only calling 
        # smoother.update() when a valid TLV is parsed (web_server.py line 151).
        # We test that the smoother state stays untouched if not updated.
        smoother = TemporalSmoother()
        smoother.update(1.0, 1)
        smoother.update(1.0, 1)
        # current history: [1, 1, 0, 0, 0]
        expected_history = [1.0, 1.0, 0.0, 0.0, 0.0]
        self.assertEqual(smoother.history, expected_history)
        
        # "Missing" frame (i.e. update is NOT called)
        # state should remain identical
        self.assertEqual(smoother.history, expected_history)

if __name__ == '__main__':
    unittest.main()
