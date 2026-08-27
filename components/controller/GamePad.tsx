"use client";

import type { GameMessage } from "@/lib/networking/partykit/protocol";

export type PadState = {
  turn: { yourTurn: boolean; strokeIndex: number } | null;
  aimLocked: boolean;
  swung: boolean;
  result: Extract<GameMessage, { kind: "stroke-result" }> | null;
  finished: Extract<GameMessage, { kind: "hole-finished" }> | null;
  myPeerId: string;
};

/** The phone-as-club surface. Pure presentation — all state lives in
 *  ControllerClient, all physics on the host. */
export function GamePad({ state, onLockAim }: { state: PadState; onLockAim: () => void }) {
  const { turn, aimLocked, swung, result, finished } = state;

  if (finished) {
    const mine = finished.scores.find((s) => s.peerId === state.myPeerId);
    return (
      <Panel tone="emerald">
        <p className="text-2xl">⛳ Hole complete</p>
        {mine && <p className="mt-2 font-mono text-4xl tabular-nums">{mine.strokes} strokes</p>}
      </Panel>
    );
  }

  if (!turn) {
    return (
      <Panel tone="neutral">
        <p className="text-sm text-neutral-400">Waiting for the host to start the hole…</p>
      </Panel>
    );
  }

  if (!turn.yourTurn) {
    return (
      <Panel tone="neutral">
        <p className="text-lg">⏳ Another player is up</p>
        {result && <ResultLine result={result} />}
        <p className="mt-1 font-mono text-xs text-neutral-500">your strokes: {turn.strokeIndex}</p>
      </Panel>
    );
  }

  if (swung) {
    return (
      <Panel tone="amber">
        <p className="animate-pulse text-lg">🏌️ Ball in motion…</p>
      </Panel>
    );
  }

  if (!aimLocked) {
    return (
      <Panel tone="emerald">
        <p className="mb-1 text-lg font-bold">Your turn — aim</p>
        <p className="mb-4 text-center text-sm text-neutral-300">
          Rotate the phone left/right and watch the arrow on the big screen.
        </p>
        <button
          onClick={onLockAim}
          className="h-20 w-full rounded-2xl bg-emerald-500 text-xl font-bold text-neutral-950 shadow-lg shadow-emerald-500/30 active:scale-95"
        >
          Lock aim 🎯
        </button>
      </Panel>
    );
  }

  return (
    <Panel tone="violet">
      <p className="text-xl font-bold">Swing now! 🏌️</p>
      <p className="mt-2 text-center text-sm text-neutral-300">
        Hold the phone like a club and swing — harder swing, longer shot.
      </p>
    </Panel>
  );
}

function ResultLine({ result }: { result: Extract<GameMessage, { kind: "stroke-result" }> }) {
  if (result.outcome === "holed") return <p className="text-emerald-400">⛳ You holed it!</p>;
  if (result.outcome === "oob") return <p className="text-red-400">↩ Out of bounds — replay with +1 penalty</p>;
  return <p className="text-neutral-300">Ball stopped {result.distToCup.toFixed(1)}m from the cup</p>;
}

function Panel({ tone, children }: { tone: "neutral" | "emerald" | "amber" | "violet"; children: React.ReactNode }) {
  const border = {
    neutral: "border-neutral-800",
    emerald: "border-emerald-500/40",
    amber: "border-amber-500/40",
    violet: "border-violet-500/40",
  }[tone];
  return (
    <div className={`flex w-full max-w-xs flex-col items-center rounded-2xl border ${border} bg-neutral-900 p-5`}>{children}</div>
  );
}
