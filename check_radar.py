import serial
import time
import sys

def check_radar(data_port, baud_rate=921600):
    print(f"Attempting to open Data Port: {data_port} at {baud_rate} baud...")
    try:
        with serial.Serial(data_port, baud_rate, timeout=2.0) as ser:
            print("✅ Successfully opened port. Listening for incoming radar frames...\n")
            
            empty_reads = 0
            while True:
                # Read whatever is in the buffer
                data = ser.read(128)
                if data:
                    print(f"📡 [{time.strftime('%X')}] Received {len(data)} bytes! (Preview: {data[:16].hex()}...)")
                    empty_reads = 0
                else:
                    empty_reads += 1
                    print(f"⏳ [{time.strftime('%X')}] Waiting for data...")
                    
                    if empty_reads >= 3:
                        print("⚠️ Note: If you receive nothing, the radar might be waiting for its configuration file.")
                        print("   (TI radars stay completely silent until they receive their .cfg file over the Config Port).")
                        empty_reads = -10 # suppress the warning for a bit

    except serial.SerialException as e:
        print(f"❌ Error opening port {data_port}:")
        print(e)
        print("\nMake sure the port is not already in use by another program (like the UI).")
    except KeyboardInterrupt:
        print("\nExiting.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python check_radar.py <DATA_COM_PORT>")
        print("Example: python check_radar.py COM4")
        sys.exit(1)
        
    port_name = sys.argv[1]
    check_radar(port_name)
