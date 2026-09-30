export type ClassificationMode = "wet-dry" | "grass-not-grass";

export type ClassificationLabel = "WET" | "DRY" | "GRASS" | "NOT GRASS";

export type RuntimeStatus = "demo" | "real";

export type SurfaceSceneProps = {
  confidence: number;
  reducedMotion?: boolean;
};

export type ClassificationCardProps = {
  mode: ClassificationMode;
  classification: ClassificationLabel;
  confidence: number;
  wetConfidence?: number;
  runtimeStatus: RuntimeStatus;
  connectionLabel: string;
};
