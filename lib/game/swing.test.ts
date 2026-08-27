import { describe, it, expect } from "vitest";
import { createWiiSwing, SWING_TUNING, type WiiEvent } from "./swing";

/** Synthetic trace in device coordinates. The lock reference is whatever
 *  orientation the phone has when arm() runs — here g0 = (0,-g,0); raising
 *  rotates gravity toward +z by θ. */
function seg(samples: { t: number; accG: [number, number, number]; rot: [number, number, number] }[], fromMs: number, toMs: number, thetaFrom: number, thetaTo: number, rotRate = 0, faceRate = 0, stepMs = 16) {
  const g = 9.81;
  for (let t = fromMs; t < toMs; t += stepMs) {
    const k = (t - fromMs) / Math.max(1, toMs - fromMs);
    const theta = ((thetaFrom + (thetaTo - thetaFrom) * k) * Math.PI) / 180;
    samples.push({ t, accG: [0, -g * Math.cos(theta), g * Math.sin(theta)], rot: [rotRate, 0, faceRate] });
  }
  return samples;
}

function fullSwing({ topDeg = 110, downswingRate = 500, followThrough = true, faceRate = 0 } = {}) {
  const s: Parameters<typeof seg>[0] = [];
  seg(s, 0, 200, 0, 0); // holding at the lock pose
  seg(s, 200, 800, 0, topDeg, 120); // backswing up
  seg(s, 800, 1050, topDeg, 2, downswingRate, faceRate); // downswing through impact
  if (followThrough) seg(s, 1050, 1400, 2, 100, downswingRate * 0.7); // keep swinging
  else seg(s, 1050, 1400, 2, 5, 10); // dead stop → backspin
  return s;
}

function run(trace: Parameters<typeof seg>[0], { arm = true } = {}) {
  const events: WiiEvent[] = [];
  const det = createWiiSwing((e) => events.push(e));
  if (arm) det.arm();
  for (const x of trace) det.feed(x);
  return events;
}

describe("createWiiSwing", () => {
  it("emits address right after arming with a usable gravity sample", () => {
    const events = run(fullSwing());
    expect(events[0]?.type).toBe("address");
  });

  it("streams a rising meter during the backswing", () => {
    const meters = run(fullSwing()).filter((e) => e.type === "meter") as Extract<WiiEvent, { type: "meter" }>[];
    expect(meters.length).toBeGreaterThan(5);
    expect(meters[meters.length - 1].power).toBeGreaterThan(meters[0].power);
  });

  it("fires one swing with power scaled to the backswing top", () => {
    const high = run(fullSwing({ topDeg: SWING_TUNING.BACKSWING_MAX_DEG })).filter((e) => e.type === "swing");
    const low = run(fullSwing({ topDeg: 60 })).filter((e) => e.type === "swing");
    expect(high).toHaveLength(1);
    expect(low).toHaveLength(1);
    const hp = (high[0] as Extract<WiiEvent, { type: "swing" }>).power;
    const lp = (low[0] as Extract<WiiEvent, { type: "swing" }>).power;
    expect(hp).toBeGreaterThan(0.9);
    expect(lp).toBeGreaterThan(0.2);
    expect(lp).toBeLessThan(hp);
  });

  it("a dead stop after impact produces backspin; follow-through does not", () => {
    const stop = run(fullSwing({ followThrough: false })).find((e) => e.type === "swing") as Extract<WiiEvent, { type: "swing" }>;
    const through = run(fullSwing({ followThrough: true })).find((e) => e.type === "swing") as Extract<WiiEvent, { type: "swing" }>;
    expect(stop.backspin).toBe(1);
    expect(through.backspin).toBe(0);
  });

  it("does nothing without arm() — the Lock button is the only entry", () => {
    expect(run(fullSwing(), { arm: false })).toHaveLength(0);
  });

  it("a slow lowering cancels back to address (still locked) and can retry", () => {
    const s: Parameters<typeof seg>[0] = [];
    seg(s, 0, 200, 0, 0);
    seg(s, 200, 800, 0, 90, 100);
    seg(s, 800, 2300, 90, 2, 25); // gentle lower, no strike speed
    seg(s, 2300, 2900, 2, 100, 130); // raise again…
    seg(s, 2900, 3150, 100, 2, 500); // …and strike for real
    seg(s, 3150, 3500, 2, 80, 350); // follow-through feeds the spin window
    const events = run(s);
    expect(events.some((e) => e.type === "cancel")).toBe(true);
    expect(events.filter((e) => e.type === "swing")).toHaveLength(1);
  });

  it("fires on a swing-through whose bottom never reaches the strict impact cone", () => {
    // Real swings drift off-plane: raise to 100°, bottom out at 35° (>IMPACT_DEG)
    // and follow through up the other side. Passing the bottom must count.
    const s: Parameters<typeof seg>[0] = [];
    seg(s, 0, 200, 0, 0);
    seg(s, 200, 800, 0, 100, 120); // backswing
    seg(s, 800, 1000, 100, 35, 500); // down…
    seg(s, 1000, 1400, 35, 95, 450); // …through the bottom and up the far side
    const swings = run(s).filter((e) => e.type === "swing");
    expect(swings).toHaveLength(1);
    expect((swings[0] as Extract<WiiEvent, { type: "swing" }>).power).toBeGreaterThan(0.5);
  });

  it("clamps faceDeg to ±FACE_MAX_DEG", () => {
    const swing = run(fullSwing({ faceRate: 2000 })).find((e) => e.type === "swing") as Extract<WiiEvent, { type: "swing" }>;
    expect(Math.abs(swing.faceDeg)).toBeLessThanOrEqual(SWING_TUNING.FACE_MAX_DEG);
  });

  it("survives null sensor fields quietly", () => {
    const events: WiiEvent[] = [];
    const det = createWiiSwing((e) => events.push(e));
    det.arm();
    for (let t = 0; t < 500; t += 16) det.feed({ t, accG: null, rot: null });
    expect(events).toHaveLength(0);
  });
});
