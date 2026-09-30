# 1. Executive Summary

The system sporadically reports WET on visibly dry surfaces primarily because the classification pipeline lacks any temporal smoothing (averaging or hysteresis) and relies entirely on a hard `> 0.5` threshold applied instantaneously to raw frame data. Additionally, if the radar drops a classification TLV, the backend silently ignores the frame, causing the frontend to cache and indefinitely freeze the last known classification state.

# 2. Complete Data Flow

1. **Hardware (IWRL6432BOOST) → UART**
2. **UART Byte Stream** → `radar_backend/web_server.py` (`RadarReader.run()`)
3. **Frame Extraction** → `radar_backend/radar_protocol.py` (`FrameExtractor.feed()`)
4. **Packet Parsing & TLV Extraction** → `radar_backend/radar_protocol.py` (`parse_packet()`)
5. **Backend Normalization** → `radar_backend/web_server.py` (`_shape()`)
6. **API / WebSocket Delivery** → `radar_backend/web_server.py` (`broadcaster()`)
7. **Frontend State Reception** → `client/src/pages/Home.tsx` (`handleMessage()`)
8. **Frontend Threshold & Logic** → `client/src/pages/Home.tsx` (`buildClassification()`)
9. **UI Display** → `client/src/components/classification/SurfaceAnimation.tsx`

# 3. Classification Value Semantics

The `classificationResult` is unpacked as a standard 32-bit `float` directly from the hardware payload in `radar_protocol.py`. The project treats this float as a direct probability (or normalized score) of the WET class. 
- `0.0` translates to definitively DRY.
- `> 0.5` translates to WET.
- `1.0` translates to definitively WET.
*SEMANTIC MEANING NOT PROVEN*: There is no evidence in the parsing code that this float is a perfectly calibrated statistical probability rather than an arbitrary ML output score mapped between 0 and 1.

# 4. TLV Analysis

The active parser (`radar_protocol.py`) uses the following properties for the Surface Classification TLV:
- **TLV ID**: `1031` (Defined as `TLV_SURFACE_CLASSIFICATION`)
- **Payload Length**: 8 bytes
- **Struct Format**: `<If` (uint32 followed by float)
- **Fields**: 
  1. `surface_type` (uint32)
  2. `result` (float)
- **Endianness**: Little Endian (`<`)

*(Note: There is a separate dead-code parser `custom_parser.py` which expects TLV `10312` and a 4-byte payload. The active `web_server.py` ignores this file.)*

# 5. Frame Parsing Analysis

- **Header Length**: 40 bytes (`<Q8I` which is 8 bytes magic + 8 * 4-byte integers).
- **TotalPacketLen**: Extracted from offset 12.
- **Padding**: The active `FrameExtractor` (in `radar_protocol.py`) requests exactly `total_length` bytes. If 32-byte alignment padding is appended to the packet *after* `total_length`, the extractor will correctly skip the padding bytes during its next search for the `MAGIC_WORD`.
- **Resynchronization**: The parser has highly robust resynchronization. If `totalPacketLen` is invalid or a packet is truncated, it drops `del self.buffer[0]` (a single byte) and searches for the magic word again. 
*(Note: `serial_worker.py` contains dangerous manual padding `bytes_to_read += 4`, but this file is completely unused by the current WebSocket architecture).*

# 6. Stale Data Analysis

Old classifications **do** persist. 
In `web_server.py` (`RadarReader.run`), if a frame parses successfully but lacks the Surface TLV (`if surface is None:`), the backend skips broadcasting (`continue`). 
In `Home.tsx`, state is only updated upon receiving a WebSocket message. Consequently, if the radar temporarily stops emitting the classification TLV but continues sending frames, the frontend will freeze on the last known classification (e.g., falsely displaying WET forever until a new valid TLV arrives).

# 7. Threshold / Smoothing Analysis

- **Threshold**: The 0.5 threshold is rigidly hard-coded in TWO redundant places:
  1. `radar_protocol.py` (Line 97): `"Wet" if result > 0.5 else "Dry"`
  2. `Home.tsx` (Line 53): `const isPositive = p > 0.5;`
- **Smoothing**: There is **ABSOLUTELY NO** rolling average, weighted average, debounce, or hysteresis logic in the active codebase. 
- **Behavior**: Every frame is evaluated instantaneously. A single noisy frame spiking above 0.5 will immediately flip the UI to WET, leading to flickering and false positives.

# 8. Surface Type Analysis

The backend preserves and checks the `surfaceType` field. 
In `radar_protocol.py`, if the type is `SURFACE_TYPE_WET_DRY` (1), it processes WET/DRY logic. If it is `SURFACE_TYPE_GRASS_NOT_GRASS` (2), it passes the payload along.
However, in `web_server.py` (`_shape()`), if `surfaceTypeId` is not 1, the backend hard-codes `"WET": 0.0`. Thus, if the firmware accidentally outputs GRASS/NOT_GRASS, the UI will safely (but incorrectly) display 100% DRY instead of crashing.

# 9. Real vs Demo Analysis

The UI is definitely receiving **REAL** radar data when Demo Mode is off.
In `Home.tsx`, `demoMode` toggles execution paths cleanly:
- When Demo Mode is **ON**, the WebSocket is explicitly closed, and a local `setInterval` generates an artificial oscillating sine wave probability.
- When Demo Mode is **OFF**, the WebSocket connects, the UI state receives packets directly from `ws://localhost:8765`, and no demo logic leaks over.

# 10. Physical Environment Risks

The frontend explicitly displays the radar configuration as:
- `RANGE MAX: 6.00 m`
- `CHIRPS: 64`
If the physical hardware is sitting on a desk indoors and genuinely configured to look out 6 meters, it is guaranteed to capture heavy multi-path clutter (walls, desk surface, metal stands, moving people). The ML classifier may misinterpret static room reflections as the reflective signature of water.

# 11. Model / Generalization Risks

There is evidence that the system assumes raw floats are perfect percentages (multiplying by 100 for `CONFIDENCE: XX%`). If the ML model's logit outputs were not properly calibrated during training, a score of "0.51" might just be a low-confidence guess by the model, but the UI aggressively treats it as a definitive "WET" state.

# 12. Evidence Table

| Finding | Evidence | Status |
|---|---|---|
| Complete lack of temporal smoothing | `Home.tsx:buildClassification` and `radar_protocol.py:parse_packet` | CONFIRMED |
| Stale data persists indefinitely | `web_server.py:96-97` and `Home.tsx:handleMessage` | CONFIRMED |
| Threshold 0.5 applied redundantly | `radar_protocol.py:97` and `Home.tsx:53` | CONFIRMED |
| Environmental Clutter (6m range) | `Home.tsx:507` (Displayed config) | STRONGLY SUSPECTED |
| Competing dead-code parsers exist | `custom_parser.py` (TLV 10312) vs `radar_protocol.py` (TLV 1031) | CONFIRMED |

# 13. Most Likely Causes

1. **Missing Smoothing Logic**: (Confirmed) The instantaneous 0.5 threshold without any rolling average means a single anomalous radar frame triggers a false WET UI.
2. **Stale State Freezing**: (Confirmed) If mmWave UART drops the surface TLV intermittently, the frontend keeps displaying the last WET state, making the bug appear permanent until the radar is restarted.
3. **Clutter / Reflections**: (Strongly Suspected) A 6.0m max range indoors captures unintended objects that confuse the classifier.

# 14. Recommended Fixes

**Fix 1: Add a Rolling Average**
- **Problem**: Instantaneous thresholding causes flickering false positives.
- **Proposed change**: Implement a 5-frame moving average queue for `classificationResult` before the 0.5 threshold is evaluated.
- **Exact file**: `radar_backend/web_server.py`
- **Exact function**: `RadarServer._shape()` (maintain state in `RadarServer`)
- **Risk**: Low. Immediately stabilizes the UI.

**Fix 2: Prevent Stale State Freezing**
- **Problem**: Missing TLVs cause the UI to freeze on the last WET state.
- **Proposed change**: If `surface is None`, broadcast an empty/reset packet to the frontend so confidence drops to 0% instead of freezing.
- **Exact file**: `radar_backend/web_server.py`
- **Exact function**: `RadarReader.run()`
- **Risk**: Low. 

**Fix 3: Clean up dead parsers**
- **Problem**: `serial_worker.py` and `custom_parser.py` contain incorrect magic word offsets and padding assumptions, causing confusion during debugging.
- **Proposed change**: Delete these files to enforce `radar_protocol.py` as the single source of truth.
- **Exact file**: `radar_backend/serial_worker.py`, `radar_backend/custom_parser.py`
- **Exact function**: N/A
- **Risk**: Low.

# 15. What We Should Test Next

1. **Parser/Stale Test**: Turn the radar on, get a WET reading. Then manually block the radar antennas completely with a metal plate (or disconnect RX). Does the UI remain stuck on WET indefinitely? This isolates the Stale State bug.
2. **Smoothing Test**: Click "EXPORT CSV" in the UI while pointing at a visibly dry surface. Analyze the CSV column for `probabilities.WET`. If it mostly hovers at 0.3 but occasionally spikes to 0.6 for one frame, it confirms the lack of smoothing is the primary culprit.
3. **Environment Test**: Point the radar straight up at the ceiling or into an empty cardboard box at close range. If the false WET disappears, the 6.0m room reflections were confusing the model.
