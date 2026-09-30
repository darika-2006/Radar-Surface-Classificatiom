# Radar backend forensic verification

## Evidence examined

- Manus production path: `radar_backend/web_server.py`, React `client/src/pages/Home.tsx`.
- TI Toolbox 4.00.00.05: `Applications_Visualizer/common/{gui_core.py,gui_parser.py,parseFrame.py,parseTLVs.py,demo_defines.py,tlv_defines.py}`.
- Flashed-firmware source: `Radrar_Forensics/flashed_bin/surface_classification_xwrL64xx-WET-DRY/{surface.h,motion_detect.c,mmw_cli.c}`.

## Findings

`DEVICE_DEMO_DICT` declares `xWRL6432.singleCOM = True`. TI connects it with
`connectComPort`, which opens only `cliCom`; the same port is later read by
`readAndParseUartSingleCOMPort`. The Toolbox chooses 115200 for Surface
Classification (1250000 is selected only for a listed set of other demos).
The hard-coded firmware sources and accompanying Kobuki guide identify
`/dev/ttyACM0` and 115200 for the IWRL6432 setup.

TI's **Start without Send Configuration** button is connected to `startApp`.
For normal hardware, that function only starts the parser timer. It does not
call `sendCfg`, `sendLine`, or send `sensorStart`. Consequently this backend
uses passive no-CFG reading and sends no startup command. The hard-coded
firmware guide says the modified demo starts UART transmission on reset. The
firmware's `radarCmdString` also contains a hard-coded configuration sequence
ending in `sensorStart 0 0 0 0`; the submitted source subset does not expose
the application's call site for `CLI_ByPassApi`, so that command is evidence
of firmware-internal startup configuration, not authorization to resend it
from the host.

The firmware defines TLV 1031 as
`MmwDemo_output_message_surface = { uint32_t surfaceType; float classificationResult; }`.
It assigns `SURFACE_TYPE_WET_DRY` (1), and comments that a result closer to 1
means greater confidence in Wet. Type 2 is defined as Grass/NotGrass, but the
flashed Wet/Dry emitter assigns type 1. The backend therefore applies a 0.5
Wet/Dry decision only for type 1; it deliberately does not invent float
semantics for type 2.

`motion_detect.c` rounds `header.totalPacketLen` to
`MMWDEMO_OUTPUT_MSG_SEGMENT_LEN` (32) and then transmits the calculated padding.
Thus `totalPacketLen` includes the padding. After magic/version/length, 16 bytes
have been consumed, but a robust buffered parser need not perform a separate
read calculation: it waits for the complete declared `totalPacketLen`. There
is no source support for adding four bytes; that can consume the next frame.

## Comparison

| Area | Previous Manus production backend | TI / firmware evidence | Verdict |
| --- | --- | --- | --- |
| Board mode | derives a second config port | xWRL6432 is `singleCOM` | INCORRECT |
| Port | user-selected data port plus inferred neighbor | one `/dev/ttyACM*` port, reference setup uses ACM0 | INCORRECT |
| Baud | UI default 115200 but code logs contradictory values | 115200 for Surface Classification | NEEDS FIX (fixed) |
| CFG | always reads and sends `surface_classification.cfg` | no-CFG start only begins parsing | INCORRECT |
| Startup | implicitly sends cfg, including sensor start | no-CFG sends no command | INCORRECT |
| Frame reads | reads one byte then assumes one complete blocking read | `totalPacketLen` includes 32-byte padding | INCORRECT |
| Extra length | unconditionally adds 4 | no source support | INCORRECT |
| Synchronization | loses buffered bytes on partial reads | magic word is `02 01 04 03 06 05 08 07` | INCORRECT |
| TLV id | 10312 | flashed firmware emits 1031 | INCORRECT |
| TLV payload | reads one float | `<uint32, float>`, exactly 8 bytes | INCORRECT |
| Wet/Dry semantics | defaults to Wet/Dry even without type | firmware explicitly sets type 1 and says float approaches Wet | INCORRECT |
| UI transport | WebSocket JSON to React | UI consumes `classification` messages | CORRECT |
| Mock data | none in web-server production path | n/a | CORRECT |

## Verification level

- **Static verified:** all findings above from inspected TI and firmware sources.
- **Replay verified:** synthetic protocol replay in `tests/test_radar_protocol.py` covers noise, split reads, concatenated frames, 32-byte padding, TLV 1031, Wet and Dry decoding.
- **Live radar verified:** not performed; no serial ports were present during this verification.
