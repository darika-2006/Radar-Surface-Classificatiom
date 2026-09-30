import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { SurfaceSceneProps } from "../types";

type Blade = {
  position: [number, number, number];
  height: number;
  phase: number;
  tilt: number;
};

export function GrassScene({ confidence, reducedMotion }: SurfaceSceneProps) {
  const bladesRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const blades = useMemo<Blade[]>(
    () =>
      Array.from({ length: 96 }, (_, index) => {
        const angle = (index / 96) * Math.PI * 2;
        const radius = 1.25 + (index % 7) * 0.08;
        const jitter = (index % 5) * 0.03;
        return {
          position: [
            Math.cos(angle) * radius + Math.sin(index * 1.8) * 0.14,
            -0.24,
            Math.sin(angle) * radius + Math.cos(index * 1.3) * 0.14,
          ],
          height: 0.38 + ((index * 37) % 45) / 120,
          phase: index * 0.33,
          tilt: jitter + ((index % 3) - 1) * 0.08,
        };
      }),
    []
  );

  useFrame((state) => {
    const mesh = bladesRef.current;
    if (!mesh) return;

    const speed = reducedMotion ? 0.12 : 1;
    const time = state.clock.elapsedTime * speed;

    blades.forEach((blade, index) => {
      const sway = Math.sin(time * 1.6 + blade.phase) * (0.13 + confidence * 0.06);
      dummy.position.set(...blade.position);
      dummy.rotation.set(sway * 0.18, blade.tilt + sway * 0.65, sway * 0.22);
      dummy.scale.set(0.028, blade.height * (0.95 + confidence * 0.12), 0.025);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    if (bladesRef.current) {
      bladesRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [blades]);

  return (
    <group>
      <ambientLight intensity={0.9} />
      <directionalLight position={[1.8, 4.2, 2.1]} intensity={1.25} color="#d9ffb5" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.48, 0]}>
        <planeGeometry args={[7.0, 7.0, 18, 18]} />
        <meshStandardMaterial color="#3a3521" roughness={1} metalness={0} />
      </mesh>
      <instancedMesh ref={bladesRef} args={[undefined, undefined, blades.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#66c95f" roughness={1} metalness={0} />
      </instancedMesh>
      <mesh position={[0, -0.22, -0.3]} rotation={[0.2, 0.6, -0.3]}>
        <icosahedronGeometry args={[0.35, 0]} />
        <meshStandardMaterial color="#527b35" roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}
