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
    float wave = sin((position.x * 1.3 + uTime * 0.55) * 1.8) * 0.065;
    wave += sin((position.z * 1.6 - uTime * 0.38) * 2.1) * 0.05;
    wave += sin((position.x + position.z + uTime * 0.75) * 1.1) * 0.035;
    transformed.y += wave * (0.7 + uConfidence * 0.5);
    vHeight = wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying float vHeight;
  uniform float uTime;
  uniform float uConfidence;

  void main() {
    vec2 uv = vUv;
    float center = 1.0 - smoothstep(0.15, 0.85, distance(uv, vec2(0.5)));
    float ripple = sin(length(uv - 0.5) * 28.0 - uTime * 2.0);
    float shimmer = sin((uv.x * 10.0 + uv.y * 7.0 + uTime * 0.25) * 2.0) * 0.5 + 0.5;
    float depth = smoothstep(0.08, 0.55, uv.y + vHeight * 0.7);

    vec3 deepWater = vec3(0.02, 0.08, 0.14);
    vec3 midWater = vec3(0.03, 0.26, 0.38);
    vec3 brightWater = vec3(0.14, 0.62, 0.76);

    vec3 color = mix(deepWater, midWater, depth);
    color = mix(color, brightWater, smoothstep(0.25, 0.95, shimmer) * 0.35);
    color += vec3(0.16, 0.24, 0.28) * ripple * 0.07;
    color += vec3(0.12, 0.24, 0.28) * center * 0.12;
    color += vec3(0.18, 0.32, 0.38) * uConfidence * 0.08;

    float vignette = smoothstep(1.15, 0.25, distance(uv, vec2(0.5)));
    gl_FragColor = vec4(color * vignette, 1.0);
  }
`;

export function WaterScene({ confidence, reducedMotion }: SurfaceSceneProps) {
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
    const speed = reducedMotion ? 0.12 : 1;
    material.uniforms.uTime.value = state.clock.elapsedTime * speed;
    material.uniforms.uConfidence.value = confidence;

    if (meshRef.current) {
      meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.18) * 0.03;
    }
  });

  return (
    <group>
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 4, 3]} intensity={1.1} color="#bdf3ff" />
      <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.45, 0]}>
        <planeGeometry args={[7.4, 7.4, 84, 84]} />
        <primitive object={material} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.44, 0]}>
        <ringGeometry args={[1.0, 2.8, 64]} />
        <meshBasicMaterial color="#87f0ff" transparent opacity={0.14} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.8, -0.43, -0.5]}>
        <ringGeometry args={[0.4, 1.45, 48]} />
        <meshBasicMaterial color="#e5faff" transparent opacity={0.08} />
      </mesh>
    </group>
  );
}
