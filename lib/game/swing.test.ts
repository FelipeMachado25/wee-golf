import { describe, it, expect } from "vitest";
import { createWiiSwing, SWING_TUNING, type WiiEvent } from "./swing";

/** Build a synthetic trace of the club-swing cycle in device coordinates.
 *  θ = angle of the phone's long axis from club-down vertical:
 *  accG.y = ADDRESS_Y_SIGN * g·cosθ, accG.z = g·sinθ (screen sideways).
 *  rotRate: deg/s magnitude fed on the z axis (swing-plane rotation). */
function seg(samples: { t: number; accG: [number, number, number]; rot: [number, number, number] }[], fromMs: number, toMs: number, thetaFrom: number, thetaTo: number, rotRate = 0, faceRate = 0, stepMs = 16) {
  const g = 9.81;
  for (let t = fromMs; t < toMs; t += stepMs) {
    const k = (t - fromMs) / Math.max(1, toMs - fromMs);
    const theta = ((thetaFrom + (thetaTo - thetaFrom) * k) * Math.PI) / 180;
    samples.push({
      t,
      accG: [0, SWING_TUNING.ADDRESS_Y_SIGN * g * Math.cos(theta), g * Math.sin(theta)],
      rot: [rotRate, 0, faceRate],
    });
  }
  return samples;
}

function fullSwing({ topDeg = 120, downswingRate = 600, followThrough = true, faceRate = 0 } = {}) {
  const s: Parameters<typeof seg>[0] = [];
  seg(s, 0, 400, 5, 5); // address hold, club down
  seg(s, 400, 1000, 5, topDeg, 120); // backswing up
  seg(s, 1000, 1250, topDeg, 5, downswingRate, faceRate); // downswing through impact
  if (followThrough) seg(s, 1250, 1600, 5, 100, downswingRate * 0.7); // keep swinging
  else seg(s, 1250, 1600, 5, 8, 10); // dead stop → backspin
  return s;
}

function run(trace: Parameters<typeof seg>[0]) {
  const events: WiiEvent[] = [];
  const det = createWiiSwing((e) => events.push(e));
  for (const x of trace) det.feed(x);
  return events;
}

describe("createWiiSwing", () => {
  it("emits address after a steady club-down hold", () => {
    const events = run(fullSwing());
    expect(events.some((e) => e.type === "address")).toBe(true);
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
    expect(stop.backspin).toBeGreaterThan(0.5);
    expect(through.backspin).toBeLessThan(0.3);
  });

  it("does not fire without an address hold first", () => {
    const s: Parameters<typeof seg>[0] = [];
    seg(s, 0, 600, 90, 20, 500); // waving the phone around, never club-down hold
    expect(run(s).filter((e) => e.type === "swing")).toHaveLength(0);
  });

  it("a slow lowering back to address cancels instead of firing", () => {
    const s: Parameters<typeof seg>[0] = [];
    seg(s, 0, 400, 5, 5);
    seg(s, 400, 1000, 5, 90, 100);
    seg(s, 1000, 2500, 90, 5, 25); // gentle lower, no strike speed
    const events = run(s);
    expect(events.filter((e) => e.type === "swing")).toHaveLength(0);
    expect(events.some((e) => e.type === "cancel")).toBe(true);
  });

  it("clamps faceDeg to ±FACE_MAX_DEG", () => {
    const swing = run(fullSwing({ faceRate: 2000 })).find((e) => e.type === "swing") as Extract<WiiEvent, { type: "swing" }>;
    expect(Math.abs(swing.faceDeg)).toBeLessThanOrEqual(SWING_TUNING.FACE_MAX_DEG);
  });

  it("survives null sensor fields quietly", () => {
    const events: WiiEvent[] = [];
    const det = createWiiSwing((e) => events.push(e));
    for (let t = 0; t < 500; t += 16) det.feed({ t, accG: null, rot: null });
    expect(events).toHaveLength(0);
  });
});
