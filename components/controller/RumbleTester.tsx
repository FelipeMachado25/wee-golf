"use client";

import { useState } from "react";
import { isAudioUnlocked, playRumble } from "@/lib/audio/rumble";

const FREQS = [20, 40, 60, 90] as const;
const DURATIONS = [100, 200, 400] as const;

/** Checkpoint D instrument: the brief's default is 20Hz/100ms, but a phone
 *  speaker can't reproduce 20Hz — the selectors exist so the real iPhone
 *  decides which frequency actually feels strongest. */
export function RumbleTester() {
  const [hz, setHz] = useState<number>(60);
  const [ms, setMs] = useState<number>(100);

  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-neutral-900 p-4">
      <button
        onClick={() => playRumble({ hz, ms, gain: 1.0 })}
        disabled={!isAudioUnlocked()}
        className="h-14 w-full rounded-xl bg-violet-500 font-bold text-neutral-950 active:scale-95 disabled:opacity-40"
      >
        Test rumble
      </button>
      <div className="flex gap-2">
        {FREQS.map((f) => (
          <button
            key={f}
            onClick={() => setHz(f)}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs ${hz === f ? "bg-violet-500 text-neutral-950" : "bg-neutral-800 text-neutral-400"}`}
          >
            {f}Hz
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d}
            onClick={() => setMs(d)}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs ${ms === d ? "bg-violet-500 text-neutral-950" : "bg-neutral-800 text-neutral-400"}`}
          >
            {d}ms
          </button>
        ))}
      </div>
      <p className="text-center text-[11px] leading-tight text-neutral-500">
        ⚠️ The iPhone mute switch silences Safari audio — flip it up before testing.
      </p>
    </div>
  );
}
