# Project Summary

## 1. Project Objective

The objective of this project is to interface with a TI IWRL6432BOOST mmWave radar running a Surface Classification application. The system captures the radar's serial output, parses the underlying data frames and classification structures, and translates those outputs into a responsive, real-time visualization dashboard indicating surface states like Wet/Dry and Grass/Not-Grass.

## 2. Starting Point

The project began using the TI Radar Toolbox Surface Classification application/demo. The intended target hardware was the IWRL6432BOOST. The initial goal was to use the TI-provided visualizer to obtain and display Wet/Dry classification output directly from the radar.

## 3. Initial TI Radar Toolbox Setup

The development started with the supplied setup from the TI Radar Toolbox (version 4.00.00.05). The known flashed binary used was `surface_classification_demo_SDK5502-WET-DRY.Debug.appimage`. 

## 4. Environment and Visualizer Issues

In the tested Linux/Conda environment, initial attempts to run the provided Industrial Visualizer produced dependency and execution issues:
1. **Python / NumPy compatibility**: The environment exhibited problems that led to the creation of a dedicated `radar_env` with Python 3.12 and NumPy < 2.
2. **PySide2 / PyQt5 compatibility**: A compatibility bridge was introduced to map required PySide2 modules and signals to PyQt5 so the visualizer could launch.
3. **OpenGL dependencies**: The visualizer produced a `ModuleNotFoundError: No module named 'OpenGL'`, prompting the installation of PyOpenGL in the dedicated environment.
4. **Environment drift**: Terminal sessions intermittently returned to `(base)`, causing dependencies to appear missing until `radar_env` was explicitly reactivated.

These were environment/dependency issues observed during the tested setup, not universal requirements for the visualizer.

## 5. Serial and Radar Connection Investigation

During integration, serial devices such as `/dev/ttyACM0` and `/dev/ttyACM1` were observed. Different baud rates were investigated. A magic word sequence was detected at 115200 baud during testing, while the Industrial Visualizer showed a configuration path involving `/dev/ttyACM0` and higher baud rates (like 921600). The current implementation in `web_server.py` defaults to listening at 115200 baud, although configurable.

## 6. Parser and Visualizer Investigation

The supplied visualizer initially produced parser errors such as `ImportError: cannot import name 'readAndParseUartDoubleCOMPort' from parser_lib` and `ModuleNotFoundError: No module named 'parseTLVs'`. 
Following this, the investigation moved away from launching the existing GUI toward understanding what the firmware actually transmits, what the Python parser expects, and how the specific classification TLV (Type-Length-Value) is decoded.

## 7. Firmware Source Investigation

The supplied firmware source became critical for understanding the actual protocol. The source contains definitions for `MMWDEMO_OUTPUT_MSG_SURFACE_CLASSIFICATION_PROBABILITY` as `1031`, and surface type constants `SURFACE_TYPE_WET_DRY` (`1`) and `SURFACE_TYPE_GRASS_NOTGRASS` (`2`).
The firmware defines a structure equivalent to:
```c
typedef struct {
    uint32_t surfaceType;
    float classificationResult;
} MmwDemo_output_message_surface;
```
This payload is expected to be 8 bytes total (4 bytes `surfaceType` + 4 bytes `classificationResult`).

## 8. TLV Protocol Investigation

The original Python parser associated TLV `1031` with a Point Cloud Classification structure of 28 bytes (equivalent to `2I5f`). However, the firmware source defines the payload as 8 bytes (equivalent to `<If`). 
The evidence established a discrepancy between the parser expectation and the supplied firmware source definition in the tested environment. The project was adapted to parse the structure defined by the firmware source, as seen in the current `radar_protocol.py`, which correctly decodes the 8-byte `<If` payload.

## 9. Frame Length and Packet Investigation

The firmware packet format alignment was investigated. The packet header contains a `totalPacketLen` field, and the firmware aligns packet sizes to a 32-byte boundary. A modification observed in legacy parser traces subtracted 16 bytes for the header, and then unexpectedly added 4 bytes to the frame length during parsing. 
This +4 byte adjustment is currently preserved in `serial_worker.py` as a mitigation for an observed padding quirk. However, consuming extra bytes outside the declared `totalPacketLen` is considered a potential frame desynchronization risk and remains under investigation.

## 10. GUI Classification Adaptation

The surface classification GUI was adapted to parse multiple possible output keys (e.g., `surfaceClassificationOutput`, `classificationResult`). The current parser extracts `surfaceType` and `classificationResult`.
The raw `classificationResult` is utilized by the GUI to determine the display state, but this numerical result is strictly an uncalibrated float from the firmware. While the UI visually represents it as a "confidence" percentage, it is not proven to be a calibrated statistical probability. Previous iterations of the GUI used a 5-step weighted moving average (weights: [5, 4, 3, 2, 1]) for smoothing; this logic was tested during development but is no longer prominent in the simplified WebSocket integration.

## 11. Custom Backend Development

Due to difficulties integrating the original visualizer directly, a custom backend was developed. This backend's responsibilities include radar serial communication, frame reception and parsing, TLV decoding, normalizing classification state, and bridging to the frontend via WebSockets. The current `web_server.py` and `radar_protocol.py` represent this architecture.

## 12. No-Configuration Integration

The flashed Surface Classification application does not follow the standard configuration workflow assumed by generic radar demos. The Industrial Visualizer provided a "Start without Send Configuration" path. Consequently, the current backend operates in a passive mode, opening the serial port and listening for frames without transmitting a `.cfg` file or `sensorStart` command, adapting to the firmware's hardcoded startup behavior.

## 13. Custom Manus UI

A custom frontend was generated to create a cleaner, application-specific visualization. The React UI (accessible in `client/`) encapsulates connection settings, a Bin-Flashed selector (Wet/Dry or Grass/Not-Grass), a Demo Mode toggle, active classification confidence, live radar features, and frame information.

## 14. Classification UI Evolution

Initially, the UI contained separate display cards for "DRY" and "WET", which could visually imply simultaneous detection. The UI was conceptually redesigned around a single active classification card that dynamically toggles between the dominant state (e.g., "WET" or "DRY") based on the threshold evaluation of the classification result.

## 15. Demo Mode

A Demo Mode was introduced to allow the UI to demonstrate classification states without requiring physical radar hardware. The implementation uses deterministic sinusoidal functions to simulate sweeping confidence values. This mode is entirely contained within the browser and is explicitly indicated in the UI as "SIMULATING" so demo values are not mistaken for real measurements.

## 16. Visualization Evolution

The UI visualization evolved from static assets toward procedural, responsive animations. The initial goal was a Three.js-based visualization mapped to specific states. While Three.js is planned/intended (and its dependencies are present in `package.json`), the current verified implementation relies on HTML5 Canvas 2D. `WaterConfidenceCanvas` displays interactive water ripples based on Wet confidence, and `GrassCanvasMini` renders interactive grass blades responding to cursor physics.

## 17. Current False-WET Investigation

In the tested environment, the system has produced false-positive observations where "WET" is displayed when the physical surface appears dry. This is an ongoing investigation and is not a confirmed root cause. Potential factors under investigation include classifier semantics, threshold alignment, data smoothing, frame synchronization, radar geometry, reflections, and the generalization of the training dataset.

## 18. Confirmed Technical Findings

- Target platform is IWRL6432.
- The Surface Classification WET-DRY application was used (TI Radar Toolbox 4.00.00.05).
- Serial devices `/dev/ttyACM*` and `COM*` are valid paths for radar data.
- The firmware classification TLV ID is confirmed as `1031`.
- The surface type constants are `1` (Wet/Dry) and `2` (Grass/Not-Grass).
- The correct classification payload structure is an 8-byte `<If` (uint32, float).
- The backend successfully bridges UART to WebSockets via `web_server.py`.
- The React UI architecture correctly parses and renders the normalized JSON state.

## 19. Environment-Specific Mitigations and Adaptations

- **Python environment**: A dedicated environment (`radar_env`) was used to handle specific NumPy and OpenGL dependencies.
- **GUI compatibility**: A PySide2/PyQt5 compatibility bridge was employed to launch the initial PyQt applications in the tested environment.
- **Parser adaptation**: The project was adapted to parse the 8-byte TLV structure defined by the firmware source rather than the 28-byte structure expected by the original parser.
- **Custom backend**: Developed to directly control the radar data path and WebSocket bridging.
- **Custom UI**: Developed for application-specific visualization, enabling isolated frontend testing via Demo Mode.

## 20. Observed Issues in the Tested Environment

- **Industrial Visualizer environment**: Produced Python dependency conflicts; mitigated by creating a dedicated environment.
- **PySide2/PyQt5**: Caused import failures; mitigated by a dynamic compatibility bridge in the initial PyQt implementations.
- **Parser imports**: The original parser threw `ImportError`; mitigated by writing `radar_protocol.py` to parse frames explicitly.
- **Classification TLV parsing**: The original parser expected 28 bytes, but firmware sent 8 bytes; mitigated by adopting the `<If` parsing structure.
- **No-config integration**: The firmware didn't respond to standard `.cfg` commands; mitigated by adopting a passive read-only serial listener.

## 21. What Remains Unproven

- The exact semantic meaning of `classificationResult` from the firmware (whether it is a statistically calibrated probability).
- The exact model architecture, training dataset, and inherent classifier threshold.
- The definitive root cause of the observed false-WET results.
- The model's generalization capabilities across varied physical surface materials and geometries.

## 22. Current Architecture

```text
  IWRL6432BOOST (Hardware)
        ↓
      UART (Serial)
        ↓
    web_server.py / serial_worker.py (Backend)
        ↓
    radar_protocol.py (Frame & TLV Parser)
        ↓
    _shape() / ClassifierBridge (Classification Normalization)
        ↓
    WebSockets (ws://localhost:8765)
        ↓
    Home.tsx (React Frontend)
        ↓
    WaterConfidenceCanvas.tsx / GrassCanvasMini.tsx (Visualization)
```

## 23. Development Timeline

- **Phase 1**: Initial TI Radar Toolbox / Surface Classification setup.
- **Phase 2**: Linux/Python environment investigation (`radar_env` creation).
- **Phase 3**: Industrial Visualizer launch and PySide2/PyQt5 mitigation.
- **Phase 4**: Serial/radar connection and baud rate investigation.
- **Phase 5**: Parser/module investigation.
- **Phase 6**: Firmware source/protocol investigation.
- **Phase 7**: TLV structure investigation (8-byte vs 28-byte discrepancy).
- **Phase 8**: Frame length / packet padding investigation (+4 bytes quirk).
- **Phase 9**: Custom backend development (`web_server.py`).
- **Phase 10**: No-config integration investigation (passive listening).
- **Phase 11**: Custom Manus UI generation (`client/src`).
- **Phase 12**: Classification UI redesign (single dynamic card).
- **Phase 13**: Demo mode implementation for deterministic testing.
- **Phase 14**: Visualization / Canvas 2D API implementation.
- **Phase 15**: Current false-WET investigation.

## 24. Current Project Status

The project is currently operational as a custom hardware-to-UI bridge. The backend successfully parses raw TI mmWave frames, extracts the appropriate 8-byte Surface Classification TLV, normalizes the data, and broadcasts it over WebSockets. The React frontend actively receives this stream and renders real-time visual interpretations of the radar's uncalibrated surface probability values.

## 25. Next Technical Validation Steps

- Systematically test the radar against controlled physical surfaces (distinctly dry vs distinctly wet).
- Log raw `classificationResult` outputs to evaluate the threshold boundaries of the false-WET behavior.
- Investigate the frame alignment +4 byte padding quirk to ensure long-term stream synchronization stability.
- Validate if the hardware angle, mounting height, and reflections impact the internal firmware model's generalization.

## One-Sentence Project Summary

This project is a custom, end-to-end data pipeline and web visualization dashboard adapted to read, parse, and display real-time surface classification probabilities from a pre-flashed TI IWRL6432BOOST mmWave radar.
