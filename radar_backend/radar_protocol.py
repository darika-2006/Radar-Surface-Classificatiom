"""Wire protocol for the flashed IWRL6432 Wet/Dry firmware.

This module deliberately has no TI-toolbox import. Protocol facts are from the
flashed firmware's ``surface.h`` and ``motion_detect.c`` sources.
"""
from __future__ import annotations

from dataclasses import dataclass
import struct
from typing import Callable

MAGIC_WORD = bytes((0x02, 0x01, 0x04, 0x03, 0x06, 0x05, 0x08, 0x07))
HEADER_FORMAT = "<Q8I"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)
TLV_HEADER_FORMAT = "<II"
TLV_HEADER_SIZE = struct.calcsize(TLV_HEADER_FORMAT)
TLV_SURFACE_CLASSIFICATION = 1031
SURFACE_PAYLOAD_FORMAT = "<If"
SURFACE_PAYLOAD_SIZE = struct.calcsize(SURFACE_PAYLOAD_FORMAT)
SURFACE_TYPE_WET_DRY = 1
SURFACE_TYPE_GRASS_NOT_GRASS = 2
MAX_PACKET_LENGTH = 1024 * 1024


@dataclass(frozen=True)
class PacketHeader:
    version: int
    total_packet_length: int
    platform: int
    frame_number: int
    time_cpu_cycles: int
    num_detected_objects: int
    num_tlvs: int
    subframe_number: int


class FrameExtractor:
    """Incrementally extract exactly declared packets from arbitrary UART chunks."""
    def __init__(self, diagnostic: Callable[[str], None] | None = None):
        self.buffer = bytearray()
        self.diagnostic = diagnostic or (lambda _: None)

    def feed(self, chunk: bytes) -> list[bytes]:
        self.buffer.extend(chunk)
        packets: list[bytes] = []
        while True:
            start = self.buffer.find(MAGIC_WORD)
            if start < 0:
                if len(self.buffer) > len(MAGIC_WORD) - 1:
                    del self.buffer[: -(len(MAGIC_WORD) - 1)]
                return packets
            if start:
                del self.buffer[:start]
            if len(self.buffer) < HEADER_SIZE:
                return packets
            total_length = struct.unpack_from("<I", self.buffer, 12)[0]
            if total_length < HEADER_SIZE or total_length > MAX_PACKET_LENGTH:
                self.diagnostic(f"Invalid totalPacketLen {total_length}; resynchronizing")
                del self.buffer[0]
                continue
            if len(self.buffer) < total_length:
                return packets
            packets.append(bytes(self.buffer[:total_length]))
            del self.buffer[:total_length]


def parse_packet(packet: bytes, diagnostic: Callable[[str], None] | None = None) -> dict:
    """Parse one complete, declared-length mmWave packet."""
    diagnostic = diagnostic or (lambda _: None)
    if len(packet) < HEADER_SIZE:
        raise ValueError(f"packet shorter than {HEADER_SIZE}-byte header")
    (magic, version, total_length, platform, frame_number, cpu_cycles,
     num_objects, num_tlvs, subframe) = struct.unpack_from(HEADER_FORMAT, packet)
    if magic.to_bytes(8, "little") != MAGIC_WORD:
        raise ValueError("packet does not begin with the mmWave magic word")
    if total_length != len(packet):
        raise ValueError(f"declared packet length {total_length} != received {len(packet)}")
    header = PacketHeader(version, total_length, platform, frame_number, cpu_cycles,
                          num_objects, num_tlvs, subframe)
    cursor, surface, tlvs = HEADER_SIZE, None, []
    for index in range(header.num_tlvs):
        if cursor + TLV_HEADER_SIZE > len(packet):
            raise ValueError(f"TLV {index}: truncated header")
        tlv_type, tlv_length = struct.unpack_from(TLV_HEADER_FORMAT, packet, cursor)
        cursor += TLV_HEADER_SIZE
        end = cursor + tlv_length
        if end > len(packet):
            raise ValueError(f"TLV {index} type {tlv_type}: payload exceeds packet")
        payload = packet[cursor:end]
        tlvs.append({"type": tlv_type, "length": tlv_length})
        diagnostic(f"TLV: {tlv_type}; payload: {tlv_length} bytes")
        if tlv_type == TLV_SURFACE_CLASSIFICATION:
            if tlv_length != SURFACE_PAYLOAD_SIZE:
                raise ValueError(f"surface TLV has {tlv_length} bytes; expected {SURFACE_PAYLOAD_SIZE}")
            surface_type, result = struct.unpack(SURFACE_PAYLOAD_FORMAT, payload)
            if surface_type == SURFACE_TYPE_WET_DRY:
                label = "Wet/Dry"
            elif surface_type == SURFACE_TYPE_GRASS_NOT_GRASS:
                label = "Grass/NotGrass"
            else:
                label = f"Type {surface_type}"
            surface = {"surfaceTypeId": surface_type, "surfaceType": label,
                       "classificationResult": float(result)}
        cursor = end
    return {"frameNum": header.frame_number, "numObj": header.num_detected_objects,
            "packetSize": total_length, "numTlvs": header.num_tlvs, "tlvs": tlvs,
            "surface": surface}
