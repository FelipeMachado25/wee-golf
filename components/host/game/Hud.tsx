"use client";

import type { TurnState } from "@/lib/game/turns";
import type { StrokeInput } from "@/lib/game/physics";
import type { PeerId } from "@/lib/networking/partykit/protocol";
import { PLAYER_COLORS } from "./GameCanvas";

export function Hud({
  turn,
  lastStroke,
  playerIndex,
  labels,
}: {
  turn: TurnState;
  lastStroke: StrokeInput | null;
  playerIndex: Map<PeerId, number>;
  labels: Map<PeerId, string>;
}) {
  const name = (id: PeerId) => labels.get(id) ?? id.slice(0, 6);
  const color = (id: PeerId) => PLAYER_COLORS[(playerIndex.get(id) ?? 0) % PLAYER_COLORS.length];

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 font-mono">
      {/* top bar: whose turn */}
      <div className="flex justify-center">
        {turn.phase !== "finished" && turn.current && (
          <div className="rounded-full bg-black/50 px-5 py-2 text-sm text-white backdrop-blur">
            <span style={{ color: color(turn.current) }}>●</span>{" "}
            <span className="font-bold">{name(turn.current)}</span>
            {turn.phase === "aiming" ? " — aiming (rotate phone, then swing)" : " — ball in motion"}
          </div>
        )}
      </div>

      <div className="flex items-end justify-between">
        {/* scores strip */}
        <div className="flex flex-col gap-1 rounded-xl bg-black/50 p-3 text-xs text-neutral-200 backdrop-blur">
          {turn.scores.map((s) => (
            <div key={s.peerId} className="flex items-center gap-2">
              <span style={{ color: color(s.peerId) }}>●</span>
              <span className="w-16">{name(s.peerId)}</span>
              <span className="tabular-nums">{s.strokes} strokes</span>
              {s.holed && <span className="text-emerald-400">⛳</span>}
              {s.peerId === turn.current && <span className="text-amber-300">◄</span>}
            </div>
          ))}
        </div>

        {/* last stroke power */}
        {lastStroke && (
          <div className="w-56 rounded-xl bg-black/50 p-3 backdrop-blur">
            <div className="mb-1 flex justify-between text-[10px] text-neutral-400">
              <span>POWER {(lastStroke.power * 100).toFixed(0)}%</span>
              <span>FACE {lastStroke.faceDeg.toFixed(1)}°</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-neutral-800">
              <div className="h-full bg-gradient-to-r from-emerald-400 to-red-400" style={{ width: `${lastStroke.power * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* scorecard on finish */}
      {turn.phase === "finished" && turn.scores.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl bg-black/70 p-8 text-center backdrop-blur">
            <h2 className="mb-4 text-2xl font-bold text-white">⛳ Hole complete</h2>
            {[...turn.scores]
              .sort((a, b) => a.strokes - b.strokes)
              .map((s, i) => (
                <div key={s.peerId} className="flex items-center gap-3 py-1 text-lg text-neutral-200">
                  <span className="w-6 text-neutral-500">{i + 1}.</span>
                  <span style={{ color: color(s.peerId) }}>●</span>
                  <span className="w-24 text-left">{name(s.peerId)}</span>
                  <span className="tabular-nums">{s.strokes}</span>
                </div>
              ))}
            <p className="mt-4 text-xs text-neutral-500">Reload the page for a new round (multi-hole flow arrives in Phase 2B)</p>
          </div>
        </div>
      )}
    </div>
  );
}
