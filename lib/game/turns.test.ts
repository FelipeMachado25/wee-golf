import { describe, it, expect } from "vitest";
import { createTurnMachine, STROKE_CAP } from "./turns";

describe("createTurnMachine", () => {
  it("starts with the first player aiming", () => {
    const m = createTurnMachine(["a", "b"]);
    expect(m.state().current).toBe("a");
    expect(m.state().phase).toBe("aiming");
  });

  it("a stroke moves to ball-in-motion, settling rotates round-robin", () => {
    const m = createTurnMachine(["a", "b", "c"]);
    m.strokeTaken("a");
    expect(m.state().phase).toBe("ball-in-motion");
    m.ballSettled("stopped");
    expect(m.state().current).toBe("b");
    expect(m.state().phase).toBe("aiming");
    m.strokeTaken("b");
    m.ballSettled("stopped");
    expect(m.state().current).toBe("c");
  });

  it("counts strokes per player", () => {
    const m = createTurnMachine(["a", "b"]);
    m.strokeTaken("a");
    m.ballSettled("stopped");
    expect(m.state().scores.find((s) => s.peerId === "a")!.strokes).toBe(1);
    expect(m.state().scores.find((s) => s.peerId === "b")!.strokes).toBe(0);
  });

  it("oob adds a penalty stroke", () => {
    const m = createTurnMachine(["a"]);
    m.strokeTaken("a");
    m.ballSettled("oob");
    expect(m.state().scores[0].strokes).toBe(2); // stroke + penalty
  });

  it("holed players are skipped in rotation", () => {
    const m = createTurnMachine(["a", "b"]);
    m.strokeTaken("a");
    m.ballSettled("holed");
    expect(m.state().scores.find((s) => s.peerId === "a")!.holed).toBe(true);
    expect(m.state().current).toBe("b");
    m.strokeTaken("b");
    m.ballSettled("stopped");
    expect(m.state().current).toBe("b"); // only b remains
  });

  it("finishes when everyone holes out", () => {
    const m = createTurnMachine(["a", "b"]);
    m.strokeTaken("a");
    m.ballSettled("holed");
    m.strokeTaken("b");
    m.ballSettled("holed");
    expect(m.state().phase).toBe("finished");
    expect(m.state().current).toBeNull();
  });

  it("caps strokes and auto-picks-up", () => {
    const m = createTurnMachine(["a"]);
    for (let i = 0; i < STROKE_CAP; i++) {
      m.strokeTaken("a");
      m.ballSettled("stopped");
    }
    expect(m.state().phase).toBe("finished");
    expect(m.state().scores[0].strokes).toBe(STROKE_CAP);
  });

  it("mid-hole joiners queue at the end of the order", () => {
    const m = createTurnMachine(["a"]);
    m.addPlayer("b");
    expect(m.state().order).toEqual(["a", "b"]);
    m.strokeTaken("a");
    m.ballSettled("stopped");
    expect(m.state().current).toBe("b");
  });

  it("a leaving player forfeits, including mid-turn", () => {
    const m = createTurnMachine(["a", "b"]);
    m.removePlayer("a");
    expect(m.state().current).toBe("b");
    m.removePlayer("b");
    expect(m.state().phase).toBe("finished");
  });

  it("ignores strokes from the wrong player", () => {
    const m = createTurnMachine(["a", "b"]);
    m.strokeTaken("b");
    expect(m.state().phase).toBe("aiming");
    expect(m.state().current).toBe("a");
  });
});
