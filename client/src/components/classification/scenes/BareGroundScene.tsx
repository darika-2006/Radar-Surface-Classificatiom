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
    float rise = sin(position.x * 2.0 + position.z * 2.6) * 0.015;
    rise += sin((position.x - position.z) * 4.1 + uTime * 0.12) * 0.008;
    transformed.y += rise * (0.8 + uConfidence * 0.25);
    vHeight = rise;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vHeight;
  uniform float uTime;
  uniform float uConfidence;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(41.13, 289.97))) * 43758.5453123);
  }

  void main() {
    vec2 uv = vUv;
    float grain = hash(floor(uv * 34.0 + uTime * 0.5));
    float mottling = abs(sin((uv.x * 8.0 + uv.y * 7.0 + uTime * 0.1) * 1.2));
    float pebble = smoothstep(0.72, 0.95, grain + mottling * 0.2);
    float patch = smoothstep(0.18, 0.92, abs(sin((uv.x + uv.y * 0.8) * 8.0)));

    vec3 soil = vec3(0.24, 0.19, 0.12);
    vec3 dust = vec3(0.40, 0.31, 0.20);
    vec3 stone = vec3(0.52, 0.45, 0.38);

    vec3 color = mix(soil, dust, patch * 0.42 + vHeight * 2.0 + uConfidence * 0.05);
    color = mix(color, stone, pebble * 0.22);
    color += vec3(0.05, 0.02, 0.01) * uConfidence * 0.05;

    float vignette = smoothstep(1.1, 0.3, distance(uv, vec2(0.5)));
    gl_FragColor = vec4(color * vignette, 1.0);
  }
`;

export function BareGroundScene({ confidence, reducedMotion }: SurfaceSceneProps) {
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
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.11) * 0.02;
    }
  });

  const stones = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        position: [
          Math.cos(index * 0.62) * 1.2,
          -0.18 + (index % 4) * 0.02,
          Math.sin(index * 0.74) * 0.85,
        ] as [number, number, number],
        rotation: [index * 0.28, index * 0.18, index * 0.12] as [number, number, number],
        scale: 0.06 + (index % 5) * 0.018,
      })),
    []
  );

  return (
    <group>
      <ambientLight intensity={0.76} />
      <directionalLight position={[2.4, 3.5, 2.1]} intensity={1.0} color="#f4d1a3" />
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.45, 0]}>
        <planeGeometry args={[7.2, 7.2, 54, 54]} />
        <primitive object={material} attach="material" />
      </mesh>
      {stones.map((stone, index) => (
        <mesh key={index} position={stone.position} rotation={stone.rotation} scale={stone.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={index % 2 === 0 ? "#7b6855" : "#615246"} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}
