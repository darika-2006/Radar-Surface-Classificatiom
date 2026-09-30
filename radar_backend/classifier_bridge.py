from PyQt5.QtCore import QObject, pyqtSignal, pyqtSlot
import sys
import logging

log = logging.getLogger(__name__)

try:
    from radar_backend.temporal_smoother import TemporalSmoother
except ModuleNotFoundError:
    from temporal_smoother import TemporalSmoother

# Add TI Toolbox common folder to path so we can import their classification logic if needed
toolbox_path = "/home/darika-sivakumar/Downloads/radar_toolbox_4_00_00_05/tools/visualizers/Applications_Visualizer/common"
if toolbox_path not in sys.path:
    sys.path.append(toolbox_path)

class ClassifierBridge(QObject):
    def __init__(self, data_bridge, parent=None):
        super().__init__(parent)
        self.data_bridge = data_bridge
        self.smoother = TemporalSmoother()

    @pyqtSlot(dict)
    def process_parsed_frame(self, parsed_dict):
        # Default fallback structure
        output = {
            "bin1_label": "NOT GRASS",
            "bin1_confidence": 0.0,
            "bin2_label": "DRY",
            "bin2_confidence": 0.0,
            "probabilities": {
                "GRASS": 0.0,
                "NOT GRASS": 1.0,
                "WET": 0.0,
                "DRY": 1.0
            },
            "features": {
                "doppler_avg": 0.0,
                "range_avg": 0.0,
                "azimuth_mean": 0.0,
                "elevation_mean": 0.0,
                "detected_points": 0,
                "doppler_az_corr": 0.0
            },
            "frame_id": parsed_dict.get('frame_id', 0),
            "timestamp": parsed_dict.get('timestamp', "00:00:00"),
            "packet_size": parsed_dict.get('packet_size', 0)
        }

        try:
            # Extract features from the parsed TLV dict
            features_list = parsed_dict.get("features", [])
            output["features"]["detected_points"] = parsed_dict.get("numDetectedPoints", 0)
            
            # The toolbox features array might contain these. 
            # In parseGestureFeaturesTLV:
            # [wtDoppler, wtDopplerPos, wtDopplerNeg, wtRange, numDetections, wtAzimuthMean, wtElevMean, azDoppCorr, wtAzimuthStd, wtdElevStd]
            if len(features_list) >= 8:
                output["features"]["doppler_avg"] = float(features_list[0])
                output["features"]["range_avg"] = float(features_list[3])
                output["features"]["azimuth_mean"] = float(features_list[5])
                output["features"]["elevation_mean"] = float(features_list[6])
                output["features"]["doppler_az_corr"] = float(features_list[7])
            elif "gestureFeatures" in parsed_dict and len(parsed_dict["gestureFeatures"]) >= 8:
                gf = parsed_dict["gestureFeatures"]
                output["features"]["doppler_avg"] = float(gf[0])
                output["features"]["range_avg"] = float(gf[3])
                output["features"]["azimuth_mean"] = float(gf[5])
                output["features"]["elevation_mean"] = float(gf[6])
                output["features"]["doppler_az_corr"] = float(gf[7])

            # Extract classification outputs
            surface_type = parsed_dict.get("surfaceType")
            class_res = parsed_dict.get("classificationResult", 0.0)
            
            # Also check for fallback keys just in case
            if "surfaceClassificationOutput" in parsed_dict:
                class_res = parsed_dict["surfaceClassificationOutput"]
                # In parseSurfaceClassificationTLV it defaults to 'Wet/Dry'
                if surface_type is None:
                    surface_type = 'Wet/Dry'
            
            surface_type_id = 1 if surface_type == "Wet/Dry" else 2
            smooth_result = self.smoother.update(float(class_res), surface_type_id)
            
            if surface_type == "Grass/NotGrass":
                output["bin1_confidence"] = float(smooth_result["confidence"])
                output["bin1_label"] = smooth_result["classification"]
                output["probabilities"]["GRASS"] = float(class_res)
                output["probabilities"]["NOT GRASS"] = 1.0 - float(class_res)
            elif surface_type == "Wet/Dry":
                output["bin2_confidence"] = float(smooth_result["confidence"])
                output["bin2_label"] = smooth_result["classification"]
                output["probabilities"]["WET"] = float(class_res)
                output["probabilities"]["DRY"] = 1.0 - float(class_res)
                
        except Exception as e:
            log.error(f"Error in ClassifierBridge logic: {e}")

        # Emit to the UI
        self.data_bridge.classification_updated.emit(output)
