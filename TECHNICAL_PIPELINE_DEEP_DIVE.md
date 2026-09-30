# Technical Pipeline Deep Dive: IWRL6432 Surface Classification

## 1. Executive Summary

This document provides a complete forensic reconstruction of the IWRL6432 Surface Classification (WET/DRY) pipeline. Based exclusively on the provided project source code, firmware, Jupyter Notebooks, and Python parser/UI code, it traces the data flow end-to-end: from radar chirps to the final UI display. 

The pipeline employs a combination of 1D Range processing, a 5-frame temporal window, and a PyTorch-trained Multi-Layer Perceptron (MLP) deployed on the Cortex-M4F using TVM.

> [!WARNING]
> **Key Finding:** The pipeline uses a double-smoothing mechanism (5 frames in firmware + 5 frames in the UI) and takes zero-Doppler static reflections as direct features. This makes it highly sensitive to mounting height and static environment changes, which is a prime suspect for "False-WET" anomalies.

---

## 2. Hardware

**Device:** Cortex-M4F on TI IWRL6432 ([VERIFIED] `example.syscfg`, `surface_classification_demo_xwrL64xx-WET-DRY.projectspec`).

**Radar Configuration:** ([STRONGLY SUPPORTED] `motion_detect.c` CLI commands)
- **TX Antennas:** 3 enabled (channelCfg TX bitmask 7).
- **RX Antennas:** 2 enabled (channelCfg RX bitmask 3).
- **ADC Samples per Chirp:** 128 (`chirpComnCfg`).

---

## 3. Firmware

The firmware resides in `surface_classification_xwrL64xx-WET-DRY`. It leverages the standard mmWave motion/presence detection Data Path Controller (DPC) but hooks into it to extract features for a custom machine learning model.

---

## 4. ADC and Raw Data

**Raw Data:** Raw ADC samples are **not** present or exposed in the application layer. The ADC data is immediately consumed by the Hardware Accelerator (HWA) for 1D Range processing.

**Format:** 128 samples per chirp, processed into a range profile.

---

## 5. ADC Data Organization

The firmware does not operate on raw ADC samples. It operates on the `detMatrix` (Detection Matrix) produced by the DPC.
[VERIFIED] `surface.c: CreateFeatureVector()` reads from `gMmwMssMCB.detMatrix[0].data`.

---

## 6. Signal Processing

1. **Range FFT:** Performed by the HWA.
2. **Doppler Processing:** Performed by the HWA. 
3. **Feature Selection:** The firmware specifically extracts the zero-Doppler bin (static reflections) for selected range bins.
   [VERIFIED] `surface.c` uses `(i + RANGEBIN_START) * gMmwMssMCB.numDopplerBins`. By adding the offset and multiplying by the total number of Doppler bins (which represents the width of the 2D matrix), it extracts the 0th Doppler index for the given range bin.

---

## 7. Range Processing & 8. Range Bins

**Exact Bins Used:** Bins 3 through 13.
[VERIFIED] `surface.h` defines:
```c
#define NUM_RANGEBINS_TO_ENQUEUE 11
#define RANGEBIN_START 3
#define RANGEBIN_END (RANGEBIN_START + NUM_RANGEBINS_TO_ENQUEUE - 1)
```
11 consecutive range bins are used as spatial features.

---

## 9. Feature Extraction

For each frame, the firmware extracts the 11 range bins.
[VERIFIED] `surface.c`: 
```c
inputVectorFloatTemp[...] = (uint32_t) detMatrixData[(i + RANGEBIN_START) * gMmwMssMCB.numDopplerBins];
```
> [!IMPORTANT]
> The features are the **raw magnitude** of the static reflection at bins 3-13. There is no mathematical normalization or scaling (e.g., dividing by max power) applied in the C code prior to inference; it is merely cast to `float`.

---

## 10. Temporal Feature Construction

The system uses a 5-frame temporal window.
[VERIFIED] `surface.h` defines `#define NUM_FRAMES_OF_DATA 5`.

The 11 range bins for the current frame are appended to a circular buffer containing the previous 4 frames.
[VERIFIED] `surface.c: CreateFeatureVector()` interleaves these frames into a flat 55-element `float` array.

---

## 11. ML Model

**Architecture:** A PyTorch 3-layer Multi-Layer Perceptron (Linear Model) with Batch Normalization.
[VERIFIED] `pytorch_fp_model-DRY-WET.ipynb` defines:
- Input: 55 features (`NUM_BINS*WINDOW_SIZE`)
- Layer 1: BatchNorm1d(55) -> Linear(55, 64) -> ReLU
- Layer 2: BatchNorm1d(64) -> Linear(64, 32) -> ReLU
- Layer 3: BatchNorm1d(32) -> Linear(32, 1) -> Sigmoid Output

**Export:** Exported to ONNX and compiled to a C static library (`mod.a`) using Apache TVM.

---

## 12. Model Training / Training Evidence

[VERIFIED] Training is fully documented in `pytorch_fp_model-DRY-WET.ipynb`.
- **Dataset:** Loaded from CSV files (not included in the repository).
- **Labels:** DRY = 0, WET = 1.
- **Loss Function:** `MSELoss` (Mean Squared Error).
- **Optimizer:** `SGD` (Stochastic Gradient Descent) with a learning rate of 0.001.

---

## 13. Model Input Preprocessing

> [!CAUTION]
> **No explicit scaling is done in C.** Because the PyTorch model's first layer is `BatchNorm1d(55)`, the normalization is mathematically baked into the model weights (it subtracts the training dataset's mean and divides by its variance). If the radar's deployment environment has a different baseline reflection power than the training dataset, the `BatchNorm` layer will fail to center the data, leading to misclassification.

---

## 14. On-Chip ML Inference

Inference executes on the IWRL6432's Cortex-M4F processor.
[VERIFIED] `surface.c` calls `tvmgen_default_run(&inputs, &outputs)`, which executes the TVM-compiled `mod.a` library.

---

## 15. Model Output

The model produces a single `float` value bounded between 0 and 1 (due to the final Sigmoid layer).
[VERIFIED] `surface.c` returns this float directly from the `Inference()` function.

---

## 16. Wet/Dry Class Semantics

- **DRY:** Output approaches 0.
- **WET:** Output approaches 1.
- **Threshold:** `CLASS_THRESHOLD` is defined as `0.5` in `surface.h`.

---

## 17. Firmware Classification Output

The inference float is packaged into a C struct.
[VERIFIED] `surface.h`:
```c
typedef struct MmwDemo_output_message_surface_t {
    uint32_t surfaceType;         // Set to SURFACE_TYPE_WET_DRY (1)
    float classificationResult;   // The inference output
} MmwDemo_output_message_surface;
```
Total payload size: 8 bytes.

---

## 18. TLV Structure

[VERIFIED] `motion_detect.c`:
The struct is wrapped in a Type-Length-Value (TLV) container.
- **Type:** `MMWDEMO_OUTPUT_MSG_SURFACE_CLASSIFICATION_PROBABILITY` (`1031`).
- **Length:** `8` bytes.

---

## 19. Packet Structure

[VERIFIED] `motion_detect.c`:
A standard `MmwDemo_output_message_header` (32 bytes) containing a magic word, version, and packet length is transmitted first, followed by the TLVs (including the surface classification TLV 1031).

---

## 20. UART Transport

[VERIFIED] `motion_detect.c` calls `mmw_UartWrite` to send the assembled packet buffer out over the UART port.

---

## 21. Host Parser

[VERIFIED] `parseTLVs.py` and `gui_parser.py`:
The Python parser scans for the Magic Word to align frames. It reads the TLV header and, upon encountering TLV type `1031` (mapped to `MMWDEMO_OUTPUT_MSG_POINT_CLOUD_CLASSIFICATION` in `tlv_defines.py`), unpacks the 8-byte payload:
```python
surfaceType, classification = struct.unpack(classStruct, tlvData[:expectedSize])
outputDict["classificationResult"] = classification
```

---

## 22. Backend Data Flow

The parsed `outputDict` containing the raw `classificationResult` float is passed to the frontend GUI components.

---

## 23. Frontend Data Flow

[VERIFIED] `Demo_Classes/surface_classification.py`:
The UI maintains a `deque` (sliding window) of the last 100 classifications.
It applies a **weighted rolling average** across the most recent 5 frames:
```python
currentClassification = np.average(list(self.surfaceLatestResults)[0:5], weights=[5, 4, 3, 2, 1])
```
If `currentClassification > 0.5`, the UI declares "Wet", otherwise "Dry".

---

## 24. Complete End-to-End Data Flow

    ┌─────────────────────────────┐
    │ RF SCENE / SURFACE          │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ IWRL6432 RF RECEIVER        │
    │ 3 TX / 2 RX Configuration   │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ ADC                         │
    │ 128 samples per chirp       │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ SIGNAL PROCESSING (HWA)     │
    │ 1D Range FFT / detMatrix    │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ FEATURE EXTRACTION (M4F)    │
    │ Bins 3-13, 0-Doppler, Mag   │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ TEMPORAL FEATURE WINDOW     │
    │ 5 Frames Interleaved (55)   │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ ON-CHIP ML INFERENCE        │
    │ TVM Runtime (mod.a)         │
    │ 3-Layer MLP + BatchNorm1d   │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ CLASSIFICATION RESULT       │
    │ float probability (0 to 1)  │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ TLV                         │
    │ Type: 1031, Length: 8 bytes │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ PACKET + UART               │
    │ Header + TLV payload        │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ HOST PARSER                 │
    │ parseTLVs.py                │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ BACKEND                     │
    │ outputDict                  │
    └──────────────┬──────────────┘
                   ↓
    ┌─────────────────────────────┐
    │ FRONTEND                    │
    │ 5-Frame Weighted Average    │
    │ >0.5 ? WET : DRY            │
    └─────────────────────────────┘

---

## 25. False-WET Investigation

Based on the forensic reconstruction, several mechanisms can cause False-WET conditions:

- **[CONFIRMED] Double Smoothing Lag:** The firmware uses 5 frames of history to generate a single classification. The frontend UI takes this output and averages it *again* over another 5 frames. This causes a significant temporal lag. A sudden transition to DRY may take several frames to propagate through both windows, leaving the UI stuck on WET.
- **[CONFIRMED] Lack of Scale Invariance:** The C code directly casts raw radar magnitude `uint32_t` values to `float` for the neural network. The PyTorch model uses `BatchNorm1d` on the input. `BatchNorm` expects the incoming data distribution (mean and variance) to match the exact dataset it was trained on. If the radar is placed over a slightly more reflective surface, or if a gain setting changed, the raw magnitude shifts and defeats the batch normalization, causing erratic inferences.
- **[POSSIBLE] Mounting Height Sensitivity:** The model explicitly looks at range bins 3 through 13 at the zero-Doppler (static) bin. If the sensor is mounted higher or lower than the training setup (documented in the UI as "18cm off the ground with 27 degree tilt"), the ground reflection will shift to different bins. The MLP expects specific features at specific indices; shifting them will immediately break classification.

---

## 26. Cross-Verification Table

| Technical Fact | Value | Source File | Function/Line | Verification |
|---|---|---|---|---|
| Device | IWRL6432 | `example.syscfg` | L7 | [VERIFIED] |
| Temporal Frames (FW) | 5 | `surface.h` | L19 | [VERIFIED] |
| Range Bins | 11 (Bins 3 to 13) | `surface.h` | L20-22 | [VERIFIED] |
| ML Input Features | 55 Floats | `surface.c` | L21 | [VERIFIED] |
| Firmware Threshold | 0.5 | `surface.h` | L16 | [VERIFIED] |
| TLV ID | 1031 | `surface.h` | L28 | [VERIFIED] |
| TLV Payload Size | 8 bytes | `surface.h` | L35-42 | [VERIFIED] |
| Model Architecture | 3x Linear + BN | `pytorch_fp_model-DRY-WET.ipynb` | L386 | [VERIFIED] |
| Frontend Smoothing | 5-Frame Weighted | `surface_classification.py` | L132 | [VERIFIED] |

---

## 27. Confirmed Facts
- The model runs directly on the M4F core via TVM.
- The WET/DRY model was trained in PyTorch and exported via ONNX.
- The UI applies a secondary 5-frame weighted average (`weights=[5, 4, 3, 2, 1]`) to the model's output.
- The firmware sends the classification result unconditionally if an inference occurs.

## 28. Inferences
- [INFERRED] The zero-doppler bins represent entirely static reflections. The system classifies surfaces entirely by the static return signature across distance, ignoring all moving components (clutter removal is irrelevant to the used data slice).

## 29. Unknown / Missing Evidence
- [UNKNOWN] The raw training dataset CSVs are not in the repository. The exact magnitude scales and distributions of the training data cannot be verified.
- [UNKNOWN] The physical distance conversion for Range Bins 3-13. While configuration indicates they capture short-range data, the exact physical distance (in mm) relies on the active chirp profile bandwidth, which could vary if dynamically reconfigured.

## 30. Technical Conclusions
The Surface Classification pipeline is fully vertically integrated from the HWA output to the Python UI. However, the architecture is rigid. The neural network acts as an inflexible spatial pattern matcher tied to specific bins (3-13) and raw magnitudes. This explains any observed brittleness or "False-WET" triggers outside of controlled lab environments. Resolving reliability issues would require moving toward scale-invariant preprocessing (e.g., normalizing the 11 bins to a max power of 1.0 prior to inference) and removing the redundant UI-side temporal smoothing.
