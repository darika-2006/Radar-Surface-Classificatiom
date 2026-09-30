import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  Cable,
  ChevronDown,
  Download,
  Radio,
  Trash2,
  WifiOff,
  Zap,
} from "lucide-react";

import { ClassificationCard } from "@/components/classification/ClassificationCard";
import type { ClassificationLabel } from "@/components/classification/types";
import GrassCanvasMini from "@/components/GrassCanvasMini";

// ── Types ──────────────────────────────────────────────────────────────────────
type BinMode = "wet-dry" | "grass";
type RadarData = {
  bin1Label: string;
  bin1Confidence: number;
  bin2Label: string;
  bin2Confidence: number;
  probabilities: Record<string, number>;
  frameId: number | string;
  timestamp: string;
  packetSize: number | string;
  features?: Record<string, number>;
};

const initialData: RadarData = {
  bin1Label: "-- --",
  bin1Confidence: 0,
  bin2Label: "-- --",
  bin2Confidence: 0,
  probabilities: { GRASS: 0, "NOT GRASS": 0, WET: 0, DRY: 0 },
  frameId: "--",
  timestamp: "--:--:--",
  packetSize: "--",
};

const WS_URL = "ws://localhost:8765";

// ── Helpers ────────────────────────────────────────────────────────────────────
function nowTime() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

class TemporalSmoother {
  history: number[] = [0.0, 0.0, 0.0, 0.0, 0.0];
  
  update(rawProbability: number, mode: BinMode) {
    this.history.unshift(rawProbability);
    this.history.length = 5;
    const smoothed = (
      this.history[0] * 5.0 +
      this.history[1] * 4.0 +
      this.history[2] * 3.0 +
      this.history[3] * 2.0 +
      this.history[4] * 1.0
    ) / 15.0;

    const classification = smoothed > 0.5 ? (mode === "wet-dry" ? "WET" : "GRASS") : (mode === "wet-dry" ? "DRY" : "NOT GRASS");
    const confidence = smoothed > 0.5 ? rawProbability : 1.0 - rawProbability;

    return { rawClassification: rawProbability, smoothedClassification: smoothed, classification, confidence };
  }
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div className="section-heading">
      <span>{children}</span>
      <i />
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="meter" aria-label={`${Math.round(value * 100)} percent confidence`}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

function GrassScene({ active }: { active: boolean }) {
  if (!active) {
    return (
      <div className="texture-zone floor-texture" aria-label="Surface texture preview">
        <span className="texture-label">HARD SURFACE / STATIC</span>
      </div>
    );
  }
  return (
    <div
      className="texture-zone grass-zone"
      aria-label="Animated grass preview"
      style={{ padding: 0 }}
    >
      {/* Interactive spring-physics canvas — cursor-reactive iris-leaf blades */}
      <GrassCanvasMini />
      {/* Label floats above the canvas */}
      <span
        className="texture-label"
        style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}
      >
        LIVE / VEGETATION RESPONSE
      </span>
    </div>
  );
}

function WaterScene({ active }: { active: boolean }) {
  if (!active) {
    return (
      <div className="texture-zone crack-texture" aria-label="Dry surface preview">
        <span className="crack crack-a" />
        <span className="crack crack-b" />
        <span className="crack crack-c" />
        <span className="texture-label">DRY SURFACE / FRACTURE MAP</span>
      </div>
    );
  }
  return (
    <div className="texture-zone water-zone" aria-label="Animated water preview">
      <div className="ripple ripple-one" />
      <div className="ripple ripple-two" />
      <div className="ripple ripple-three" />
      <div className="water-crosshair vertical" />
      <div className="water-crosshair horizontal" />
      <span className="texture-label">LIVE / REFLECTIVE RESPONSE</span>
    </div>
  );
}

function ResultBlock({
  eyebrow,
  label,
  confidence,
  scene,
}: {
  eyebrow: string;
  label: string;
  confidence: number;
  scene: React.ReactElement;
}) {
  return (
    <section className="result-block">
      <div className="result-eyebrow">{eyebrow}</div>
      <div className={`result-value ${label === "-- --" ? "is-empty" : ""}`}>{label}</div>
      <Meter value={confidence} />
      <div className="confidence-row">
        <span>CONFIDENCE</span>
        <strong>{(confidence * 100).toFixed(1)}%</strong>
      </div>
      {scene}
    </section>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────
export default function Home() {
  const [connected, setConnected] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [data, setData] = useState<RadarData>(initialData);
  const [fps, setFps] = useState(0);
  const [logs, setLogs] = useState(["[--:--:--]  AWAITING RADAR DATA"]);
  const [port, setPort] = useState("/dev/ttyACM0");
  const [baud, setBaud] = useState("115200");
  const [liveFeatures, setLiveFeatures] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [binMode, setBinMode] = useState<BinMode>(() =>
    localStorage.getItem("radar-bin-mode") === "grass" ? "grass" : "wet-dry"
  );
  const [demoMode, setDemoMode] = useState(() => localStorage.getItem("radar-demo-mode") === "true");
  const [demoManualProbability, setDemoManualProbability] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const demoModeRef = useRef(demoMode);
  const binModeRef = useRef(binMode);
  const historyRef = useRef<RadarData[]>([]);

  const pushLog = (line: string) =>
    setLogs((prev) => [...prev, `[${nowTime()}]  ${line}`].slice(-8));

  useEffect(() => { localStorage.setItem("radar-bin-mode", binMode); binModeRef.current = binMode; }, [binMode]);
  useEffect(() => { localStorage.setItem("radar-demo-mode", String(demoMode)); demoModeRef.current = demoMode; }, [demoMode]);

  // Demo data stays entirely inside the browser: it never opens a UART port or
  // sends a WebSocket connect command.
  useEffect(() => {
    if (!demoMode) return;
    let frame = typeof data.frameId === "number" ? data.frameId : 0;
    const smoother = new TemporalSmoother();
    const update = () => {
      frame += 1;
      // Controlled periodic waveform, unless overridden by manual slider
      const probability = demoManualProbability !== null
        ? demoManualProbability
        : 0.5 + 0.43 * Math.sin(frame / 18) + 0.04 * Math.sin(frame / 4);
      
      const p = Math.max(0, Math.min(1, probability));
      const s = smoother.update(p, binMode);
      
      let d: RadarData;
      if (binMode === "wet-dry") {
        d = {
          bin1Label: s.classification, bin1Confidence: s.confidence,
          bin2Label: s.classification === "WET" ? "DRY" : "WET", bin2Confidence: 1 - s.confidence,
          probabilities: { GRASS: 0, "NOT GRASS": 0, WET: s.rawClassification, DRY: 1 - s.rawClassification },
          frameId: frame, timestamp: nowTime(), packetSize: "SIM",
          features: { detected_points: Math.round(4 + 3 * Math.sin(frame / 7)) }
        };
      } else {
        d = {
          bin1Label: s.classification, bin1Confidence: s.confidence,
          bin2Label: s.classification === "GRASS" ? "NOT GRASS" : "GRASS", bin2Confidence: 1 - s.confidence,
          probabilities: { GRASS: s.rawClassification, "NOT GRASS": 1 - s.rawClassification, WET: 0, DRY: 0 },
          frameId: frame, timestamp: nowTime(), packetSize: "SIM",
          features: { detected_points: Math.round(4 + 3 * Math.sin(frame / 7)) }
        };
      }
      setData(d);
      setFps(10);
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [demoMode, binMode, demoManualProbability]);
  // ── Accumulate Data ────────────────────────────────────────────────────────
  useEffect(() => {
    if (data.frameId !== 0 && data.frameId !== "--") {
      historyRef.current.push(data);
    }
  }, [data]);

  // ── WebSocket Lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (demoMode) {
      setWsReady(false);
      setConnected(false);
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let shouldReconnect = true;

    function connect() {
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsReady(true);
        setErrorMsg(null);
        pushLog("BACKEND BRIDGE CONNECTED  /  ws://localhost:8765");
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          handleMessage(msg);
        } catch {/* ignore */}
      };

      ws.onclose = () => {
        if (!shouldReconnect) {
          return;
        }
        setWsReady(false);
        setConnected(false);
        // Auto-retry after 2 s
        retryTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setErrorMsg("Cannot reach ws://localhost:8765 — is radar_backend/web_server.py running?");
      };
    }

    connect();
    return () => {
      shouldReconnect = false;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [demoMode]);

  function handleMessage(msg: Record<string, unknown>) {
    const t = msg.type as string;

    if (t === "status") {
      const c = msg.connected as boolean;
      setConnected(c);
      pushLog(c ? "RADAR LINK ESTABLISHED  /  STREAMING" : "RADAR DISCONNECTED");
    } else if (t === "fps") {
      setFps(msg.value as number);
    } else if (t === "error") {
      setErrorMsg(msg.message as string);
      pushLog(`ERROR: ${msg.message}`);
    } else if (t === "classification" && !demoModeRef.current) {
      const d = msg.data as RadarData;
      setData(d);

      // Update live feature display
      if (d.features) {
        setLiveFeatures({
          "DOPPLER AVG":      d.features.doppler_avg?.toFixed(4) ?? "--",
          "RANGE AVG":        d.features.range_avg?.toFixed(4)   ?? "--",
          "AZIMUTH MEAN":     d.features.azimuth_mean?.toFixed(4) ?? "--",
          "ELEVATION MEAN":   d.features.elevation_mean?.toFixed(4) ?? "--",
          "DETECTED POINTS":  String(d.features.detected_points ?? "--"),
          "DOPPLER AZ CORR":  d.features.doppler_az_corr?.toFixed(4) ?? "--",
        });
      }

      pushLog(
        `BIN1: ${d.bin1Label} (${(d.bin1Confidence * 100).toFixed(1)}%)   ` +
        `BIN2: ${d.bin2Label} (${(d.bin2Confidence * 100).toFixed(1)}%)   ` +
        `#${d.frameId}`
      );
    }
  }

  // ── Control Handlers ─────────────────────────────────────────────────────────
  const handleConnect = () => {
    if (demoMode) {
      pushLog("DEMO MODE ACTIVE — UART CONNECTION NOT ATTEMPTED");
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pushLog("ERROR: Backend bridge not ready. Start web_server.py first.");
      return;
    }
    historyRef.current = [];
    wsRef.current.send(JSON.stringify({ command: "connect", port, baud: Number(baud) }));
    pushLog(`CONNECTING  /  ${port}  @  ${baud}`);
  };

  const handleDisconnect = () => {
    if (demoMode) return;
    wsRef.current?.send(JSON.stringify({ command: "disconnect" }));
    setFps(0);
  };

  const toggleDemoMode = () => {
    if (!demoMode) {
      wsRef.current?.send(JSON.stringify({ command: "disconnect" }));
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
      setWsReady(false);
      setErrorMsg(null);
      historyRef.current = [];
      pushLog(`DEMO MODE ENABLED  /  ${binMode === "wet-dry" ? "WET / DRY" : "GRASS / NOT GRASS"}`);
    } else {
      setFps(0);
      pushLog("DEMO MODE DISABLED  /  REAL RADAR READY");
    }
    setDemoMode(!demoMode);
  };

  const chartEntries = Object.entries(data.probabilities);
  const modeTitle = binMode === "wet-dry" ? "SURFACE CLASSIFICATION" : "GRASS CLASSIFICATION";
  const probabilityTitle = binMode === "wet-dry" ? "WET / DRY CLASSIFICATION PROBABILITIES" : "GRASS CLASSIFICATION PROBABILITY";
  const normalizedMode = binMode === "wet-dry" ? "wet-dry" : "grass-not-grass";
  const runtimeLabel = demoMode
    ? "DEMO / SIMULATING"
    : connected
      ? "REAL / CONNECTED"
      : wsReady
        ? "REAL / READY"
        : "REAL / OFFLINE";
  const activeClassification = (
    data.bin1Label === "WET" ||
    data.bin1Label === "DRY" ||
    data.bin1Label === "GRASS" ||
    data.bin1Label === "NOT GRASS"
      ? data.bin1Label
      : binMode === "wet-dry"
        ? "WET"
        : "GRASS"
  ) as ClassificationLabel;

  const exportCsv = () => {
    const dataToExport = historyRef.current.length > 0 ? historyRef.current : [data];
    const header = "timestamp,frame_id,bin1_label,bin1_confidence,bin2_label,bin2_confidence,packet_size";
    const rows = dataToExport.map(d => 
      `${d.timestamp},${d.frameId},${d.bin1Label},${d.bin1Confidence},${d.bin2Label},${d.bin2Confidence},${d.packetSize}`
    );
    const content = [header, ...rows].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "surface-radar-frame.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const featureRows = [
    "DOPPLER AVG", "RANGE AVG", "AZIMUTH MEAN",
    "ELEVATION MEAN", "DETECTED POINTS", "DOPPLER AZ CORR",
  ];

  return (
    <main className="radar-app">
      <header className="top-toolbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Radio size={16} strokeWidth={2.5} /></span>
          <span>SURFACE RADAR CLASSIFIER</span>
        </div>
        <div className="toolbar-status">
          <span className={`status-dot ${(connected || demoMode) ? "online" : ""}`} />
          <span>{demoMode ? "DEMO MODE — SIMULATING" : connected ? "BRIDGE READY — STREAMING" : wsReady ? "BRIDGE READY — NOT STREAMING" : "NO BACKEND BRIDGE"}</span>
        </div>
        <div className="toolbar-metrics">
          <span className="metric-label">FRAME RATE</span>
          <strong>FPS : {String(Math.round(fps)).padStart(2, "0")}</strong>
        </div>
      </header>

      {/* Backend error banner */}
      {errorMsg && (
        <div style={{
          background: "#3a1010", color: "#ff6b6b", padding: "6px 20px",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: ".06em"
        }}>
          ⚠ {errorMsg}
        </div>
      )}

      <div className="console-grid">
        {/* ── Left Sidebar ──────────────────────────────────────────────────── */}
        <aside className="sidebar-left">
          <SectionHeader>CONNECTION</SectionHeader>

          <label className="field-label" htmlFor="port">PORT</label>
          <div className="select-wrap">
            <select
              id="port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            >
              <option value="/dev/ttyACM0">/dev/ttyACM0  ← IWRL6432 default</option>
              <option value="/dev/ttyACM1">/dev/ttyACM1</option>
              <option value="COM3">COM3</option>
              <option value="COM4">COM4</option>
              <option value="COM5">COM5</option>
            </select>
            <ChevronDown size={14} />
          </div>

          <label className="field-label" htmlFor="baud">BAUD RATE</label>
          <input
            id="baud"
            className="data-input"
            value={baud}
            onChange={(e) => setBaud(e.target.value)}
          />

          <div className="button-stack">
            <button className="primary-button" onClick={handleConnect} disabled={!wsReady || demoMode}>
              <Cable size={14} /> CONNECT
            </button>
            <button className="secondary-button" onClick={handleDisconnect} disabled={demoMode}>
              <WifiOff size={14} /> DISCONNECT
            </button>
          </div>

          <div className="connection-state">
            <span className={`status-dot ${(connected || demoMode) ? "online" : ""}`} />
            <span className="field-label">STATUS</span>
            <strong>{demoMode ? "DEMO" : connected ? "ONLINE" : "OFFLINE"}</strong>
          </div>

          <div className="sidebar-divider" />
          <SectionHeader>BIN FLASHED</SectionHeader>
          <label className="field-label" htmlFor="bin-flashed">CLASSIFIER FIRMWARE</label>
          <div className="select-wrap">
            <select id="bin-flashed" value={binMode} onChange={(e) => setBinMode(e.target.value as BinMode)}>
              <option value="wet-dry">WET / DRY</option>
              <option value="grass">GRASS / NOT GRASS</option>
            </select>
            <ChevronDown size={14} />
          </div>
          <label className="field-label">DEMO MODE</label>
          <button className={`demo-button ${demoMode ? "running" : ""}`} onClick={toggleDemoMode}>
            <Zap size={14} /> {demoMode ? "ON  /  SIMULATING" : "OFF  /  REAL RADAR"}
          </button>
          
          {demoMode && binMode === "wet-dry" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <label className="field-label">MANUAL CONFIDENCE</label>
                <button 
                  className="secondary-button" 
                  style={{ padding: "2px 6px", fontSize: 9 }}
                  onClick={() => setDemoManualProbability(null)}
                >
                  AUTO
                </button>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={demoManualProbability !== null ? demoManualProbability : data.probabilities.WET ?? 0.5}
                onChange={(e) => setDemoManualProbability(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)" }}
              />
            </div>
          )}


          <div className="sidebar-divider" />
          <SectionHeader>RADAR CONFIG</SectionHeader>
          <div className="config-list">
            {[
              ["RANGE MAX",    "6.00 m"],
              ["RANGE RES",    "0.047 m"],
              ["VELOCITY MAX", "2.50 m/s"],
              ["CHIRPS",       "64"],
              ["FRAME RATE",   "20 Hz"],
            ].map(([label, value]) => (
              <div className="config-item" key={label}>
                <span>{label}</span>
                <strong>&gt; {(connected || demoMode) ? value : "--"}</strong>
              </div>
            ))}
          </div>
          <div className="sidebar-footnote">
            <span>UI BUILD</span><strong>1.0.0</strong>
            <span>BRIDGE</span>
            <strong style={{ color: wsReady ? "var(--highlight)" : "var(--text-muted)" }}>
              {demoMode ? "DEMO" : wsReady ? "READY" : "OFFLINE"}
            </strong>
          </div>
        </aside>

        {/* ── Centre Display ────────────────────────────────────────────────── */}
        <section className="center-display">
          <ClassificationCard
            mode={normalizedMode}
            classification={activeClassification}
            confidence={data.bin1Confidence}
            wetConfidence={data.probabilities.WET ?? 0}
            runtimeStatus={demoMode ? "demo" : "real"}
            connectionLabel={runtimeLabel}
          />

          <section className="probability-panel">
            <SectionHeader>{probabilityTitle}</SectionHeader>
            <div className="chart-meta">
              <span>{demoMode ? "DEMO / DETERMINISTIC SIMULATION" : "REAL-TIME FRAME DISTRIBUTION"}</span>
              <strong>Y AXIS / 0.0 — 1.0</strong>
            </div>
            <div className="bar-chart">
              <div className="chart-y-axis"><span>1.0</span><span>0.5</span><span>0.0</span></div>
              <div className="chart-stage">
                <div className="chart-grid-line top" />
                <div className="chart-grid-line middle" />
                <div className="chart-grid-line bottom" />
                {chartEntries.map(([key, value]) => {
                  const isHighest = value === Math.max(...chartEntries.map(([, probability]) => probability));
                  return (
                    <div className="bar-column" key={key}>
                      <div className="bar-value">{value.toFixed(3)}</div>
                      <div
                        className={`chart-bar ${isHighest && value > 0 ? "highest" : ""}`}
                        style={{ height: `${value * 100}%` }}
                      />
                      <span>{key}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </section>

        {/* ── Right Sidebar ─────────────────────────────────────────────────── */}
        <aside className="sidebar-right">
          <SectionHeader>LIVE FEATURES</SectionHeader>
          <div className="feature-list">
            {featureRows.map((label) => (
              <div className="feature-item" key={label}>
                <span>{label}</span>
                <strong>&gt; {(connected || demoMode) ? (liveFeatures[label] ?? (demoMode && label === "DETECTED POINTS" ? String(data.features?.detected_points ?? "--") : "--")) : "--"}</strong>
              </div>
            ))}
          </div>

          <div className="sidebar-divider" />
          <SectionHeader>FRAME INFO</SectionHeader>
          <div className="feature-list compact">
            <div className="feature-item"><span>FRAME ID</span><strong>&gt; {data.frameId}</strong></div>
            <div className="feature-item"><span>TIMESTAMP</span><strong>&gt; {data.timestamp}</strong></div>
            <div className="feature-item"><span>PACKET SIZE</span><strong>&gt; {data.packetSize} bytes</strong></div>
          </div>

          <div className="bridge-status">
            <div className="bridge-title"><Activity size={14} /> WEBSOCKET BRIDGE</div>
            <p style={{ color: demoMode ? "var(--text-muted)" : wsReady ? "#7deba5" : "var(--text-muted)" }}>
              {demoMode
                ? "DEMO MODE ACTIVE — BRIDGE DISABLED"
                : wsReady
                  ? "✓ Connected to ws://localhost:8765"
                  : "⟳ Connecting to ws://localhost:8765…"}
            </p>
            <span className="bridge-code">classification_updated(dict)</span>
          </div>

          <button className="demo-button" onClick={() => pushLog(demoMode ? "DEMO DATA IS LOCAL — NO RADAR CONNECTION" : "TIP: Start web_server.py then click CONNECT above")}>
            <Zap size={14} /> {demoMode ? "LOCAL DEMO DATA" : "HOW TO CONNECT"}
          </button>
        </aside>
      </div>

      {/* ── Footer Log ──────────────────────────────────────────────────────── */}
      <footer className="bottom-log">
        <div className="log-window">
          <div className="log-header">
            <span>EVENT LOG</span>
            <span>{logs.length.toString().padStart(2, "0")} ENTRIES</span>
          </div>
          <div className="log-lines" aria-live="polite">
            {logs.map((line, index) => (
              <div key={`${line}-${index}`} className={index === logs.length - 1 ? "latest" : ""}>
                {line}
              </div>
            ))}
          </div>
        </div>
        <div className="log-actions">
          <button className="primary-button" onClick={exportCsv}><Download size={14} /> EXPORT CSV</button>
          <button className="secondary-button" onClick={() => setLogs(["[--:--:--]  AWAITING RADAR DATA"])}>
            <Trash2 size={14} /> CLEAR LOG
          </button>
        </div>
      </footer>
    </main>
  );
}
