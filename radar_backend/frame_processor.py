from PyQt5.QtCore import QObject, pyqtSignal, pyqtSlot
import sys
import time
import datetime
import logging
from radar_backend.custom_parser import CustomRadarParser

log = logging.getLogger(__name__)

class FrameProcessor(QObject):
    parsed_frame_ready = pyqtSignal(dict)

    def __init__(self, data_bridge, parent=None):
        super().__init__(parent)
        self.data_bridge = data_bridge
        self.parser = CustomRadarParser()
        
        self.frame_count = 0
        self.last_fps_time = time.time()
        self.frames_since_last_fps = 0

    @pyqtSlot(bytearray)
    def process_raw_frame(self, raw_frame):
        self.frame_count += 1
        self.frames_since_last_fps += 1
        
        current_time = time.time()
        if current_time - self.last_fps_time >= 1.0:
            fps = float(self.frames_since_last_fps) / (current_time - self.last_fps_time)
            self.data_bridge.frame_rate_updated.emit(fps)
            self.frames_since_last_fps = 0
            self.last_fps_time = current_time

        timestamp_str = datetime.datetime.now().strftime("%H:%M:%S")
        packet_size = len(raw_frame)

        try:
            parsed_data = self.parser.parse_frame(raw_frame)
            
            if parsed_data is None:
                parsed_data = {}
            
            parsed_data['frame_id'] = self.frame_count
            parsed_data['timestamp'] = timestamp_str
            parsed_data['packet_size'] = packet_size
            
            self.parsed_frame_ready.emit(parsed_data)
        except Exception as e:
            log.error(f"Error parsing frame: {e}")
