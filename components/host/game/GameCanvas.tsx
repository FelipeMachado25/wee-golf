"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { HoleDef } from "@/lib/game/terrain";
import type { GameRefs } from "./useGameLoop";
import type { PeerId } from "@/lib/networking/partykit/protocol";
import { Avatars, type Profile } from "./Avatars";

export const PLAYER_COLORS = ["#f87171", "#60a5fa", "#facc15", "#c084fc", "#34d399", "#fb923c"];

const SURFACE_COLOR: Record<string, string> = {
  tee: "#a7f3d0",
  fairway: "#4ade80",
  green: "#6ee7b7",
  rough: "#15803d",
  bunker: "#fde68a",
  oob: "#0c4a6e",
};

const BALL_VISUAL_R = 0.35; // physical ball is invisible at 90m — render bigger

export function GameCanvas({
  hole,
  refs,
  playerIndex,
  profiles,
}: {
  hole: HoleDef;
  refs: GameRefs;
  playerIndex: Map<PeerId, number>;
  profiles: Record<PeerId, Profile>;
}) {
  return (
    <Canvas
      camera={{ position: [0, 14, -14], fov: 55, near: 0.1, far: 500 }}
      dpr={[1, 2]}
      className="absolute inset-0"
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#0b1020"]} />
      <fog attach="fog" args={["#0b1020", 90, 220]} />
      <hemisphereLight args={["#bfdbfe", "#14532d", 0.9]} />
      <directionalLight position={[30, 60, -20]} intensity={1.4} />
      <Terrain hole={hole} />
      <Cup hole={hole} />
      <Balls hole={hole} refs={refs} playerIndex={playerIndex} />
      <Avatars hole={hole} refs={refs} playerIndex={playerIndex} profiles={profiles} />
      <AimArrow hole={hole} refs={refs} />
      <CameraRig hole={hole} refs={refs} />
    </Canvas>
  );
}

/** Low-poly terrain: non-indexed grid, one flat color per facet. */
function Terrain({ hole }: { hole: HoleDef }) {
  const geometry = useMemo(() => {
    const cell = 1.5;
    const nx = Math.round(hole.bounds.w / cell);
    const nz = Math.round(hole.bounds.l / cell);
    const positions: number[] = [];
    const colors: number[] = [];
    const c = new THREE.Color();
    const push = (x: number, z: number) => positions.push(x, hole.height(x, z), z);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x0 = -hole.bounds.w / 2 + i * cell;
        const z0 = j * cell;
        const x1 = x0 + cell;
        const z1 = z0 + cell;
        // two triangles, each colored by its centroid surface
        const tris: [number, number][][] = [
          [
            [x0, z0],
            [x0, z1],
            [x1, z1],
          ],
          [
            [x0, z0],
            [x1, z1],
            [x1, z0],
          ],
        ];
        for (const tri of tris) {
          const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
          const cz = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          c.set(SURFACE_COLOR[hole.surfaceAt(cx, cz)]);
          for (const [x, z] of tri) {
            push(x, z);
            colors.push(c.r, c.g, c.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [hole]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors flatShading roughness={1} />
    </mesh>
  );
}

function Cup({ hole }: { hole: HoleDef }) {
  const y = hole.height(hole.cup.x, hole.cup.z);
  return (
    <group position={[hole.cup.x, y, hole.cup.z]}>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[hole.cup.r * 2.2, 24]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 2.2, 8]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>
      <mesh position={[0.35, 1.95, 0]}>
        <coneGeometry args={[0.32, 0.7, 4]} />
        <meshStandardMaterial color="#ef4444" flatShading />
      </mesh>
    </group>
  );
}

/** All resting balls + the in-flight ball, colors by player index. */
function Balls({ hole, refs, playerIndex }: { hole: HoleDef; refs: GameRefs; playerIndex: Map<PeerId, number> }) {
  const group = useRef<THREE.Group>(null);
  const pool = useRef<THREE.Mesh[]>([]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const wanted: { pos: { x: number; y: number; z: number }; color: string }[] = [];
    for (const [peer, pos] of refs.rest.current ?? []) {
      if (peer === refs.activePeer.current && refs.ball.current) continue; // moving version below
      wanted.push({ pos: { ...pos, y: hole.height(pos.x, pos.z) + BALL_VISUAL_R }, color: colorFor(peer, playerIndex) });
    }
    const moving = refs.ball.current;
    if (moving && refs.activePeer.current) {
      wanted.push({
        pos: { x: moving.pos.x, y: Math.max(moving.pos.y, hole.height(moving.pos.x, moving.pos.z)) + BALL_VISUAL_R, z: moving.pos.z },
        color: colorFor(refs.activePeer.current, playerIndex),
      });
    }
    // grow pool as needed, hide extras
    while (pool.current.length < wanted.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(BALL_VISUAL_R, 12, 10),
        new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 }),
      );
      pool.current.push(m);
      g.add(m);
    }
    pool.current.forEach((m, i) => {
      const w = wanted[i];
      m.visible = !!w;
      if (w) {
        m.position.set(w.pos.x, w.pos.y, w.pos.z);
        (m.material as THREE.MeshStandardMaterial).color.set(w.color);
      }
    });
  });

  return <group ref={group} />;
}

function colorFor(peer: PeerId, playerIndex: Map<PeerId, number>): string {
  return PLAYER_COLORS[(playerIndex.get(peer) ?? 0) % PLAYER_COLORS.length];
}

/** Direction arrow shown while the active player aims. */
function AimArrow({ hole, refs }: { hole: HoleDef; refs: GameRefs }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const active = refs.activePeer.current;
    const aiming = refs.phase.current === "aiming" && active != null;
    g.visible = aiming;
    if (!aiming) return;
    const pos = refs.rest.current?.get(active) ?? hole.tee;
    const y = hole.height(pos.x, pos.z);
    g.position.set(pos.x, y + 0.15, pos.z);
    g.rotation.y = (refs.aimYawDeg.current * Math.PI) / 180;
  });
  return (
    <group ref={group}>
      {/* arrow points toward +z, rotated by aim yaw */}
      <mesh position={[0, 0, 3.2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 4.4, 8]} />
        <meshStandardMaterial color="#f8fafc" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 0, 5.8]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.35, 1.0, 10]} />
        <meshStandardMaterial color="#f8fafc" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

/** Damped chase camera: behind the ball toward the cup while aiming, follows
 *  in flight, gentle overview when the hole is finished. */
function CameraRig({ hole, refs }: { hole: HoleDef; refs: GameRefs }) {
  const target = useRef(new THREE.Vector3());
  const wanted = new THREE.Vector3();
  const look = new THREE.Vector3();

  useFrame(({ camera }, delta) => {
    const active = refs.activePeer.current;
    const moving = refs.ball.current;
    const finished = refs.phase.current === "finished";

    let focus: { x: number; y: number; z: number };
    if (moving) focus = moving.pos;
    else if (active) {
      const p = refs.rest.current?.get(active) ?? hole.tee;
      focus = { ...p, y: hole.height(p.x, p.z) };
    } else focus = { x: hole.cup.x, y: hole.height(hole.cup.x, hole.cup.z), z: hole.cup.z };

    if (finished) {
      wanted.set(hole.cup.x + 18, 22, hole.cup.z - 24);
      look.set(hole.cup.x, 0, hole.cup.z * 0.7);
    } else {
      // stand behind the focus, opposite the cup
      const dx = hole.cup.x - focus.x;
      const dz = hole.cup.z - focus.z;
      const d = Math.max(1e-3, Math.hypot(dx, dz));
      const back = moving ? 10 : 7;
      const height = moving ? 6 : 3.4;
      wanted.set(focus.x - (dx / d) * back, focus.y + height, focus.z - (dz / d) * back);
      look.set(focus.x + (dx / d) * 8, focus.y + 1, focus.z + (dz / d) * 8);
    }

    const k = 1 - Math.exp(-3 * delta); // framerate-independent damping
    camera.position.lerp(wanted, k);
    target.current.lerp(look, k);
    camera.lookAt(target.current);
  });
  return null;
}
