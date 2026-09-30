import serial
from PyQt5.QtCore import QThread, pyqtSignal
import time
import logging

log = logging.getLogger(__name__)

UART_MAGIC_WORD = bytearray(b'\x02\x01\x04\x03\x06\x05\x08\x07')

class SerialWorker(QThread):
    raw_frame_ready = pyqtSignal(bytearray)
    connection_status_changed = pyqtSignal(bool)

    def __init__(self, port, baud_rate, parent=None):
        super().__init__(parent)
        self.port = port
        self.baud_rate = baud_rate
        self.serial_port = None
        self._is_running = False

    def run(self):
        self._is_running = True
        try:
            self.serial_port = serial.Serial(
                self.port, 
                self.baud_rate, 
                parity=serial.PARITY_NONE, 
                stopbits=serial.STOPBITS_ONE, 
                timeout=0.6
            )
            self.serial_port.reset_output_buffer()
            self.connection_status_changed.emit(True)
        except Exception as e:
            log.error(f"Failed to open serial port {self.port}: {e}")
            self.connection_status_changed.emit(False)
            self._is_running = False
            return

        index = 0
        frame_data = bytearray()
        
        while self._is_running:
            try:
                magic_byte = self.serial_port.read(1)
                
                if len(magic_byte) < 1:
                    # Timeout, just loop back
                    continue
                
                if magic_byte[0] == UART_MAGIC_WORD[index]:
                    index += 1
                    frame_data.append(magic_byte[0])
                    if index == 8: # Found the full magic word
                        # Read version (4) and length (4)
                        header_bytes = self.serial_port.read(8)
                        frame_data += bytearray(header_bytes)
                        
                        if len(header_bytes) < 8:
                            # Incomplete header, reset
                            index = 0
                            frame_data = bytearray()
                            continue
                            
                        # Extract length (bytes 4-7 of header_bytes)
                        length_bytes = header_bytes[4:8]
                        frame_length = int.from_bytes(length_bytes, byteorder='little')
                        
                        # We have read 16 bytes so far (8 magic + 8 header)
                        bytes_to_read = frame_length - 16
                        
                        # Surface Classification has a hardcoded padding mismatch
                        # gui_parser unconditionally adds 4 bytes for this demo
                        bytes_to_read += 4
                        
                        if bytes_to_read > 0:
                            payload_bytes = self.serial_port.read(bytes_to_read)
                            frame_data += bytearray(payload_bytes)
                            
                        # Emit frame
                        self.raw_frame_ready.emit(frame_data)
                        
                        # Reset for next frame
                        index = 0
                        frame_data = bytearray()
                else:
                    if index == 0:
                        pass # Continue looking for magic word
                    else:
                        index = 0
                        frame_data = bytearray()
            except Exception as e:
                log.error(f"Serial read exception: {e}")
                break

        if self.serial_port and self.serial_port.is_open:
            self.serial_port.close()
            self.connection_status_changed.emit(False)

    def stop(self):
        self._is_running = False
