import serial
import time
import logging
import os
import math
from PyQt5.QtCore import QObject

log = logging.getLogger(__name__)

class ConfigHandler(QObject):
    def __init__(self, data_bridge, parent=None):
        super().__init__(parent)
        self.data_bridge = data_bridge
        
    def load_and_send(self, filepath, port, baud_rate=115200):
        extracted_config = {
            "Max range (m)": 0.0,
            "Range resolution (m)": 0.0,
            "Max velocity (m/s)": 0.0,
            "Number of chirps": 0,
            "Frame rate (Hz)": 0.0
        }
        
        try:
            with open(filepath, 'r') as f:
                lines = f.readlines()
                
            # Parse the relevant lines manually
            profile_cfg = None
            frame_cfg = None
            
            for line in lines:
                if line.startswith("profileCfg"):
                    profile_cfg = line.split()
                elif line.startswith("frameCfg"):
                    frame_cfg = line.split()
                    
            if profile_cfg and len(profile_cfg) >= 14:
                # profileCfg <id> <startFreq> <idleTime> <adcStartTime> <rampEndTime> <txOutPower> <txPhaseShifter> <freqSlopeConst> <txStartTime> <numAdcSamples> <digOutSampleRate>
                freq_slope_const = float(profile_cfg[8])
                num_adc_samples = float(profile_cfg[10])
                dig_out_sample_rate = float(profile_cfg[11])
                
                # Approximate calculations based on standard TI mmWave equations
                c = 3e8
                if freq_slope_const > 0 and dig_out_sample_rate > 0:
                    bandwidth = freq_slope_const * 1e12 * (num_adc_samples / (dig_out_sample_rate * 1e3))
                    range_res = c / (2 * bandwidth)
                    max_range = dig_out_sample_rate * 1e3 * c / (2 * freq_slope_const * 1e12)
                    
                    extracted_config["Range resolution (m)"] = round(range_res, 3)
                    extracted_config["Max range (m)"] = round(max_range, 2)
                    
                # Note: Max velocity requires chirp time which involves idleTime + rampEndTime
                idle_time = float(profile_cfg[3])
                ramp_end_time = float(profile_cfg[5])
                chirp_time = (idle_time + ramp_end_time) * 1e-6
                if chirp_time > 0:
                    # v_max = lambda / (4 * Tc)
                    start_freq = float(profile_cfg[2]) * 1e9
                    wavelength = c / start_freq if start_freq > 0 else 0
                    max_vel = wavelength / (4 * chirp_time)
                    extracted_config["Max velocity (m/s)"] = round(max_vel, 2)
                    
            if frame_cfg and len(frame_cfg) >= 6:
                # frameCfg <chirpStartIdx> <chirpEndIdx> <numLoops> <numFrames> <framePeriodicity>
                chirp_start = int(frame_cfg[1])
                chirp_end = int(frame_cfg[2])
                num_loops = int(frame_cfg[3])
                frame_periodicity = float(frame_cfg[5])
                
                num_chirps = (chirp_end - chirp_start + 1) * num_loops
                extracted_config["Number of chirps"] = num_chirps
                
                if frame_periodicity > 0:
                    extracted_config["Frame rate (Hz)"] = round(1000.0 / frame_periodicity, 2)
            
            # Send to sensor
            with serial.Serial(port, baud_rate, timeout=1.0) as ser:
                # Remove empty and commented lines
                cfg_lines = [line + '\n' if not line.endswith('\n') else line for line in lines if line.strip() and not line.startswith('%')]
                
                for line in cfg_lines:
                    ser.write(line.encode())
                    time.sleep(0.03)
                    ack1 = ser.readline()
                    ack2 = ser.readline()
                    
            filename = os.path.basename(filepath)
            self.data_bridge.config_loaded.emit(filename)
            return extracted_config
            
        except Exception as e:
            log.error(f"Failed to load and send config: {e}")
            return extracted_config
