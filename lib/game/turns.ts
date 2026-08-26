export const STROKE_CAP = 8;

export interface PlayerScore {
  peerId: string;
  strokes: number;
  holed: boolean;
}

export interface TurnState {
  order: string[];
  current: string | null; // null ⇔ phase === "finished"
  phase: "aiming" | "ball-in-motion" | "finished";
  scores: PlayerScore[];
}

/** Classic round-robin turn keeper. Pure bookkeeping — no timers, no I/O.
 *  The host game loop drives it: strokeTaken when a swing lands, ballSettled
 *  when physics reports the outcome. */
export function createTurnMachine(peerIds: string[]) {
  const order: string[] = [...peerIds];
  const scores = new Map<string, PlayerScore>(order.map((id) => [id, { peerId: id, strokes: 0, holed: false }]));
  let current: string | null = order[0] ?? null;
  let phase: TurnState["phase"] = current ? "aiming" : "finished";

  const active = () => order.filter((id) => !scores.get(id)!.holed);

  function advance() {
    const remaining = active();
    if (remaining.length === 0) {
      current = null;
      phase = "finished";
      return;
    }
    const from = current ? order.indexOf(current) : -1;
    for (let i = 1; i <= order.length; i++) {
      const candidate = order[(from + i) % order.length];
      if (!scores.get(candidate)!.holed) {
        current = candidate;
        phase = "aiming";
        return;
      }
    }
  }

  return {
    state(): TurnState {
      return { order: [...order], current, phase, scores: order.map((id) => ({ ...scores.get(id)! })) };
    },

    strokeTaken(peerId: string) {
      if (phase !== "aiming" || peerId !== current) return;
      scores.get(peerId)!.strokes += 1;
      phase = "ball-in-motion";
    },

    ballSettled(result: "stopped" | "holed" | "oob") {
      if (phase !== "ball-in-motion" || !current) return;
      const score = scores.get(current)!;
      if (result === "holed") score.holed = true;
      if (result === "oob") score.strokes += 1; // penalty
      if (score.strokes >= STROKE_CAP && !score.holed) score.holed = true; // auto-pickup
      advance();
    },

    addPlayer(peerId: string) {
      if (scores.has(peerId)) return;
      order.push(peerId);
      scores.set(peerId, { peerId, strokes: 0, holed: false });
      if (phase === "finished") return; // joined after the hole ended: waits for next hole
      if (current === null) advance();
    },

    removePlayer(peerId: string) {
      const idx = order.indexOf(peerId);
      if (idx === -1) return;
      const wasCurrent = current === peerId;
      order.splice(idx, 1);
      scores.delete(peerId);
      if (order.length === 0) {
        current = null;
        phase = "finished";
        return;
      }
      if (wasCurrent) {
        current = order[idx % order.length] ?? null;
        advance0AtCurrent();
      }
    },
  };

  /** After a forfeit, land on the nearest non-holed player without charging a rotation. */
  function advance0AtCurrent() {
    const remaining = active();
    if (remaining.length === 0) {
      current = null;
      phase = "finished";
      return;
    }
    if (current && !scores.get(current)?.holed) {
      phase = "aiming";
      return;
    }
    advance();
  }
}
