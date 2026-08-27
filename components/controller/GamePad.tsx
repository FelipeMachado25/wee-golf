"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { GameMessage } from "@/lib/networking/partykit/protocol";
import { CLUB_ORDER, CLUBS, estimateMaxDistance, type ClubId } from "@/lib/game/clubs";

export type SwingPhase = "aim" | "address" | "backswing";

export type PadState = {
  turn: { yourTurn: boolean; strokeIndex: number; club: ClubId; distToCup: number } | null;
  club: ClubId;
  swingPhase: SwingPhase;
  swung: boolean;
  result: Extract<GameMessage, { kind: "stroke-result" }> | null;
  hole: Extract<GameMessage, { kind: "hole-start" }> | null;
  finished: Extract<GameMessage, { kind: "hole-finished" }> | null;
  courseTotals: Extract<GameMessage, { kind: "course-finished" }> | null;
  myPeerId: string;
};

/** The phone-as-club surface, Wii Golf style with a button lock: rotate to
 *  aim → tap Lock (freezes the arrow, captures your grip as the reference) →
 *  raise to charge → swing through to hit. Pure presentation — detection
 *  lives in ControllerClient, physics on the host. */
export function GamePad({
  state,
  meterRef,
  onLockAim,
  onReAim,
  onClub,
}: {
  state: PadState;
  meterRef: RefObject<number>;
  onLockAim: () => void;
  onReAim: () => void;
  onClub: (club: ClubId) => void;
}) {
  const { turn, swingPhase, swung, result, hole, finished, courseTotals, club } = state;
  const holeChip = hole ? `Hole ${hole.index + 1}/${hole.total} · Par ${hole.par}` : null;

  if (courseTotals) {
    const sorted = [...courseTotals.totals].sort((a, b) => a.strokes - b.strokes);
    const myRank = sorted.findIndex((s) => s.peerId === state.myPeerId);
    const mine = sorted[myRank];
    return (
      <Panel tone="emerald">
        <p className="text-2xl">🏆 Course complete</p>
        {mine && (
          <>
            <p className="mt-2 font-mono text-5xl tabular-nums">#{myRank + 1}</p>
            <p className="font-mono text-sm text-neutral-400">{mine.strokes} strokes total</p>
          </>
        )}
      </Panel>
    );
  }

  if (finished) {
    const mine = finished.scores.find((s) => s.peerId === state.myPeerId);
    return (
      <Panel tone="emerald">
        <p className="text-2xl">⛳ Hole complete</p>
        {mine && <p className="mt-2 font-mono text-4xl tabular-nums">{mine.strokes} strokes</p>}
        <p className="mt-2 text-xs text-neutral-500">Next hole coming up…</p>
      </Panel>
    );
  }

  if (!turn) {
    return (
      <Panel tone="neutral">
        <p className="text-sm text-neutral-400">Waiting for the host to start the round…</p>
      </Panel>
    );
  }

  if (!turn.yourTurn) {
    return (
      <Panel tone="neutral">
        {holeChip && <p className="mb-1 font-mono text-[10px] tracking-wider text-neutral-500">{holeChip}</p>}
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

  if (swingPhase === "aim") {
    return (
      <Panel tone="emerald">
        {holeChip && <p className="mb-1 font-mono text-[10px] tracking-wider text-neutral-500">{holeChip}</p>}
        <p className="mb-1 text-lg font-bold">Your turn — aim</p>
        <p className="font-mono text-sm text-amber-300">{turn.distToCup.toFixed(0)}m to the hole</p>
        <div className="my-3 grid w-full grid-cols-2 gap-2">
          {CLUB_ORDER.map((id) => (
            <button
              key={id}
              onClick={() => onClub(id)}
              className={`rounded-xl px-3 py-2 text-left font-mono text-xs ${
                club === id ? "bg-emerald-500 text-neutral-950" : "bg-neutral-800 text-neutral-300"
              }`}
            >
              <span className="font-bold">{CLUBS[id].label}</span>
              <span className={club === id ? "block text-neutral-800" : "block text-neutral-500"}>~{estimateMaxDistance(id)}m</span>
            </button>
          ))}
        </div>
        <p className="mb-3 text-center text-xs text-neutral-400">Rotate the phone to steer the arrow on the big screen.</p>
        <button
          onClick={onLockAim}
          className="h-16 w-full rounded-2xl bg-emerald-500 text-xl font-bold text-neutral-950 shadow-lg shadow-emerald-500/30 active:scale-95"
        >
          Lock aim 🎯
        </button>
      </Panel>
    );
  }

  // address / backswing: locked, meter live
  return (
    <Panel tone="violet">
      <p className="mb-1 font-mono text-[10px] tracking-wider text-neutral-500">
        {CLUBS[club].label} · ~{estimateMaxDistance(club)}m
      </p>
      <p className="text-lg font-bold">{swingPhase === "address" ? "🎯 Locked — raise the club" : "⬆ Charging…"}</p>
      <MeterBar meterRef={meterRef} />
      <p className="mt-2 text-center text-xs text-neutral-400">
        Raise back to charge, swing down through the ball to hit.
        <br />
        <b>Stop dead</b> right after impact for backspin.
      </p>
      <button onClick={onReAim} className="mt-3 rounded-lg bg-neutral-800 px-4 py-2 text-xs text-neutral-300 active:scale-95">
        ↩ Re-aim
      </button>
    </Panel>
  );
}

/** 60Hz meter → ref + rAF, no re-renders. */
function MeterBar({ meterRef }: { meterRef: RefObject<number> }) {
  const fill = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const m = Math.max(0, meterRef.current ?? 0);
      if (fill.current) fill.current.style.width = `${Math.round(m * 100)}%`;
      if (label.current) label.current.textContent = `${Math.round(m * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [meterRef]);
  return (
    <div className="mt-3 w-full">
      <div className="h-5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div ref={fill} className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-red-400" style={{ width: "0%" }} />
      </div>
      <div className="mt-1 text-center font-mono text-2xl tabular-nums">
        <span ref={label}>0%</span>
      </div>
    </div>
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
