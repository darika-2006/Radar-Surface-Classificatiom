import { Canvas } from "@react-three/fiber";
import { motion, useReducedMotion } from "framer-motion";
import {
  Component,
  type ComponentType,
  type ReactNode,
  useMemo,
  useState,
} from "react";

import { BareGroundScene } from "./scenes/BareGroundScene";
import { DryGroundScene } from "./scenes/DryGroundScene";
import { GrassScene } from "./scenes/GrassScene";
import { WaterScene } from "./scenes/WaterScene";
import type {
  ClassificationLabel,
  ClassificationMode,
  SurfaceSceneProps,
} from "./types";
import GrassCanvasMini from "@/components/GrassCanvasMini";
import DrySurfaceCanvasMini from "@/components/DrySurfaceCanvasMini";
import WaterConfidenceCanvas from "@/components/WaterConfidenceCanvas";

type SurfaceAnimationProps = {
  mode: ClassificationMode;
  classification: ClassificationLabel;
  confidence: number;
  wetConfidence?: number;
};

type SceneKey = "water" | "dry" | "grass" | "bare";

const SCENE_MAP: Record<
  ClassificationMode,
  Record<ClassificationLabel, SceneKey>
> = {
  "wet-dry": {
    WET: "water",
    DRY: "dry",
    GRASS: "dry",
    "NOT GRASS": "bare",
  },
  "grass-not-grass": {
    GRASS: "grass",
    "NOT GRASS": "bare",
    WET: "water",
    DRY: "dry",
  },
};

const SCENE_COMPONENTS: Record<SceneKey, ComponentType<SurfaceSceneProps>> = {
  water: WaterScene,
  dry: DryGroundScene,
  grass: GrassScene,
  bare: BareGroundScene,
};

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

function SceneFallback({
  label,
  confidence,
}: {
  label: string;
  confidence: number;
}) {
  return (
    <div className="surface-animation-fallback">
      <div className="surface-animation-fallback-copy">
        3D VISUALIZATION UNAVAILABLE
      </div>
      <div className="surface-animation-fallback-label">{label}</div>
      <div className="surface-animation-fallback-confidence">
        {(confidence * 100).toFixed(2)}%
      </div>
    </div>
  );
}

export function SurfaceAnimation({
  mode,
  classification,
  confidence,
  wetConfidence = 0,
}: SurfaceAnimationProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [canvasFailed, setCanvasFailed] = useState(false);

  const sceneKey = SCENE_MAP[mode][classification];
  const Scene = SCENE_COMPONENTS[sceneKey];
  const scene = useMemo(
    () => <Scene confidence={confidence} reducedMotion={reducedMotion} />,
    [Scene, confidence, reducedMotion]
  );

  // ── Wet-Dry Continuous Visualization ────────────────────────────────────
  if (mode === "wet-dry") {
    return (
      <motion.div
        className="surface-animation-shell"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <WaterConfidenceCanvas wetConfidence={wetConfidence} />
        <div className="surface-animation-caption">{classification}</div>
      </motion.div>
    );
  }

  // ── Grass: bypass WebGL, use interactive Canvas2D animation ─────────────
  if (sceneKey === "grass") {
    return (
      <motion.div
        className="surface-animation-shell"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <GrassCanvasMini />
        <div className="surface-animation-caption">GRASS</div>
      </motion.div>
    );
  }

  // ── Dry/Bare: bypass WebGL, use interactive DrySurfaceCanvasMini ─────────────
  if (sceneKey === "dry" || sceneKey === "bare") {
    return (
      <motion.div
        className="surface-animation-shell"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <DrySurfaceCanvasMini />
        <div className="surface-animation-caption">{classification}</div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="surface-animation-shell"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <SceneBoundary
        fallback={
          <SceneFallback label={classification} confidence={confidence} />
        }
      >
        {canvasFailed ? (
          <SceneFallback label={classification} confidence={confidence} />
        ) : (
          <Canvas
            className="surface-animation-canvas"
            dpr={[1, 1.5]}
            frameloop={reducedMotion ? "demand" : "always"}
            gl={{
              antialias: true,
              alpha: true,
              powerPreference: "high-performance",
            }}
            camera={{ position: [0, 1.35, 4.35], fov: 34 }}
            onCreated={({ gl }) => {
              try {
                gl.setClearColor("#0b0f14", 1);
              } catch {
                setCanvasFailed(true);
              }
            }}
          >
            <color attach="background" args={["#0b0f14"]} />
            <fog attach="fog" args={["#0b0f14", 4, 11]} />
            <group key={sceneKey}>{scene}</group>
          </Canvas>
        )}
      </SceneBoundary>
      <div className="surface-animation-caption">{classification}</div>
    </motion.div>
  );
}
