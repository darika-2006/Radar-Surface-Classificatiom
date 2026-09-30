"""
test_radar_incoming.py
──────────────────────
Minimal script to verify that raw data is arriving from the TI mmWave radar
on the Data serial port.  No Qt, no full backend — just pyserial.

Usage:
  python test_radar_incoming.py                        # interactive prompts
  python test_radar_incoming.py /dev/ttyACM1           # Linux
  python test_radar_incoming.py COM5                   # Windows
  python test_radar_incoming.py /dev/ttyACM1 921600    # port + baud

What it checks:
  1. Port opens successfully
  2. Raw bytes are arriving (any bytes)
  3. The TI mmWave magic word (02 01 04 03 06 05 08 07) is detected in the stream
  4. Reports frame count, sizes, and throughput for 10 seconds then exits
"""

import sys
import time
import serial

# TI mmWave UART magic word (8 bytes)
MAGIC_WORD = bytes([0x02, 0x01, 0x04, 0x03, 0x06, 0x05, 0x08, 0x07])

DEFAULT_BAUD = 921600
TEST_DURATION_SEC = 10          # how long to listen before auto-exit
PRINT_EVERY_N_FRAMES = 5        # print a status line every N frames


def get_args():
    port = None
    baud = DEFAULT_BAUD

    if len(sys.argv) >= 2:
        port = sys.argv[1]
    if len(sys.argv) >= 3:
        baud = int(sys.argv[2])

    if port is None:
        port = input("Enter Radar Data Port (e.g. /dev/ttyACM1 or COM5): ").strip()
    if not port:
        print("No port specified. Exiting.")
        sys.exit(1)

    return port, baud


def open_port(port, baud):
    print(f"\n[.] Opening {port} at {baud} baud ...")
    try:
        ser = serial.Serial(
            port,
            baud,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=0.5,
        )
        ser.reset_input_buffer()
        print(f"[OK] Port opened: {ser.name}")
        return ser
    except serial.SerialException as exc:
        print(f"[FAIL] Could not open port: {exc}")
        sys.exit(1)


def run_test(ser, duration=TEST_DURATION_SEC):
    print(f"\n[.] Listening for {duration}s  (Ctrl-C to stop early) ...\n")

    total_bytes   = 0
    frame_count   = 0
    magic_found   = False
    buf           = bytearray()
    start         = time.time()

    try:
        while time.time() - start < duration:
            chunk = ser.read(256)

            if not chunk:
                continue

            total_bytes += len(chunk)
            buf.extend(chunk)

            while True:
                idx = buf.find(MAGIC_WORD)
                if idx == -1:
                    if len(buf) > 7:
                        buf = buf[-7:]
                    break

                magic_found = True
                buf = buf[idx + len(MAGIC_WORD):]

                # Read version (4) + totalPacketLen (4)
                header = ser.read(8)
                if len(header) < 8:
                    buf = bytearray()
                    break

                frame_len = int.from_bytes(header[4:8], byteorder='little')
                # +4 for Surface Classification padding quirk (see serial_worker.py)
                payload_to_read = max(0, frame_len - 16 + 4)

                payload = ser.read(payload_to_read)
                actual_frame_size = len(MAGIC_WORD) + len(header) + len(payload)

                frame_count += 1
                if frame_count % PRINT_EVERY_N_FRAMES == 0 or frame_count == 1:
                    elapsed = time.time() - start
                    fps = frame_count / elapsed if elapsed > 0 else 0
                    print(
                        f"  Frame #{frame_count:4d} | size={actual_frame_size:5d} B "
                        f"| declared={frame_len} B | {elapsed:.1f}s | {fps:.1f} fps"
                    )

                buf = bytearray()

    except KeyboardInterrupt:
        print("\n[!] Interrupted by user.")

    elapsed = time.time() - start
    return total_bytes, frame_count, magic_found, elapsed


def main():
    port, baud = get_args()
    ser = open_port(port, baud)

    try:
        total_bytes, frame_count, magic_found, elapsed = run_test(ser)
    finally:
        ser.close()

    print("\n" + "=" * 55)
    print("  TEST SUMMARY")
    print("=" * 55)
    print(f"  Duration       : {elapsed:.1f} s")
    print(f"  Total bytes rx : {total_bytes:,} B")
    if elapsed:
        print(f"  Avg throughput : {total_bytes/elapsed/1024:.1f} KB/s")

    if total_bytes == 0:
        print("\n  FAIL  No data received.")
        print("        Check: port name, USB cable, radar power.")
    elif not magic_found:
        print(f"\n  WARN  Got {total_bytes:,} bytes but magic word NOT found.")
        print("        Check: wrong port? config not loaded? wrong baud?")
    else:
        fps = frame_count / elapsed if elapsed else 0
        print(f"\n  PASS  Magic word detected! Frames={frame_count} ({fps:.1f} fps)")
        print("        Data is flowing correctly from the radar.")
    print("=" * 55)


if __name__ == "__main__":
    main()
