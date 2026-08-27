import { describe, it, expect } from "vitest";
import { HOLE_ONE } from "./terrain";
import { PHYS, launch, step, type BallState, type StrokeInput } from "./physics";
import { len } from "./vec";

const DT = 1 / 120;

/** Run a stroke to rest (or timeout). Returns final state and sim seconds. */
function playStroke(input: StrokeInput, maxSeconds = 60) {
  let b = launch(HOLE_ONE.tee, input);
  let t = 0;
  while (b.phase !== "stopped" && b.phase !== "holed" && t < maxSeconds) {
    b = step(HOLE_ONE, b, DT);
    t += DT;
  }
  return { b, t };
}

describe("launch", () => {
  it("full power leaves at V_MAX with upward loft", () => {
    const b = launch(HOLE_ONE.tee, { power: 1, aimDeg: 0, faceDeg: 0 });
    expect(len(b.vel)).toBeCloseTo(PHYS.V_MAX, 5);
    expect(b.vel.y).toBeGreaterThan(0);
    expect(b.phase).toBe("flying");
  });

  it("aim 0 flies toward +z", () => {
    const b = launch(HOLE_ONE.tee, { power: 0.8, aimDeg: 0, faceDeg: 0 });
    expect(b.vel.z).toBeGreaterThan(0);
    expect(Math.abs(b.vel.x)).toBeLessThan(1e-9);
  });
});

describe("step", () => {
  it("every stroke settles within 60 simulated seconds", () => {
    for (const power of [0.15, 0.4, 0.7, 1]) {
      for (const aimDeg of [-15, 0, 20]) {
        const { b, t } = playStroke({ power, aimDeg, faceDeg: 0 });
        expect(t, `power=${power} aim=${aimDeg}`).toBeLessThan(60);
        expect(["stopped", "holed"]).toContain(b.phase);
      }
    }
  });

  it("a full-power straight stroke travels a real distance but stays in the world", () => {
    const { b } = playStroke({ power: 1, aimDeg: 0, faceDeg: 0 });
    expect(b.pos.z).toBeGreaterThan(40);
    expect(b.pos.z).toBeLessThan(HOLE_ONE.bounds.l + 20);
  });

  it("sidespin curves the shot in flight — measured at first ground contact", () => {
    // Rest position is the wrong probe: the fairway is a valley and funnels
    // everything back to center while rolling. The landing point is honest.
    const land = (faceDeg: number) => {
      let b = launch(HOLE_ONE.tee, { power: 0.8, aimDeg: 0, faceDeg });
      while (b.phase === "flying") b = step(HOLE_ONE, b, DT);
      return b.pos.x;
    };
    const straight = land(0);
    const faded = land(10);
    expect(faded - straight).toBeGreaterThan(0.5); // positive face → right
  });

  it("mechanical energy never increases while rolling", () => {
    let b = launch(HOLE_ONE.tee, { power: 0.3, aimDeg: 0, faceDeg: 0 });
    // run until rolling starts
    let guard = 0;
    while (b.phase !== "rolling" && guard++ < 120_000) b = step(HOLE_ONE, b, DT);
    expect(b.phase).toBe("rolling");
    let prev = energy(b);
    while (b.phase === "rolling") {
      b = step(HOLE_ONE, b, DT);
      const e = energy(b);
      expect(e).toBeLessThanOrEqual(prev + 1e-6);
      prev = e;
    }
  });

  it("a slow roll into the cup holes out", () => {
    const b: BallState = {
      pos: { x: HOLE_ONE.cup.x, y: HOLE_ONE.height(HOLE_ONE.cup.x, HOLE_ONE.cup.z - 1.2), z: HOLE_ONE.cup.z - 1.2 },
      vel: { x: 0, y: 0, z: 1.4 }, // realistic putt pace for 1.2m on a green
      spin: { x: 0, y: 0, z: 0 },
      phase: "rolling",
    };
    let s = b;
    let guard = 0;
    while (s.phase === "rolling" && guard++ < 60_000) s = step(HOLE_ONE, s, DT);
    expect(s.phase).toBe("holed");
  });

  it("a fast roll across the cup lips out", () => {
    const b: BallState = {
      pos: { x: HOLE_ONE.cup.x, y: HOLE_ONE.height(HOLE_ONE.cup.x, HOLE_ONE.cup.z - 1.2), z: HOLE_ONE.cup.z - 1.2 },
      vel: { x: 0, y: 0, z: 6 },
      spin: { x: 0, y: 0, z: 0 },
      phase: "rolling",
    };
    let s = b;
    let passed = false;
    let guard = 0;
    while (s.phase === "rolling" && guard++ < 60_000) {
      s = step(HOLE_ONE, s, DT);
      if (s.pos.z > HOLE_ONE.cup.z + 0.5) passed = true;
    }
    expect(passed).toBe(true);
  });

  it("backspin lifts the flight and bites on landing", () => {
    const flat = playStroke({ power: 0.7, aimDeg: 0, faceDeg: 0, backspin: 0 }).b;
    const spun = playStroke({ power: 0.7, aimDeg: 0, faceDeg: 0, backspin: 1 }).b;
    // bites: comes to rest meaningfully shorter than the flat shot
    expect(spun.pos.z).toBeLessThan(flat.pos.z - 2);

    // lifts: apex of the spun flight is higher
    const apex = (backspin: number) => {
      let b = launch(HOLE_ONE.tee, { power: 0.7, aimDeg: 0, faceDeg: 0, backspin });
      let top = 0;
      while (b.phase === "flying") {
        b = step(HOLE_ONE, b, DT);
        top = Math.max(top, b.pos.y);
      }
      return top;
    };
    expect(apex(1)).toBeGreaterThan(apex(0) + 0.25);
  });

  it("the ball never rests below the terrain", () => {
    const { b } = playStroke({ power: 0.9, aimDeg: 5, faceDeg: -5 });
    if (b.phase === "stopped") {
      expect(b.pos.y).toBeGreaterThanOrEqual(HOLE_ONE.height(b.pos.x, b.pos.z) - 1e-3);
    }
  });
});

function energy(b: BallState): number {
  return 0.5 * len(b.vel) ** 2 + PHYS.G * b.pos.y;
}
