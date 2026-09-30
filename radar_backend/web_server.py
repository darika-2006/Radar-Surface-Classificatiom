"""WebSocket bridge for the flashed IWRL6432BOOST Wet/Dry firmware.

Default mode is passive: firmware configuration is hard-coded, so no cfg or
invented ``sensorStart`` command is transmitted on connect.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import threading
import time
from pathlib import Path

import serial
from serial.tools import list_ports
import websockets

try:  # Supports both ``python -m`` and the README's direct-script invocation.
    from radar_backend.radar_protocol import FrameExtractor, parse_packet
    from radar_backend.temporal_smoother import TemporalSmoother
except ModuleNotFoundError:  # pragma: no cover - exercised by direct execution
    from radar_protocol import FrameExtractor, parse_packet
    from temporal_smoother import TemporalSmoother

logging.basicConfig(format="%(levelname)-8s [%(name)s] %(message)s",
                    level=logging.DEBUG if os.getenv("RADAR_DIAGNOSTIC") == "1" else logging.INFO)
log = logging.getLogger("radar_server")
DEFAULT_BAUD = 115200


def available_ports() -> list[dict]:
    return [{"device": p.device, "description": p.description, "hwid": p.hwid}
            for p in list_ports.comports()]


def choose_port(requested: str | None) -> str | None:
    ports = available_ports()
    if requested and requested.lower() not in {"auto", ""}:
        return requested
    for item in ports:
        if item["device"] == "/dev/ttyACM0":
            return item["device"]
    acm = [item["device"] for item in ports if Path(item["device"]).name.startswith("ttyACM")]
    return acm[0] if len(acm) == 1 else None


class RadarReader(threading.Thread):
    def __init__(self, port: str, baud: int, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop,
                 diagnostic: bool = False):
        super().__init__(daemon=True)
        self.port, self.baud, self.queue, self.loop = port, baud, queue, loop
        self.diagnostic, self._stop = diagnostic, threading.Event()
        self._extractor = FrameExtractor(self._diag)
        self._frame_count, self._fps_started = 0, time.monotonic()

    def _diag(self, message: str) -> None:
        if self.diagnostic:
            log.info("[RADAR] %s", message)

    def _put(self, message: dict) -> None:
        asyncio.run_coroutine_threadsafe(self.queue.put(message), self.loop)

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        self._diag(f"Detected serial ports: {available_ports()}")
        self._diag(f"Port: {self.port}")
        self._diag("Mode: IWRL6432BOOST single-port")
        self._diag(f"Baud: {self.baud}")
        self._diag("CFG: skipped")
        self._diag("Startup: no command sent (passive no-CFG read)")
        try:
            ser = serial.Serial(self.port, self.baud, parity=serial.PARITY_NONE,
                                stopbits=serial.STOPBITS_ONE, timeout=0.25)
        except Exception as exc:
            self._put({"type": "error", "message": f"Cannot open {self.port}: {exc}"})
            return
        self._put({"type": "status", "connected": True, "port": self.port, "baud": self.baud,
                   "boardMode": "IWRL6432BOOST single-port", "cfgSkipped": True})
        try:
            while not self._stop.is_set():
                chunk = ser.read(max(1, ser.in_waiting or 256))
                if not chunk:
                    continue
                for packet in self._extractor.feed(chunk):
                    self._diag("Magic word detected")
                    self._diag(f"Packet length: {len(packet)}")
                    try:
                        parsed = parse_packet(packet, self._diag)
                    except ValueError as exc:
                        log.warning("[RADAR] Dropped malformed packet: %s", exc)
                        continue
                    surface = parsed["surface"]
                    if surface is None:
                        continue
                    self._frame_count += 1
                    self._diag(f"surfaceType: {surface['surfaceTypeId']}")
                    self._diag(f"classificationResult: {surface['classificationResult']}")
                    parsed.update({"frameId": self._frame_count,
                                   "timestamp": dt.datetime.now().strftime("%H:%M:%S")})
                    self._put({"type": "frame", "data": parsed})
                    elapsed = time.monotonic() - self._fps_started
                    if elapsed >= 1:
                        self._put({"type": "fps", "value": round(self._frame_count / elapsed, 1)})
        finally:
            ser.close()
            self._put({"type": "status", "connected": False})


class RadarServer:
    def __init__(self):
        self.clients: set = set()
        self.reader: RadarReader | None = None
        self.queue: asyncio.Queue = asyncio.Queue()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.smoother = TemporalSmoother()

    async def handler(self, websocket):
        self.clients.add(websocket)
        try:
            async for raw in websocket:
                await self._handle_command(raw)
        finally:
            self.clients.discard(websocket)

    async def _handle_command(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        if msg.get("command") == "ports":
            await self.queue.put({"type": "ports", "ports": available_ports()})
        elif msg.get("command") == "connect":
            selected = choose_port(msg.get("port", "auto"))
            if not selected:
                await self.queue.put({"type": "error", "message": "No unambiguous serial port; select /dev/ttyACM* explicitly."})
                return
            if self.reader and self.reader.is_alive():
                self.reader.stop()
                self.reader.join(timeout=2)
            self.reader = RadarReader(selected, int(msg.get("baud", DEFAULT_BAUD)), self.queue,
                                      self.loop, bool(msg.get("diagnostic", False)))
            self.reader.start()
        elif msg.get("command") == "disconnect" and self.reader:
            self.reader.stop()

    def _shape(self, message: dict) -> dict | None:
        if message["type"] != "frame":
            return message
        d, s = message["data"], message["data"]["surface"]
        wet = s["classificationResult"]

        smooth_result = self.smoother.update(wet, s["surfaceTypeId"])

        if s["surfaceTypeId"] == 1:
            data = {"bin1Label": smooth_result["classification"], "bin1Confidence": round(smooth_result["confidence"], 4),
                    "bin2Label": "DRY" if smooth_result["classification"] == "WET" else "WET", "bin2Confidence": round(1.0 - smooth_result["confidence"], 4),
                    "probabilities": {"GRASS": 0.0, "NOT GRASS": 0.0,
                                      "WET": round(wet, 4), "DRY": round(1 - wet, 4)}}
        else:
            data = {"bin1Label": smooth_result["classification"], "bin1Confidence": round(smooth_result["confidence"], 4),
                    "bin2Label": "NOT GRASS" if smooth_result["classification"] == "GRASS" else "GRASS", "bin2Confidence": round(1.0 - smooth_result["confidence"], 4),
                    "probabilities": {"GRASS": round(wet, 4), "NOT GRASS": round(1 - wet, 4), "WET": 0.0, "DRY": 0.0}}
        data.update({"frameId": d["frameId"], "timestamp": d["timestamp"], "packetSize": d["packetSize"],
                     "surfaceType": s["surfaceType"], "surfaceTypeId": s["surfaceTypeId"],
                     "classificationResult": wet, "classification": smooth_result["classification"],
                     "confidence": smooth_result["confidence"], "features": {"detected_points": d["numObj"]},
                     "smoothedClassification": smooth_result["smoothedClassification"]})

        if os.getenv("RADAR_DIAGNOSTIC") == "1":
            log.debug("RAW=%.4f HISTORY=[%s] SMOOTHED=%.4f CLASS=%s",
                      smooth_result["rawClassification"],
                      ", ".join(f"{x:.4f}" for x in self.smoother.history),
                      smooth_result["smoothedClassification"],
                      smooth_result["classification"])

        return {"type": "classification", "data": data}

    async def broadcaster(self):
        while True:
            out = self._shape(await self.queue.get())
            if out and self.clients:
                encoded = json.dumps(out)
                await asyncio.gather(*(c.send(encoded) for c in list(self.clients)), return_exceptions=True)

    async def serve(self, host="localhost", port=8765):
        self.loop, self.queue = asyncio.get_running_loop(), asyncio.Queue()
        async with websockets.serve(self.handler, host, port):
            log.info("Radar WebSocket server listening on ws://%s:%s", host, port)
            await self.broadcaster()


if __name__ == "__main__":
    asyncio.run(RadarServer().serve())
