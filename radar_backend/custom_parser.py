import struct
import logging

log = logging.getLogger(__name__)

# TLV Identifiers from TI toolbox
TLV_SURFACE_CLASSIFICATION = 10312
TLV_GESTURE_FEATURES_6843 = 1050
TLV_GESTURE_FEATURES_6432 = 350
TLV_POINT_CLOUD = 1
TLV_TARGET_LIST = 1010
TLV_TARGET_INDEX = 1011

class CustomRadarParser:
    def __init__(self):
        pass

    def parse_frame(self, frame_data):
        """
        Parses a raw TI mmWave standard frame robustly.
        Returns a dictionary with parsed outputs or None if invalid.
        """
        output = {
            "error": False,
            "classificationResult": 0.0,
            "surfaceType": "Wet/Dry", # Default assumption based on TI logic
            "features": {
                "doppler_avg": 0.0,
                "range_avg": 0.0,
                "azimuth_mean": 0.0,
                "elevation_mean": 0.0,
                "detected_points": 0,
                "doppler_az_corr": 0.0
            }
        }

        # Header format: Q8I (8 bytes magic + 8 * 4 bytes)
        header_struct = 'Q8I'
        header_len = struct.calcsize(header_struct)

        if len(frame_data) < header_len:
            log.warning("Frame too short to contain header.")
            output["error"] = True
            return output

        try:
            (magic, version, totalPacketLen, platform, frameNum, 
             timeCPUCycles, numDetectedObj, numTLVs, subFrameNum) = struct.unpack(header_struct, frame_data[:header_len])
        except Exception as e:
            log.error(f"Failed to unpack frame header: {e}")
            output["error"] = True
            return output

        output['frameNum'] = frameNum
        output['numDetectedObj'] = numDetectedObj

        # Shift to start of TLVs
        tlv_data = frame_data[header_len:]

        for i in range(numTLVs):
            if len(tlv_data) < 8:
                log.warning(f"Not enough data for TLV header. Expected 8, got {len(tlv_data)}")
                output["error"] = True
                break
            
            try:
                tlv_type, tlv_length = struct.unpack('2I', tlv_data[:8])
            except Exception as e:
                log.error(f"Failed to unpack TLV header: {e}")
                output["error"] = True
                break
                
            tlv_payload = tlv_data[8:8+tlv_length]
            
            if len(tlv_payload) < tlv_length:
                log.warning(f"TLV {tlv_type} truncated. Expected {tlv_length}, got {len(tlv_payload)}")
                output["error"] = True
                break

            self._parse_tlv(tlv_type, tlv_length, tlv_payload, output)

            # Move to next TLV
            tlv_data = tlv_data[8+tlv_length:]

        return output

    def _parse_tlv(self, tlv_type, tlv_length, payload, output):
        try:
            if tlv_type == TLV_SURFACE_CLASSIFICATION:
                if tlv_length >= 4:
                    val = struct.unpack('1f', payload[:4])[0]
                    output['classificationResult'] = val
                else:
                    log.warning(f"Surface Classification TLV too short: {tlv_length}")

            elif tlv_type in (TLV_GESTURE_FEATURES_6843, TLV_GESTURE_FEATURES_6432):
                # 10 floats in TI's gesture features array
                if tlv_length >= 40:
                    features = struct.unpack('10f', payload[:40])
                    output["features"]["doppler_avg"] = features[0]
                    output["features"]["range_avg"] = features[3]
                    output["features"]["azimuth_mean"] = features[5]
                    output["features"]["elevation_mean"] = features[6]
                    output["features"]["doppler_az_corr"] = features[7]
                else:
                    log.warning(f"Features TLV too short: {tlv_length}")
            
            # Additional TLVs can be parsed here if needed
        except Exception as e:
            log.error(f"Error parsing TLV {tlv_type}: {e}")
