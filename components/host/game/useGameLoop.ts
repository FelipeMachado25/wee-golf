"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { GameMessage, PeerId } from "@/lib/networking/partykit/protocol";
import type { HoleDef } from "@/lib/game/terrain";
import { launch, step, type BallState, type StrokeInput } from "@/lib/game/physics";
import { createTurnMachine, type TurnState } from "@/lib/game/turns";
import { relAngle, SWING_TUNING } from "@/lib/game/swing";
import { suggestClub, type ClubId } from "@/lib/game/clubs";
import type { Vec3 } from "@/lib/game/vec";

const DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 48; // tab hiccup guard: never simulate > 0.4s per frame
const NEXT_HOLE_DELAY_MS = 6000; // scorecard breathing room between holes

/** Host-side aim tuning (sign flips live here if the phone feels inverted). */
export const AIM_TUNING = { SIGN: -1, MAX_DEG: 70 };

export type GameRefs = {
  ball: RefObject<BallState | null>;
  rest: RefObject<Map<PeerId, Vec3>>;
  aimYawDeg: RefObject<number>;
  activePeer: RefObject<PeerId | null>;
  phase: RefObject<TurnState["phase"]>;
  /** Live Wii backswing meter of the active player, 0..1, -1 when not locked. */
  meter: RefObject<number>;
  /** Club the active player will hit with — drives the minimap range arc. */
  club: RefObject<ClubId>;
};

/** What HostClient pushes into the running game. */
export type GameBus = {
  handleGameMessage(from: PeerId, msg: GameMessage): void;
  feedMotion(from: PeerId, t: number, rotAlphaDegPerSec: number, accG: [number, number, number] | null): void;
  addPlayer(peerId: PeerId): void;
  removePlayer(peerId: PeerId): void;
};

export function useGameLoop(args: {
  holes: HoleDef[];
  initialPeers: PeerId[];
  sendGame: (peerId: PeerId, msg: GameMessage) => void;
  busRef: RefObject<GameBus | null>;
}) {
  const [turn, setTurn] = useState<TurnState>({ order: [], current: null, phase: "finished", scores: [] });
  const [lastStroke, setLastStroke] = useState<StrokeInput | null>(null);
  const [holeIndex, setHoleIndex] = useState(0);
  const [courseTotals, setCourseTotals] = useState<{ peerId: PeerId; strokes: number }[] | null>(null);

  const ball = useRef<BallState | null>(null);
  const rest = useRef<Map<PeerId, Vec3>>(new Map());
  const aimYawDeg = useRef(0);
  const activePeer = useRef<PeerId | null>(null);
  const phase = useRef<TurnState["phase"]>("finished");
  const meter = useRef(-1);
  const club = useRef<ClubId>("driver");
  const aimLocked = useRef(false);
  const lastAccG = useRef<Map<PeerId, [number, number, number]>>(new Map());
  const lockG0 = useRef<[number, number, number] | null>(null);
  const meterTopDeg = useRef(0);

  // Course state outside React: the sim loop and bus handlers read these.
  const holeRef = useRef<HoleDef>(args.holes[0]);
  const holeIdxRef = useRef(0);
  const totals = useRef<Map<PeerId, number>>(new Map());
  const machine = useRef<ReturnType<typeof createTurnMachine> | null>(null);
  const strokeOrigin = useRef<Vec3 | null>(null);
  const lastRotT = useRef<Map<PeerId, number>>(new Map());
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendGame = useRef(args.sendGame);
  sendGame.current = args.sendGame;
  const holes = useRef(args.holes);
  holes.current = args.holes;

  function bearingToCup(from: Vec3): number {
    const hole = holeRef.current;
    return (Math.atan2(hole.cup.x - from.x, hole.cup.z - from.z) * 180) / Math.PI;
  }

  function broadcast(msg: GameMessage) {
    for (const p of machine.current?.state().order ?? []) {
      if (p !== "DEBUG") sendGame.current(p, msg);
    }
  }

  function distToCupOf(peerId: PeerId): number {
    const hole = holeRef.current;
    const pos = rest.current.get(peerId) ?? hole.tee;
    return Math.hypot(pos.x - hole.cup.x, pos.z - hole.cup.z);
  }

  function publishTurn() {
    const s = machine.current!.state();
    phase.current = s.phase;
    activePeer.current = s.current;
    setTurn(s);
    aimLocked.current = false;
    lockG0.current = null;
    meter.current = -1;
    // Re-suggest the club for the new active player; their explicit pick
    // (a "club" message) overrides it until their stroke resolves.
    if (s.current) {
      const pos = rest.current.get(s.current) ?? holeRef.current.tee;
      club.current = suggestClub(distToCupOf(s.current), holeRef.current.surfaceAt(pos.x, pos.z));
    }
    for (const p of s.order) {
      if (p === "DEBUG") continue;
      sendGame.current(p, {
        kind: "turn",
        yourTurn: p === s.current && s.phase === "aiming",
        strokeIndex: s.scores.find((x) => x.peerId === p)?.strokes ?? 0,
        club: club.current,
        distToCup: distToCupOf(p),
      });
    }
    if (s.phase === "finished") {
      finishHole(s);
    } else if (s.current) {
      const pos = rest.current.get(s.current) ?? holeRef.current.tee;
      aimYawDeg.current = bearingToCup(pos);
    }
  }

  function finishHole(s: TurnState) {
    for (const sc of s.scores) {
      totals.current.set(sc.peerId, (totals.current.get(sc.peerId) ?? 0) + sc.strokes);
    }
    broadcast({ kind: "hole-finished", scores: s.scores });

    const isLast = holeIdxRef.current >= holes.current.length - 1;
    if (isLast) {
      const finalTotals = [...totals.current.entries()].map(([peerId, strokes]) => ({ peerId, strokes }));
      setCourseTotals(finalTotals);
      broadcast({ kind: "course-finished", totals: finalTotals });
      return;
    }
    advanceTimer.current = setTimeout(() => startHole(holeIdxRef.current + 1, s.order), NEXT_HOLE_DELAY_MS);
  }

  function startHole(index: number, players: PeerId[]) {
    holeIdxRef.current = index;
    holeRef.current = holes.current[index];
    setHoleIndex(index);
    ball.current = null;
    setLastStroke(null);
    rest.current = new Map(players.map((p) => [p, { ...holeRef.current.tee }]));
    machine.current = createTurnMachine(players);
    broadcast({ kind: "hole-start", index, total: holes.current.length, par: holeRef.current.par });
    publishTurn();
  }

  function takeStroke(peerId: PeerId, power: number, faceDeg: number, backspin = 0) {
    const m = machine.current;
    if (!m) return;
    const s = m.state();
    if (s.phase !== "aiming" || s.current !== peerId) return;
    const hole = holeRef.current;
    const from = rest.current.get(peerId) ?? hole.tee;
    strokeOrigin.current = { ...from };
    const input: StrokeInput = { power, aimDeg: aimYawDeg.current, faceDeg, backspin, club: club.current };
    ball.current = launch({ ...from, y: hole.height(from.x, from.z) }, input);
    setLastStroke(input);
    m.strokeTaken(peerId);
    phase.current = "ball-in-motion";
    setTurn(m.state());
  }

  function settle(b: BallState) {
    const m = machine.current!;
    const hole = holeRef.current;
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
        ball.current = step(holeRef.current, ball.current, DT);
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

  // Kick off hole 1 with the lobby's players.
  useEffect(() => {
    startHole(0, args.initialPeers);
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The bus HostClient talks through.
  useEffect(() => {
    args.busRef.current = {
      handleGameMessage(from, msg) {
        if (msg.kind === "swing") {
          takeStroke(from, msg.power, msg.faceDeg, msg.backspin);
        } else if (msg.kind === "aim-lock") {
          // Wii flow: the Lock tap freezes the arrow and sets the meter
          // reference to the phone's orientation at that instant.
          if (activePeer.current === from) {
            aimLocked.current = true;
            lockG0.current = lastAccG.current.get(from) ?? null;
            meterTopDeg.current = 0;
            meter.current = 0;
          }
        } else if (msg.kind === "club") {
          if (activePeer.current === from) club.current = msg.club;
        } else if (msg.kind === "aim-unlock") {
          if (activePeer.current === from) {
            aimLocked.current = false;
            lockG0.current = null;
            meter.current = -1;
          }
        }
      },
      feedMotion(from, t, rotAlpha, accG) {
        if (phase.current !== "aiming" || activePeer.current !== from) {
          lastRotT.current.set(from, t);
          return;
        }
        const prev = lastRotT.current.get(from);
        lastRotT.current.set(from, t);
        if (accG) lastAccG.current.set(from, accG);
        if (aimLocked.current) {
          // Mirror the Wii meter on the big screen: same relative-angle math
          // the phone runs, referenced to the orientation at the Lock tap.
          if (accG && lockG0.current) {
            const theta = relAngle(lockG0.current, accG);
            if (theta != null) {
              meterTopDeg.current = Math.max(meterTopDeg.current, theta);
              meter.current = Math.max(
                0,
                Math.min(
                  1,
                  (meterTopDeg.current - SWING_TUNING.BACKSWING_START_DEG) / (SWING_TUNING.BACKSWING_MAX_DEG - SWING_TUNING.BACKSWING_START_DEG),
                ),
              );
            }
          }
          return;
        }
        if (prev == null) return;
        const dt = Math.min(0.1, Math.max(0, (t - prev) / 1000));
        const next = aimYawDeg.current + AIM_TUNING.SIGN * rotAlpha * dt;
        const center = activePeer.current ? bearingToCup(rest.current.get(activePeer.current) ?? holeRef.current.tee) : 0;
        aimYawDeg.current = Math.max(center - AIM_TUNING.MAX_DEG, Math.min(center + AIM_TUNING.MAX_DEG, next));
      },
      addPlayer(peerId) {
        machine.current?.addPlayer(peerId);
        if (!rest.current.has(peerId)) rest.current.set(peerId, { ...holeRef.current.tee });
        // Late joiner needs the course context the others already have.
        sendGame.current(peerId, {
          kind: "hole-start",
          index: holeIdxRef.current,
          total: holes.current.length,
          par: holeRef.current.par,
        });
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

  const refs: GameRefs = { ball, rest, aimYawDeg, activePeer, phase, meter, club };
  return {
    turn,
    refs,
    lastStroke,
    holeIndex,
    courseTotals,
    hole: args.holes[holeIndex],
    /** Checkpoint-E instrument: absolute aim from the slider, then swing. */
    fireDebugStroke: (i: StrokeInput) => {
      const current = machine.current?.state().current;
      if (!current) return;
      aimYawDeg.current = i.aimDeg;
      takeStroke(current, i.power, i.faceDeg, i.backspin ?? 0);
    },
  };
}
