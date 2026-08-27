"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PeerId } from "@/lib/networking/partykit/protocol";
import type { HoleDef } from "@/lib/game/terrain";
import { estimateMaxDistance } from "@/lib/game/clubs";
import type { GameRefs } from "./useGameLoop";
import { PLAYER_COLORS } from "./GameCanvas";

const SURFACE_FILL: Record<string, string> = {
  tee: "#a7f3d0",
  fairway: "#4ade80",
  green: "#6ee7b7",
  rough: "#166534",
  bunker: "#fde68a",
  oob: "#0b1020",
};

const MAP_W = 120; // css px

/** Top-down course map: static surface raster per hole, plus a rAF overlay
 *  with every ball, the aim line of the active player and an arc marking the
 *  selected club's measured max range. Tee at the bottom, cup at the top. */
export function Minimap({ hole, refs, playerIndex }: { hole: HoleDef; refs: GameRefs; playerIndex: Map<PeerId, number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = MAP_W / hole.bounds.w;
  const mapH = Math.round(hole.bounds.l * scale);

  // Static background: sample the surface on a ~1m grid, once per hole.
  const bg = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = MAP_W;
    c.height = mapH;
    const ctx = c.getContext("2d")!;
    const cell = Math.max(1, Math.floor(scale));
    for (let px = 0; px < MAP_W; px += cell) {
      for (let py = 0; py < mapH; py += cell) {
        const x = px / scale - hole.bounds.w / 2;
        const z = hole.bounds.l - py / scale; // tee (z small) at the bottom
        ctx.fillStyle = SURFACE_FILL[hole.surfaceAt(x, z)] ?? "#166534";
        ctx.fillRect(px, py, cell, cell);
      }
    }
    return c;
  }, [hole, mapH, scale]);

  useEffect(() => {
    let raf = 0;
    const toPx = (x: number, z: number): [number, number] => [(x + hole.bounds.w / 2) * scale, (hole.bounds.l - z) * scale];

    const tick = () => {
      const ctx = canvas.current?.getContext("2d");
      if (ctx && bg) {
        ctx.clearRect(0, 0, MAP_W, mapH);
        ctx.drawImage(bg, 0, 0);

        // cup
        const [cx, cy] = toPx(hole.cup.x, hole.cup.z);
        ctx.fillStyle = "#111827";
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ef4444";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy - 6);
        ctx.stroke();

        const active = refs.activePeer.current;

        // aim line + club range arc for the active player
        if (active && refs.phase.current === "aiming") {
          const pos = refs.rest.current?.get(active);
          if (pos) {
            const range = estimateMaxDistance(refs.club.current ?? "driver");
            const yaw = ((refs.aimYawDeg.current ?? 0) * Math.PI) / 180;
            const [px0, py0] = toPx(pos.x, pos.z);
            const [px1, py1] = toPx(pos.x + Math.sin(yaw) * range, pos.z + Math.cos(yaw) * range);
            ctx.strokeStyle = "rgba(248,250,252,0.85)";
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(px0, py0);
            ctx.lineTo(px1, py1);
            ctx.stroke();
            ctx.setLineDash([]);
            // range arc, centered on the ball
            ctx.strokeStyle = "rgba(248,250,252,0.5)";
            ctx.beginPath();
            ctx.arc(px0, py0, range * scale, -Math.PI / 2 - 0.6 - yaw, -Math.PI / 2 + 0.6 - yaw);
            ctx.stroke();
          }
        }

        // resting balls
        for (const [peer, pos] of refs.rest.current ?? []) {
          if (peer === active && refs.ball.current) continue;
          drawBall(ctx, toPx(pos.x, pos.z), colorFor(peer, playerIndex));
        }
        // moving ball
        const moving = refs.ball.current;
        if (moving && active) drawBall(ctx, toPx(moving.pos.x, moving.pos.z), colorFor(active, playerIndex));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bg, hole, mapH, scale, refs, playerIndex]);

  return (
    <div className="absolute left-4 top-4 rounded-xl bg-black/50 p-2 backdrop-blur">
      <canvas ref={canvas} width={MAP_W} height={mapH} style={{ width: MAP_W, height: mapH, maxHeight: 320, objectFit: "contain" }} />
    </div>
  );
}

function drawBall(ctx: CanvasRenderingContext2D, [x, y]: [number, number], color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function colorFor(peer: PeerId, playerIndex: Map<PeerId, number>): string {
  return PLAYER_COLORS[(playerIndex.get(peer) ?? 0) % PLAYER_COLORS.length];
}
