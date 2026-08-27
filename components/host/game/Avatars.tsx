"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PeerId } from "@/lib/networking/partykit/protocol";
import type { HoleDef } from "@/lib/game/terrain";
import type { GameRefs } from "./useGameLoop";
import { PLAYER_COLORS } from "./GameCanvas";

export type Profile = { name: string; face?: string };

const SKIN = "#eecfb0";
const SUIT = "#4b5563";
const TROUSERS = "#374151";

/** One low-poly suit guy per player, standing at their ball. The active
 *  player's avatar raises its arms with the live backswing meter and follows
 *  through when the ball launches. Face = the player's selfie texture, or a
 *  seeded procedurally-ugly face when none was provided. */
export function Avatars({
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
  const peers = [...playerIndex.keys()];
  return (
    <>
      {peers.map((p, i) => (
        <SuitGuy
          key={p}
          peerId={p}
          hole={hole}
          refs={refs}
          accent={PLAYER_COLORS[(playerIndex.get(p) ?? 0) % PLAYER_COLORS.length]}
          face={profiles[p]?.face}
          name={profiles[p]?.name || (p === "DEBUG" ? "DEBUG" : `P${i + 1}`)}
        />
      ))}
    </>
  );
}

function SuitGuy({
  peerId,
  hole,
  refs,
  accent,
  face,
  name,
}: {
  peerId: PeerId;
  hole: HoleDef;
  refs: GameRefs;
  accent: string;
  face?: string;
  name: string;
}) {
  const root = useRef<THREE.Group>(null);
  const arms = useRef<THREE.Group>(null);
  const swingT = useRef<number | null>(null);
  const wasAiming = useRef(false);
  const faceTexture = useFaceTexture(peerId, face);

  const faceMaterials = useMemo(() => {
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, flatShading: true });
    const front = new THREE.MeshStandardMaterial({ map: faceTexture, flatShading: true });
    // BoxGeometry material order: +x, -x, +y, -y, +z(front), -z
    return [skin, skin, skin, skin, front, skin];
  }, [faceTexture]);

  useFrame((_, delta) => {
    const g = root.current;
    if (!g) return;
    const isActive = refs.activePeer.current === peerId;
    const pos = refs.rest.current?.get(peerId);
    if (!pos) {
      g.visible = false; // holed out — walked off the course
      return;
    }
    g.visible = true;

    const y = hole.height(pos.x, pos.z);
    const yaw = isActive ? (refs.aimYawDeg.current * Math.PI) / 180 : Math.PI; // idle guys face the tee cam
    // Stand beside the ball, on the left of the aim direction.
    const side = 0.55;
    g.position.set(pos.x - Math.cos(yaw) * side, y, pos.z + Math.sin(yaw) * side);
    g.rotation.y = yaw;

    // Swing animation: arms track the live meter while aiming; when the
    // stroke fires (aiming → ball-in-motion), a quick follow-through plays.
    const aiming = isActive && refs.phase.current === "aiming";
    if (wasAiming.current && isActive && refs.phase.current === "ball-in-motion") swingT.current = 0;
    wasAiming.current = aiming;

    if (arms.current) {
      if (swingT.current != null) {
        swingT.current += delta * 3.5;
        if (swingT.current >= 1) swingT.current = null;
        else arms.current.rotation.x = -2.0 + swingT.current * 3.1; // whoosh through
      } else if (aiming) {
        const m = Math.max(0, refs.meter.current ?? 0);
        arms.current.rotation.x = -0.35 - m * 1.75; // raise with the backswing
      } else {
        arms.current.rotation.x = -0.35;
      }
    }
  });

  return (
    <group ref={root} scale={1.15}>
      {/* legs + shoes */}
      {[-0.11, 0.11].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.38, 0]}>
            <boxGeometry args={[0.16, 0.76, 0.16]} />
            <meshStandardMaterial color={TROUSERS} flatShading />
          </mesh>
          <mesh position={[x, 0.04, 0.05]}>
            <boxGeometry args={[0.17, 0.08, 0.3]} />
            <meshStandardMaterial color="#111827" flatShading />
          </mesh>
        </group>
      ))}
      {/* torso: suit, shirt, tie */}
      <mesh position={[0, 1.02, 0]}>
        <boxGeometry args={[0.44, 0.56, 0.26]} />
        <meshStandardMaterial color={SUIT} flatShading />
      </mesh>
      <mesh position={[0, 1.12, 0.135]}>
        <boxGeometry args={[0.16, 0.3, 0.02]} />
        <meshStandardMaterial color="#f8fafc" flatShading />
      </mesh>
      <mesh position={[0, 1.06, 0.145]}>
        <boxGeometry args={[0.055, 0.26, 0.02]} />
        <meshStandardMaterial color={accent} flatShading />
      </mesh>
      {/* arms group pivots at the shoulders, club in hands */}
      <group ref={arms} position={[0, 1.24, 0]} rotation={[-0.35, 0, 0]}>
        {[-0.27, 0.27].map((x) => (
          <mesh key={x} position={[x, -0.26, 0.06]} rotation={[0, 0, x < 0 ? 0.18 : -0.18]}>
            <boxGeometry args={[0.11, 0.52, 0.11]} />
            <meshStandardMaterial color={SUIT} flatShading />
          </mesh>
        ))}
        {/* club shaft + head */}
        <mesh position={[0, -0.62, 0.14]} rotation={[0.25, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.85, 6]} />
          <meshStandardMaterial color="#9ca3af" flatShading />
        </mesh>
        <mesh position={[0.05, -1.02, 0.24]}>
          <boxGeometry args={[0.14, 0.06, 0.08]} />
          <meshStandardMaterial color="#d1d5db" flatShading />
        </mesh>
      </group>
      {/* head with face texture + hair */}
      <mesh position={[0, 1.48, 0]} material={faceMaterials}>
        <boxGeometry args={[0.24, 0.28, 0.24]} />
      </mesh>
      <mesh position={[0, 1.63, -0.02]}>
        <boxGeometry args={[0.26, 0.07, 0.24]} />
        <meshStandardMaterial color="#3f2d20" flatShading />
      </mesh>
      <NameTag name={name} accent={accent} />
    </group>
  );
}

/** Camera-facing name plate above the head, drawn to a canvas texture. */
function NameTag({ name, accent }: { name: string; accent: string }) {
  const sprite = useRef<THREE.Sprite>(null);
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 34px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.min(248, ctx.measureText(name).width + 28);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect((256 - w) / 2, 10, w, 44, 12);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillText(name, 128, 33, 236);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [name, accent]);

  return (
    <sprite ref={sprite} position={[0, 2.0, 0]} scale={[1.6, 0.4, 1]}>
      <spriteMaterial map={texture} depthTest={false} transparent />
    </sprite>
  );
}

/** Selfie texture when provided; otherwise a deterministic, lovingly ugly
 *  procedural face seeded by the peerId — everyone gets a different one. */
function useFaceTexture(peerId: string, face?: string): THREE.Texture {
  const fallback = useMemo(() => makeUglyFace(peerId), [peerId]);
  const [tex, setTex] = useState<THREE.Texture>(fallback);
  useEffect(() => {
    if (!face) {
      setTex(fallback);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ctx = c.getContext("2d")!;
      // cover-crop the selfie into the square face
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      setTex(t);
    };
    img.src = face;
    return () => {
      cancelled = true;
    };
  }, [face, fallback]);
  return tex;
}

function makeUglyFace(seed: string): THREE.Texture {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = (n: number) => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return (h / 4294967296) * n;
  };
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = SKIN;
  ctx.fillRect(0, 0, 128, 128);
  // mismatched eyes
  const ey = 45 + r(12);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(40, ey, 9 + r(6), 7 + r(4), 0, 0, Math.PI * 2);
  ctx.ellipse(88, ey + r(10) - 5, 6 + r(7), 9 + r(3), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(40 + r(6) - 3, ey, 3, 0, Math.PI * 2);
  ctx.arc(88 + r(6) - 3, ey + 2, 4, 0, Math.PI * 2);
  ctx.fill();
  // unibrow
  ctx.strokeStyle = "#3f2d20";
  ctx.lineWidth = 5 + r(4);
  ctx.beginPath();
  ctx.moveTo(26, ey - 14 + r(6));
  ctx.quadraticCurveTo(64, ey - 22 + r(10), 102, ey - 14 + r(6));
  ctx.stroke();
  // generous nose
  ctx.fillStyle = "#d9a97e";
  ctx.beginPath();
  ctx.ellipse(64, 74 + r(6), 8 + r(8), 12 + r(6), 0, 0, Math.PI * 2);
  ctx.fill();
  // crooked mouth + one heroic tooth
  ctx.strokeStyle = "#7f1d1d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(44, 100 + r(8));
  ctx.quadraticCurveTo(64, 108 + r(10) - 5, 86, 98 + r(10));
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(58 + r(10), 100, 7, 8);
  // beauty mark
  ctx.fillStyle = "#6b4a2f";
  ctx.beginPath();
  ctx.arc(20 + r(88), 30 + r(80), 2.5, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
