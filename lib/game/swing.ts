export interface SwingSample {
  t: number; // ms, monotonic (performance.now())
  accG: [number, number, number] | null;
  rot: [number, number, number] | null; // deg/s: alpha (yaw), beta, gamma
}

export interface SwingResult {
  power: number; // 0..1
  faceDeg: number; // clubface offset, clamped ±FACE_MAX_DEG
}

/** Every constant a Checkpoint-F tuning session may touch, in one object.
 *  START_G arms the detector, PEAK_G maps to power 1.0. Units: m/s². */
export const SWING_TUNING = {
  START_G: 15,
  PEAK_G: 45,
  WINDOW_MS: 350, // max time between arming and firing
  COOLDOWN_MS: 1000,
  FACE_MAX_DEG: 10,
  FACE_SCALE: 0.05, // deg of face per (deg/s · s) of integrated yaw during the strike
};

/** Peak detector over |accG|: arm above START_G, track the peak, fire once on
 *  the falling edge (magnitude back under START_G) or when the window closes.
 *  Runs on the phone; the discrete result travels on the reliable channel. */
export function createSwingDetector(onSwing: (s: SwingResult) => void) {
  let armedAt: number | null = null;
  let peak = 0;
  let yawIntegral = 0; // deg
  let lastT: number | null = null;
  let cooldownUntil = -Infinity;

  function fire(t: number) {
    const { START_G, PEAK_G, FACE_MAX_DEG, FACE_SCALE, COOLDOWN_MS } = SWING_TUNING;
    const power = Math.max(0, Math.min(1, (peak - START_G) / (PEAK_G - START_G)));
    const faceDeg = Math.max(-FACE_MAX_DEG, Math.min(FACE_MAX_DEG, yawIntegral * FACE_SCALE));
    reset();
    cooldownUntil = t + COOLDOWN_MS;
    if (power > 0) onSwing({ power, faceDeg });
  }

  function reset() {
    armedAt = null;
    peak = 0;
    yawIntegral = 0;
  }

  return {
    feed(s: SwingSample) {
      const mag = s.accG ? Math.hypot(s.accG[0], s.accG[1], s.accG[2]) : 0;
      const dt = lastT != null ? (s.t - lastT) / 1000 : 0;
      lastT = s.t;
      if (s.t < cooldownUntil) return;

      if (armedAt === null) {
        if (mag >= SWING_TUNING.START_G) {
          armedAt = s.t;
          peak = mag;
          yawIntegral = 0;
        }
        return;
      }

      peak = Math.max(peak, mag);
      if (s.rot) yawIntegral += s.rot[0] * dt;

      const windowClosed = s.t - armedAt >= SWING_TUNING.WINDOW_MS;
      const fallingEdge = mag < SWING_TUNING.START_G;
      if (fallingEdge || windowClosed) fire(s.t);
    },
    reset() {
      reset();
      lastT = null;
      cooldownUntil = -Infinity;
    },
  };
}
