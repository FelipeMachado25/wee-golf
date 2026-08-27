"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { GameMessage, PeerId } from "@/lib/networking/partykit/protocol";
import { HOLE_ONE, type HoleDef } from "@/lib/game/terrain";
import { launch, step, type BallState, type StrokeInput } from "@/lib/game/physics";
import { createTurnMachine, type TurnState } from "@/lib/game/turns";
import type { Vec3 } from "@/lib/game/vec";

const DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 48; // tab hiccup guard: never simulate > 0.4s per frame

/** Host-side aim tuning (sign flips live here if the phone feels inverted). */
export const AIM_TUNING = { SIGN: -1, MAX_DEG: 70 };

export type GameRefs = {
  ball: RefObject<BallState | null>;
  rest: RefObject<Map<PeerId, Vec3>>;
  aimYawDeg: RefObject<number>;
  activePeer: RefObject<PeerId | null>;
  phase: RefObject<TurnState["phase"]>;
};

/** What HostClient pushes into the running game. */
export type GameBus = {
  handleGameMessage(from: PeerId, msg: GameMessage): void;
  feedRot(from: PeerId, t: number, rotAlphaDegPerSec: number): void;
  addPlayer(peerId: PeerId): void;
  removePlayer(peerId: PeerId): void;
};

export function useGameLoop(args: {
  hole?: HoleDef;
  initialPeers: PeerId[];
  sendGame: (peerId: PeerId, msg: GameMessage) => void;
  busRef: RefObject<GameBus | null>;
}) {
  const hole = args.hole ?? HOLE_ONE;
  const [turn, setTurn] = useState<TurnState>({ order: [], current: null, phase: "finished", scores: [] });
  const [lastStroke, setLastStroke] = useState<StrokeInput | null>(null);

  const ball = useRef<BallState | null>(null);
  const rest = useRef<Map<PeerId, Vec3>>(new Map());
  const aimYawDeg = useRef(0);
  const activePeer = useRef<PeerId | null>(null);
  const phase = useRef<TurnState["phase"]>("finished");

  // Everything below lives outside React state — the loop mutates refs and
  // only discrete turn transitions call setTurn.
  const machine = useRef<ReturnType<typeof createTurnMachine> | null>(null);
  const strokeOrigin = useRef<Vec3 | null>(null);
  const lastRotT = useRef<Map<PeerId, number>>(new Map());
  const sendGame = useRef(args.sendGame);
  sendGame.current = args.sendGame;

  function bearingToCup(from: Vec3): number {
    return (Math.atan2(hole.cup.x - from.x, hole.cup.z - from.z) * 180) / Math.PI;
  }

  function publishTurn() {
    const s = machine.current!.state();
    phase.current = s.phase;
    activePeer.current = s.current;
    setTurn(s);
    for (const p of s.order) {
      if (p === "DEBUG") continue;
      sendGame.current(p, {
        kind: "turn",
        yourTurn: p === s.current && s.phase === "aiming",
        strokeIndex: s.scores.find((x) => x.peerId === p)?.strokes ?? 0,
      });
    }
    if (s.phase === "finished") {
      for (const p of s.order) if (p !== "DEBUG") sendGame.current(p, { kind: "hole-finished", scores: s.scores });
    } else if (s.current) {
      const pos = rest.current.get(s.current) ?? hole.tee;
      aimYawDeg.current = bearingToCup(pos);
    }
  }

  function takeStroke(peerId: PeerId, power: number, faceDeg: number) {
    const m = machine.current;
    if (!m) return;
    const s = m.state();
    if (s.phase !== "aiming" || s.current !== peerId) return;
    const from = rest.current.get(peerId) ?? hole.tee;
    strokeOrigin.current = { ...from };
    const input: StrokeInput = { power, aimDeg: aimYawDeg.current, faceDeg };
    ball.current = launch({ ...from, y: hole.height(from.x, from.z) }, input);
    setLastStroke(input);
    m.strokeTaken(peerId);
    phase.current = "ball-in-motion";
    setTurn(m.state());
  }

  function settle(b: BallState) {
    const m = machine.current!;
    const player = m.state().current!;
    let outcome: "stopped" | "holed" | "oob";
    if (b.phase === "holed") {
      outcome = "holed";
      rest.current.delete(player);
    } else if (hole.surfaceAt(b.pos.x, b.pos.z) === "oob") {
      outcome = "oob";
      rest.current.set(player, strokeOrigin.current ?? hole.tee); // replay from origin
    } else {
      outcome = "stopped";
      rest.current.set(player, { ...b.pos });
    }
    const distToCup = Math.hypot(b.pos.x - hole.cup.x, b.pos.z - hole.cup.z);
    if (player !== "DEBUG") sendGame.current(player, { kind: "stroke-result", outcome, distToCup });
    ball.current = null;
    m.ballSettled(outcome);
    publishTurn();
  }

  // Fixed-step simulation on rAF with an accumulator.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      acc += (now - last) / 1000;
      last = now;
      if (document.visibilityState === "hidden") acc = 0; // pause, don't explode
      let steps = 0;
      while (ball.current && acc >= DT && steps < MAX_STEPS_PER_FRAME) {
        ball.current = step(hole, ball.current, DT);
        acc -= DT;
        steps += 1;
        const b = ball.current;
        if (b.phase === "stopped" || b.phase === "holed") {
          settle(b);
          break;
        }
      }
      if (!ball.current) acc = 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the machine once with the lobby's players.
  useEffect(() => {
    machine.current = createTurnMachine(args.initialPeers);
    for (const p of args.initialPeers) rest.current.set(p, { ...hole.tee });
    publishTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The bus HostClient talks through.
  useEffect(() => {
    args.busRef.current = {
      handleGameMessage(from, msg) {
        if (msg.kind === "swing") takeStroke(from, msg.power, msg.faceDeg);
        // "aim-lock" is informational for now: the host's integrator is the
        // single source of truth for the arrow. Future: freeze aim on lock.
      },
      feedRot(from, t, rotAlpha) {
        if (phase.current !== "aiming" || activePeer.current !== from) {
          lastRotT.current.set(from, t);
          return;
        }
        const prev = lastRotT.current.get(from);
        lastRotT.current.set(from, t);
        if (prev == null) return;
        const dt = Math.min(0.1, Math.max(0, (t - prev) / 1000));
        const next = aimYawDeg.current + AIM_TUNING.SIGN * rotAlpha * dt;
        const center = activePeer.current ? bearingToCup(rest.current.get(activePeer.current) ?? hole.tee) : 0;
        aimYawDeg.current = Math.max(center - AIM_TUNING.MAX_DEG, Math.min(center + AIM_TUNING.MAX_DEG, next));
      },
      addPlayer(peerId) {
        machine.current?.addPlayer(peerId);
        if (!rest.current.has(peerId)) rest.current.set(peerId, { ...hole.tee });
        publishTurn();
      },
      removePlayer(peerId) {
        machine.current?.removePlayer(peerId);
        rest.current.delete(peerId);
        publishTurn();
      },
    };
    return () => {
      args.busRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refs: GameRefs = { ball, rest, aimYawDeg, activePeer, phase };
  return {
    turn,
    refs,
    lastStroke,
    /** Checkpoint-E instrument: absolute aim from the slider, then swing. */
    fireDebugStroke: (i: StrokeInput) => {
      const current = machine.current?.state().current;
      if (!current) return;
      aimYawDeg.current = i.aimDeg;
      takeStroke(current, i.power, i.faceDeg);
    },
  };
}
