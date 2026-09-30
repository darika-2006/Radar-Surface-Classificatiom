import sys
import os
import pyqtgraph as pg
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QLabel, QPushButton, QComboBox, 
                             QGroupBox, QProgressBar)
from PyQt5.QtCore import Qt, pyqtSlot

# Import Backend components
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from radar_backend.data_bridge import DataBridge
from radar_backend.radar_controller import RadarController

class RadarVisualizerWindow(QMainWindow):
    def __init__(self, data_bridge, controller):
        super().__init__()
        self.data_bridge = data_bridge
        self.controller = controller
        
        self.setWindowTitle("Surface Classification Radar Visualizer")
        self.resize(1000, 700)
        
        # Connect signals
        self.data_bridge.classification_updated.connect(self.update_data)
        self.data_bridge.connection_status_changed.connect(self.update_status)
        self.data_bridge.frame_rate_updated.connect(self.update_fps)
        
        self._init_ui()
        
        # History buffers for plotting
        self.history_len = 100
        self.doppler_history = [0.0] * self.history_len
        self.range_history = [0.0] * self.history_len
        self.time_axis = list(range(-self.history_len, 0))
        
    def _init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)
        
        # --- Top Control Panel ---
        control_layout = QHBoxLayout()
        
        self.port_combo = QComboBox()
        self.port_combo.setEditable(True)
        # Default options based on OS
        if os.name == 'nt':
            self.port_combo.addItems(['COM4', 'COM5', 'COM6'])
        else:
            self.port_combo.addItems(['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyUSB0'])
            
        self.baud_combo = QComboBox()
        self.baud_combo.addItems(['921600', '115200', '3000000'])
        
        self.connect_btn = QPushButton("Connect")
        self.connect_btn.clicked.connect(self.toggle_connection)
        
        self.status_label = QLabel("DISCONNECTED")
        self.status_label.setStyleSheet("color: red; font-weight: bold;")
        
        self.fps_label = QLabel("FPS: 0.0")
        
        control_layout.addWidget(QLabel("Port:"))
        control_layout.addWidget(self.port_combo)
        control_layout.addWidget(QLabel("Baud:"))
        control_layout.addWidget(self.baud_combo)
        control_layout.addWidget(self.connect_btn)
        control_layout.addWidget(self.status_label)
        control_layout.addStretch()
        control_layout.addWidget(self.fps_label)
        
        layout.addLayout(control_layout)
        
        # --- Classification Gauges ---
        class_group = QGroupBox("Classification Outputs")
        class_layout = QVBoxLayout()
        
        # Grass vs Not Grass
        grass_layout = QHBoxLayout()
        grass_layout.addWidget(QLabel("Grass Probability:"))
        self.grass_bar = QProgressBar()
        self.grass_bar.setRange(0, 100)
        self.grass_label = QLabel("Unknown")
        self.grass_label.setFixedWidth(100)
        grass_layout.addWidget(self.grass_bar)
        grass_layout.addWidget(self.grass_label)
        class_layout.addLayout(grass_layout)
        
        # Wet vs Dry
        wet_layout = QHBoxLayout()
        wet_layout.addWidget(QLabel("Wet Probability:  "))
        self.wet_bar = QProgressBar()
        self.wet_bar.setRange(0, 100)
        self.wet_label = QLabel("Unknown")
        self.wet_label.setFixedWidth(100)
        wet_layout.addWidget(self.wet_bar)
        wet_layout.addWidget(self.wet_label)
        class_layout.addLayout(wet_layout)
        
        class_group.setLayout(class_layout)
        layout.addWidget(class_group)
        
        # --- Realtime Plots ---
        plot_group = QGroupBox("Radar Features")
        plot_layout = QVBoxLayout()
        
        self.graph_widget = pg.GraphicsLayoutWidget()
        plot_layout.addWidget(self.graph_widget)
        
        self.doppler_plot = self.graph_widget.addPlot(title="Average Doppler (m/s)")
        self.doppler_plot.setYRange(-2, 2)
        self.doppler_curve = self.doppler_plot.plot(pen='y')
        
        self.graph_widget.nextRow()
        
        self.range_plot = self.graph_widget.addPlot(title="Average Range (m)")
        self.range_plot.setYRange(0, 5)
        self.range_curve = self.range_plot.plot(pen='g')
        
        plot_group.setLayout(plot_layout)
        layout.addWidget(plot_group)
        
    def toggle_connection(self):
        if self.connect_btn.text() == "Connect":
            port = self.port_combo.currentText()
            baud = int(self.baud_combo.currentText())
            self.controller.connect(port, baud)
        else:
            self.controller.disconnect()
            
    @pyqtSlot(bool)
    def update_status(self, connected):
        if connected:
            self.status_label.setText("CONNECTED")
            self.status_label.setStyleSheet("color: green; font-weight: bold;")
            self.connect_btn.setText("Disconnect")
        else:
            self.status_label.setText("DISCONNECTED")
            self.status_label.setStyleSheet("color: red; font-weight: bold;")
            self.connect_btn.setText("Connect")
            
    @pyqtSlot(float)
    def update_fps(self, fps):
        self.fps_label.setText(f"FPS: {fps:.1f}")
        
    @pyqtSlot(dict)
    def update_data(self, data):
        # Update classification bars
        if "GRASS" in data.get("probabilities", {}):
            val = int(data["probabilities"]["GRASS"] * 100)
            self.grass_bar.setValue(val)
            self.grass_label.setText(data.get("bin1_label", "Unknown"))
        
        if "WET" in data.get("probabilities", {}):
            val = int(data["probabilities"]["WET"] * 100)
            self.wet_bar.setValue(val)
            self.wet_label.setText(data.get("bin2_label", "Unknown"))
            
        # Update plots
        feats = data.get("features", {})
        dop = feats.get("doppler_avg", 0.0)
        rng = feats.get("range_avg", 0.0)
        
        self.doppler_history.pop(0)
        self.doppler_history.append(dop)
        self.doppler_curve.setData(self.time_axis, self.doppler_history)
        
        self.range_history.pop(0)
        self.range_history.append(rng)
        self.range_curve.setData(self.time_axis, self.range_history)


def main():
    app = QApplication(sys.argv)
    
    # Global Qt settings for clean style
    app.setStyle("Fusion")
    
    data_bridge = DataBridge()
    controller = RadarController(data_bridge)
    
    window = RadarVisualizerWindow(data_bridge, controller)
    window.show()
    
    sys.exit(app.exec_())

if __name__ == '__main__':
    main()
