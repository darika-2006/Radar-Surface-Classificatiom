from PyQt5.QtCore import QObject, Qt
from .serial_worker import SerialWorker
from .frame_processor import FrameProcessor
from .classifier_bridge import ClassifierBridge
from .config_handler import ConfigHandler
import platform
import logging

log = logging.getLogger(__name__)

class RadarController(QObject):
    def __init__(self, data_bridge, parent=None):
        super().__init__(parent)
        self.data_bridge = data_bridge
        
        # Instantiate backend components
        self.frame_processor = FrameProcessor(self.data_bridge)
        self.classifier_bridge = ClassifierBridge(self.data_bridge)
        self.config_handler = ConfigHandler(self.data_bridge)
        
        # Connect internal pipeline
        self.frame_processor.parsed_frame_ready.connect(
            self.classifier_bridge.process_parsed_frame, 
            Qt.QueuedConnection
        )
        
        self.serial_worker = None
        self.data_port = None
        self.config_port = None
        
    def _derive_config_port(self, data_port):
        # TI mmWave EVMs typically enumerate 2 sequential COM ports.
        # Often Config port is X and Data port is X+1, or vice versa depending on OS and drivers.
        # This is a naive fallback if the UI doesn't provide a config port explicitly.
        try:
            if platform.system() == "Windows":
                # E.g., COM5 (Data) -> COM4 (Config)
                num = int(data_port.upper().replace("COM", ""))
                return f"COM{num-1}"
            elif platform.system() == "Linux":
                # E.g., /dev/ttyACM1 (Data) -> /dev/ttyACM0 (Config)
                if data_port.startswith("/dev/ttyACM"):
                    num = int(data_port.replace("/dev/ttyACM", ""))
                    return f"/dev/ttyACM{num-1}"
                elif data_port.startswith("/dev/ttyUSB"):
                    num = int(data_port.replace("/dev/ttyUSB", ""))
                    return f"/dev/ttyUSB{num-1}"
        except Exception as e:
            log.warning(f"Could not derive config port: {e}")
        
        return data_port

    def connect(self, port, baud=921600):
        if self.serial_worker is not None and self.serial_worker.isRunning():
            self.disconnect()
            
        self.data_port = port
        self.config_port = self._derive_config_port(port)
            
        self.serial_worker = SerialWorker(port, baud)
        
        # Connect signals crossing thread boundaries with QueuedConnection
        self.serial_worker.raw_frame_ready.connect(
            self.frame_processor.process_raw_frame, 
            Qt.QueuedConnection
        )
        self.serial_worker.connection_status_changed.connect(
            self.data_bridge.connection_status_changed.emit, 
            Qt.QueuedConnection
        )
        
        # Start reading
        self.serial_worker.start()
        
    def disconnect(self):
        if self.serial_worker is not None:
            self.serial_worker.stop()
            self.serial_worker.wait() # Wait for thread to finish cleanly
            self.serial_worker = None
        
        self.data_bridge.connection_status_changed.emit(False)
        
    def load_config(self, filepath):
        if not self.config_port:
            log.error("No config port determined. Connect to the sensor first.")
            return {}
            
        config_vals = self.config_handler.load_and_send(filepath, self.config_port, baud_rate=115200)
        return config_vals
