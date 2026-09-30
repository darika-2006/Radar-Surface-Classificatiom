import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { SurfaceSceneProps } from "../types";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vHeight;
  uniform float uTime;
  uniform float uConfidence;

  void main() {
    vUv = uv;
    vec3 transformed = position;
    float wobble = sin(position.x * 3.4 + position.z * 2.8) * 0.012;
    wobble += sin((position.x + position.z) * 5.2 + uTime * 0.18) * 0.01;
    transformed.y += wobble * (0.9 + uConfidence * 0.3);
    vHeight = wobble;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vHeight;
  uniform float uTime;
  uniform float uConfidence;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float crackField(vec2 uv, float seed) {
    float lineA = abs(sin((uv.x * 18.0 + uv.y * 13.0 + seed) * 1.15));
    float lineB = abs(sin((uv.x * 8.0 - uv.y * 21.0 + seed * 0.7) * 1.6));
    float lineC = abs(sin((uv.x * 26.0 + uv.y * 4.0 + seed * 1.3) * 0.95));
    float cracks = 1.0 - smoothstep(0.62, 0.88, lineA * 0.55 + lineB * 0.3 + lineC * 0.25);
    return cracks;
  }

  void main() {
    vec2 uv = vUv;
    float seed = uTime * 0.03;
    float cracks = crackField(uv + vHeight * 0.8, seed);
    float speckle = hash(floor(uv * 36.0 + seed * 3.0));
    float grain = smoothstep(0.45, 0.95, speckle);
    float dust = smoothstep(0.15, 0.95, abs(sin((uv.x + uv.y * 1.7 + seed) * 10.0)));

    vec3 soil = vec3(0.24, 0.16, 0.10);
    vec3 dry = vec3(0.44, 0.30, 0.18);
    vec3 pale = vec3(0.60, 0.46, 0.28);
    vec3 crack = vec3(0.08, 0.06, 0.05);

    vec3 color = mix(soil, dry, grain * 0.7 + dust * 0.2);
    color = mix(color, pale, smoothstep(0.2, 0.95, uv.y) * 0.35);
    color = mix(color, crack, cracks * 0.8);
    color += vec3(0.08, 0.04, 0.02) * uConfidence * 0.05;

    float vignette = smoothstep(1.08, 0.28, distance(uv, vec2(0.5)));
    gl_FragColor = vec4(color * vignette, 1.0);
  }
`;

export function DryGroundScene({ confidence, reducedMotion }: SurfaceSceneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uConfidence: { value: confidence },
        },
        vertexShader,
        fragmentShader,
      }),
    [confidence]
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    const speed = reducedMotion ? 0.1 : 1;
    material.uniforms.uTime.value = state.clock.elapsedTime * speed;
    material.uniforms.uConfidence.value = confidence;

    if (meshRef.current) {
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.12) * 0.03;
    }
  });

  const rocks = useMemo(
    () =>
      Array.from({ length: 8 }, (_, index) => ({
        position: [
          Math.cos(index * 0.78) * 1.4,
          -0.15 + (index % 3) * 0.02,
          Math.sin(index * 0.86) * 0.95,
        ] as [number, number, number],
        scale: 0.08 + (index % 4) * 0.03,
        rotation: [index * 0.3, index * 0.17, index * 0.21] as [number, number, number],
        color: index % 2 === 0 ? "#8b6d4f" : "#6a5542",
      })),
    []
  );

  return (
    <group>
      <ambientLight intensity={0.72} />
      <directionalLight position={[-1.5, 3.5, 2.2]} intensity={1.1} color="#ffd9a1" />
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.45, 0]}>
        <planeGeometry args={[7.2, 7.2, 54, 54]} />
        <primitive object={material} attach="material" />
      </mesh>
      {rocks.map((rock, index) => (
        <mesh key={index} position={rock.position} rotation={rock.rotation} scale={rock.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={rock.color} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}
