import struct
import unittest

from radar_backend.radar_protocol import (
    FrameExtractor, HEADER_FORMAT, MAGIC_WORD, TLV_HEADER_FORMAT,
    TLV_SURFACE_CLASSIFICATION, parse_packet,
)


def packet(frame_number: int, wet_probability: float) -> bytes:
    payload = struct.pack("<If", 1, wet_probability)
    body = struct.pack(TLV_HEADER_FORMAT, TLV_SURFACE_CLASSIFICATION, len(payload)) + payload
    length = 40 + len(body)
    padded_length = (length + 31) & ~31
    header = struct.pack(HEADER_FORMAT, int.from_bytes(MAGIC_WORD, "little"), 0x05050000,
                         padded_length, 0xA1642, frame_number, 0, 0, 1, 0xFFFFFFFF)
    return header + body + bytes(padded_length - length)


class ProtocolTests(unittest.TestCase):
    def test_partial_noise_and_concatenated_packets(self):
        first, second = packet(7, 0.83), packet(8, 0.18)
        parser = FrameExtractor()
        packets = []
        for chunk in (b"noise" + first[:13], first[13:] + second[:5], second[5:]):
            packets.extend(parser.feed(chunk))
        self.assertEqual([len(first), len(second)], [len(p) for p in packets])
        self.assertEqual("Wet", parse_packet(packets[0])["surface"]["classification"])
        parsed = parse_packet(packets[1])["surface"]
        self.assertEqual("Dry", parsed["classification"])
        self.assertAlmostEqual(0.82, parsed["confidence"], places=6)

    def test_declared_length_includes_padding(self):
        raw = packet(1, 0.5)
        self.assertEqual(len(raw), struct.unpack_from("<I", raw, 12)[0])
        self.assertEqual(64, len(raw))


if __name__ == "__main__":
    unittest.main()
