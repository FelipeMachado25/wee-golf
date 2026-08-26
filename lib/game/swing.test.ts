import { describe, it, expect } from "vitest";
import { createSwingDetector, SWING_TUNING, type SwingResult } from "./swing";

/** Synthetic accG magnitude pulse: gaussian peak over a resting-gravity baseline. */
function pulseTrace(peakG: number, yawRate = 0, durationMs = 300, stepMs = 16) {
  const samples: { t: number; accG: [number, number, number]; rot: [number, number, number] }[] = [];
  const center = durationMs / 2;
  for (let t = 0; t <= durationMs * 2; t += stepMs) {
    const mag = 9.81 + (peakG - 9.81) * Math.exp(-(((t - center) / (durationMs / 5)) ** 2));
    samples.push({ t, accG: [0, mag, 0], rot: [yawRate, 0, 0] });
  }
  return samples;
}

function feedAll(det: ReturnType<typeof createSwingDetector>, trace: ReturnType<typeof pulseTrace>) {
  for (const s of trace) det.feed(s);
}

describe("createSwingDetector", () => {
  it("fires exactly once on a clean pulse, with power in (0,1]", () => {
    const hits: SwingResult[] = [];
    const det = createSwingDetector((s) => hits.push(s));
    feedAll(det, pulseTrace(SWING_TUNING.PEAK_G));
    expect(hits).toHaveLength(1);
    expect(hits[0].power).toBeGreaterThan(0.9);
    expect(hits[0].power).toBeLessThanOrEqual(1);
  });

  it("scales power with peak strength", () => {
    const hits: SwingResult[] = [];
    const det = createSwingDetector((s) => hits.push(s));
    const midPeak = SWING_TUNING.START_G + (SWING_TUNING.PEAK_G - SWING_TUNING.START_G) / 2;
    feedAll(det, pulseTrace(midPeak));
    expect(hits).toHaveLength(1);
    expect(hits[0].power).toBeGreaterThan(0.3);
    expect(hits[0].power).toBeLessThan(0.7);
  });

  it("ignores sub-threshold jitter", () => {
    const hits: SwingResult[] = [];
    const det = createSwingDetector((s) => hits.push(s));
    feedAll(det, pulseTrace(SWING_TUNING.START_G - 2));
    expect(hits).toHaveLength(0);
  });

  it("two pulses inside the cooldown fire once", () => {
    const hits: SwingResult[] = [];
    const det = createSwingDetector((s) => hits.push(s));
    const first = pulseTrace(SWING_TUNING.PEAK_G);
    const shift = first[first.length - 1].t + 100; // 100ms later — inside cooldown
    const second = pulseTrace(SWING_TUNING.PEAK_G).map((s) => ({ ...s, t: s.t + shift }));
    feedAll(det, first);
    feedAll(det, second);
    expect(hits).toHaveLength(1);
  });

  it("fires again after the cooldown", () => {
    const hits: SwingResult[] = [];
    const det = createSwingDetector((s) => hits.push(s));
    const first = pulseTrace(SWING_TUNING.PEAK_G);
    const shift = first[first.length - 1].t + SWING_TUNING.COOLDOWN_MS + 200;
    const second = pulseTrace(SWING_TUNING.PEAK_G).map((s) => ({ ...s, t: s.t + shift }));
    feedAll(det, first);
    feedAll(det, second);
    expect(hits).toHaveLength(2);
  });

  it("clamps faceDeg to ±FACE_MAX_DEG", () => {
    const hits: SwingResult[] = [];
    const det = createSwingDetector((s) => hits.push(s));
    feedAll(det, pulseTrace(SWING_TUNING.PEAK_G, 900)); // absurd yaw rate
    expect(hits).toHaveLength(1);
    expect(Math.abs(hits[0].faceDeg)).toBeLessThanOrEqual(SWING_TUNING.FACE_MAX_DEG);
  });

  it("handles null sensor fields without firing or crashing", () => {
    const hits: SwingResult[] = [];
    const det = createSwingDetector((s) => hits.push(s));
    for (let t = 0; t < 500; t += 16) det.feed({ t, accG: null, rot: null });
    expect(hits).toHaveLength(0);
  });
});
