"use client";

import { useState } from "react";
import type { StrokeInput } from "@/lib/game/physics";

/** Checkpoint-E instrument, dev only (?debug=1): fire strokes without a phone. */
export function TestStrokeBar({ onFire }: { onFire: (i: StrokeInput) => void }) {
  const [power, setPower] = useState(0.6);
  const [aimDeg, setAimDeg] = useState(0);
  const [faceDeg, setFaceDeg] = useState(0);

  return (
    <div className="pointer-events-auto absolute right-4 top-4 flex w-64 flex-col gap-2 rounded-xl bg-black/60 p-4 font-mono text-xs text-neutral-200 backdrop-blur">
      <div className="text-[10px] font-bold text-amber-300">DEBUG STROKE</div>
      <label className="flex items-center justify-between gap-2">
        power {(power * 100).toFixed(0)}%
        <input type="range" min={0.05} max={1} step={0.05} value={power} onChange={(e) => setPower(Number(e.target.value))} />
      </label>
      <label className="flex items-center justify-between gap-2">
        aim {aimDeg}°
        <input type="range" min={-45} max={45} step={1} value={aimDeg} onChange={(e) => setAimDeg(Number(e.target.value))} />
      </label>
      <label className="flex items-center justify-between gap-2">
        face {faceDeg}°
        <input type="range" min={-10} max={10} step={0.5} value={faceDeg} onChange={(e) => setFaceDeg(Number(e.target.value))} />
      </label>
      <button onClick={() => onFire({ power, aimDeg, faceDeg })} className="mt-1 rounded-lg bg-amber-400 py-2 font-bold text-black active:scale-95">
        FIRE
      </button>
    </div>
  );
}
