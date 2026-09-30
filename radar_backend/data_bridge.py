from PyQt5.QtCore import QObject, pyqtSignal

class DataBridge(QObject):
    classification_updated = pyqtSignal(dict)
    frame_rate_updated = pyqtSignal(float)
    connection_status_changed = pyqtSignal(bool)
    config_loaded = pyqtSignal(str)
