import { SurfaceAnimation } from "./SurfaceAnimation";
import type { ClassificationCardProps } from "./types";

export function ClassificationCard({
  mode,
  classification,
  confidence,
  wetConfidence,
  runtimeStatus,
  connectionLabel,
}: ClassificationCardProps) {
  const title = mode === "wet-dry" ? "SURFACE CLASSIFICATION" : "GRASS CLASSIFICATION";

  return (
    <section className="classification-card">
      <div className="classification-card-header">
        <div className="classification-card-title">{title}</div>
        <div className={`classification-card-status ${runtimeStatus}`}>{connectionLabel}</div>
      </div>

      <div className="classification-card-scene">
        <SurfaceAnimation mode={mode} classification={classification} confidence={confidence} wetConfidence={wetConfidence} />
      </div>

      <div className="classification-card-body">
        <div className="classification-label">{classification}</div>
        <div className="classification-confidence-row">
          <span>CONFIDENCE</span>
          <strong>{(confidence * 100).toFixed(2)}%</strong>
        </div>
        <div className="classification-meter" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(1, confidence)) * 100}%` }} />
        </div>
      </div>
    </section>
  );
}
