"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { GameMessage } from "@/lib/networking/partykit/protocol";

export type SwingPhase = "aim" | "address" | "backswing";

export type PadState = {
  turn: { yourTurn: boolean; strokeIndex: number } | null;
  swingPhase: SwingPhase;
  swung: boolean;
  result: Extract<GameMessage, { kind: "stroke-result" }> | null;
  finished: Extract<GameMessage, { kind: "hole-finished" }> | null;
  myPeerId: string;
};

/** The phone-as-club surface, Wii Golf style: rotate to aim → hold the phone
 *  hanging club-down to lock → raise to charge the meter → swing through.
 *  Pure presentation — detection lives in ControllerClient, physics on host. */
export function GamePad({
  state,
  meterRef,
  gyRef,
}: {
  state: PadState;
  meterRef: RefObject<number>;
  gyRef: RefObject<number>;
}) {
  const { turn, swingPhase, swung, result, finished } = state;

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

  if (swingPhase === "aim") {
    return (
      <Panel tone="emerald">
        <p className="mb-1 text-lg font-bold">Your turn — aim</p>
        <p className="mb-2 text-center text-sm text-neutral-300">
          Rotate the phone left/right — watch the arrow on the big screen.
        </p>
        <p className="text-center text-sm text-emerald-300">
          When ready, hold the phone <b>hanging straight down</b> like a golf club to lock.
        </p>
        <GyDebug gyRef={gyRef} />
      </Panel>
    );
  }

  if (swingPhase === "address") {
    return (
      <Panel tone="violet">
        <p className="text-lg font-bold">🎯 Locked — address</p>
        <p className="mt-2 text-center text-sm text-neutral-300">Raise the club back to charge your shot.</p>
        <GyDebug gyRef={gyRef} />
      </Panel>
    );
  }

  // backswing: live meter
  return (
    <Panel tone="violet">
      <p className="text-lg font-bold">⬆ Charging…</p>
      <MeterBar meterRef={meterRef} />
      <p className="mt-2 text-center text-xs text-neutral-400">
        Swing down through the ball to hit.
        <br />
        <b>Stop dead</b> right after impact for backspin.
      </p>
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

/** Tuning aid: live gravity-y readout so a wrong ADDRESS_Y_SIGN takes one
 *  message to diagnose ("what number do you see holding it like a club?"). */
function GyDebug({ gyRef }: { gyRef: RefObject<number> }) {
  const [gy, setGy] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setGy(gyRef.current ?? 0), 250);
    return () => clearInterval(id);
  }, [gyRef]);
  return <p className="mt-2 font-mono text-[10px] text-neutral-600">gy {gy.toFixed(1)}</p>;
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
