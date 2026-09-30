class TemporalSmoother:
    """Reproduces the original TI 5-frame weighted average classification smoothing."""
    def __init__(self):
        self.history = [0.0, 0.0, 0.0, 0.0, 0.0]

    def update(self, raw_probability: float, surface_type_id: int) -> dict:
        """
        Updates the history and returns the normalized classification dict.
        Weights: 5 for newest, 4 for next, etc.
        """
        self.history.insert(0, raw_probability)
        self.history = self.history[:5]

        smoothed = (
            self.history[0] * 5.0 +
            self.history[1] * 4.0 +
            self.history[2] * 3.0 +
            self.history[3] * 2.0 +
            self.history[4] * 1.0
        ) / 15.0

        if smoothed > 0.5:
            classification = "WET" if surface_type_id == 1 else "GRASS"
            confidence = raw_probability
        else:
            classification = "DRY" if surface_type_id == 1 else "NOT GRASS"
            confidence = 1.0 - raw_probability

        return {
            "rawClassification": raw_probability,
            "smoothedClassification": smoothed,
            "classification": classification,
            "confidence": confidence
        }
