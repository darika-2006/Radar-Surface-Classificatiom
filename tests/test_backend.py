import sys
import time
from PyQt5.QtCore import QCoreApplication, pyqtSlot, QObject
from radar_backend.data_bridge import DataBridge
from radar_backend.radar_controller import RadarController

class MockUI(QObject):
    def __init__(self, data_bridge, parent=None):
        super().__init__(parent)
        self.data_bridge = data_bridge
        
        # Connect to DataBridge signals just like the real UI would
        self.data_bridge.classification_updated.connect(self.on_classification_updated)
        self.data_bridge.frame_rate_updated.connect(self.on_frame_rate)
        self.data_bridge.connection_status_changed.connect(self.on_connection_status)
        
    @pyqtSlot(dict)
    def on_classification_updated(self, data):
        print("\n" + "="*50)
        print(f"FRAME {data['frame_id']} | Time: {data['timestamp']} | Size: {data['packet_size']} bytes")
        print(f"BIN 1: {data['bin1_label']} ({data['bin1_confidence'] * 100:.1f}%)")
        print(f"BIN 2: {data['bin2_label']} ({data['bin2_confidence'] * 100:.1f}%)")
        print(f"Features: {data['features']}")
        
    @pyqtSlot(float)
    def on_frame_rate(self, fps):
        print(f"[FPS]: {fps:.1f} Hz")
        
    @pyqtSlot(bool)
    def on_connection_status(self, connected):
        status = "CONNECTED" if connected else "DISCONNECTED"
        print(f"[STATUS] Radar is now {status}")

def main():
    # We need a QCoreApplication to run Qt event loops and signals
    app = QCoreApplication(sys.argv)
    
    print("Initializing Radar Backend Test...")
    
    # Instantiate DataBridge
    data_bridge = DataBridge()
    
    # Hook up our Mock UI to print things to the console
    ui = MockUI(data_bridge)
    
    # Initialize the Controller
    controller = RadarController(data_bridge)
    
    def on_raw_frame(frame):
        print(f"[DEBUG] Raw frame received: {len(frame)} bytes")
        
    def on_connect_status(connected):
        if connected and controller.serial_worker:
            # Connect to raw frame signal to see if data is coming at all
            controller.serial_worker.raw_frame_ready.connect(on_raw_frame)
            
    data_bridge.connection_status_changed.connect(on_connect_status)
    
    # Prompt user for COM port
    # Note: On Windows, use COMx (e.g., COM5)
    # On Linux, use /dev/ttyACM1 or /dev/ttyUSB1
    port = input("Enter Radar Data Port (e.g. COM5 or /dev/ttyACM1): ").strip()
    baud = input("Enter Baud Rate (press enter for 921600): ").strip()
    if not baud:
        baud = 921600
    else:
        baud = int(baud)
        
    print(f"Connecting to {port} at {baud} baud...")
    controller.connect(port, baud)
    
    # Start the Qt Event Loop so signals can be processed
    sys.exit(app.exec_())

if __name__ == '__main__':
    main()
