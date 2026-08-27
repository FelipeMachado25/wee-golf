export interface SwingSample {
  t: number; // ms, monotonic (performance.now())
  accG: [number, number, number] | null;
  rot: [number, number, number] | null; // deg/s: [alpha(z?), beta, gamma] — magnitude is what matters
}

export type WiiEvent =
  | { type: "address" } // club-down hold detected → aim locks, meter armed
  | { type: "meter"; power: number } // live backswing meter, 0..1
  | { type: "cancel" } // lowered gently without striking
  | { type: "swing"; power: number; faceDeg: number; backspin: number };

/** Wii-golf-style tuning. ADDRESS_Y_SIGN is the device-y sign of gravity when
 *  the phone hangs club-down (spec-compliant devices: -1; flip if address
 *  never arms during the on-device session). */
export const SWING_TUNING = {
  ADDRESS_Y_SIGN: -1,
  ADDRESS_MAX_DEG: 20, // within this of club-down counts as address
  ADDRESS_HOLD_MS: 250,
  BACKSWING_START_DEG: 30, // leaving address upward past this starts the meter
  BACKSWING_MAX_DEG: 150, // full-power top
  IMPACT_DEG: 30, // crossing back under this fires (if fast)
  MIN_DOWNSWING_RATE: 250, // deg/s |rot| somewhere in the downswing
  SPIN_WINDOW_MS: 150, // post-impact observation for the dead-stop
  SPIN_STOP_RATE: 120, // mean |rot| below this in the window → backspin
  FACE_SCALE: 0.05, // deg of face per integrated deg of long-axis twist
  FACE_MAX_DEG: 10,
  COOLDOWN_MS: 800,
  MIN_G: 4, // ignore samples in near-freefall — orientation is meaningless
};

type Phase = "idle" | "address" | "backswing" | "spin-watch";

/** Club-swing state machine: address (phone vertical, club-down) → backswing
 *  (raise = live power meter) → impact (fast pass through the bottom) →
 *  short post-impact window that turns a dead stop into backspin. */
export function createWiiSwing(onEvent: (e: WiiEvent) => void) {
  let phase: Phase = "idle";
  let addressSince: number | null = null;
  let topDeg = 0;
  let peakRate = 0;
  let faceIntegral = 0;
  let lastT: number | null = null;
  let cooldownUntil = -Infinity;
  // spin-watch accumulators — only the second half of the window counts:
  // right at impact the hand still carries downswing speed even in a stop.
  let spinStart = 0;
  let spinSum = 0;
  let spinN = 0;
  let firedPower = 0;
  let firedFace = 0;

  function thetaOf(accG: [number, number, number]): number | null {
    const g = Math.hypot(accG[0], accG[1], accG[2]);
    if (g < SWING_TUNING.MIN_G) return null;
    const c = Math.max(-1, Math.min(1, (SWING_TUNING.ADDRESS_Y_SIGN * accG[1]) / g));
    return (Math.acos(c) * 180) / Math.PI; // 0 = perfect club-down
  }

  function toIdle() {
    phase = "idle";
    addressSince = null;
    topDeg = 0;
    peakRate = 0;
    faceIntegral = 0;
  }

  return {
    feed(s: SwingSample) {
      const dt = lastT != null ? Math.max(0, (s.t - lastT) / 1000) : 0;
      lastT = s.t;
      if (s.t < cooldownUntil) return;

      const rate = s.rot ? Math.hypot(s.rot[0], s.rot[1], s.rot[2]) : 0;

      if (phase === "spin-watch") {
        if (s.t - spinStart >= SWING_TUNING.SPIN_WINDOW_MS / 2) {
          spinSum += rate;
          spinN += 1;
        }
        if (s.t - spinStart >= SWING_TUNING.SPIN_WINDOW_MS) {
          const mean = spinN ? spinSum / spinN : 0;
          const backspin = mean < SWING_TUNING.SPIN_STOP_RATE ? 1 : 0;
          cooldownUntil = s.t + SWING_TUNING.COOLDOWN_MS;
          toIdle();
          onEvent({ type: "swing", power: firedPower, faceDeg: firedFace, backspin });
        }
        return;
      }

      const theta = s.accG ? thetaOf(s.accG) : null;
      if (theta == null) return;

      if (phase === "idle") {
        if (theta <= SWING_TUNING.ADDRESS_MAX_DEG) {
          if (addressSince == null) addressSince = s.t;
          if (s.t - addressSince >= SWING_TUNING.ADDRESS_HOLD_MS) {
            phase = "address";
            onEvent({ type: "address" });
          }
        } else {
          addressSince = null;
        }
        return;
      }

      if (phase === "address") {
        if (theta >= SWING_TUNING.BACKSWING_START_DEG) {
          phase = "backswing";
          topDeg = theta;
          peakRate = 0;
          faceIntegral = 0;
        }
        return;
      }

      // backswing
      topDeg = Math.max(topDeg, theta);
      peakRate = Math.max(peakRate, rate);
      if (s.rot) faceIntegral += s.rot[2] * dt; // twist about the long axis
      onEvent({
        type: "meter",
        power: Math.max(0, Math.min(1, (topDeg - SWING_TUNING.BACKSWING_START_DEG) / (SWING_TUNING.BACKSWING_MAX_DEG - SWING_TUNING.BACKSWING_START_DEG))),
      });

      if (theta <= SWING_TUNING.IMPACT_DEG) {
        if (peakRate >= SWING_TUNING.MIN_DOWNSWING_RATE) {
          firedPower = Math.max(0.05, Math.min(1, (topDeg - SWING_TUNING.BACKSWING_START_DEG) / (SWING_TUNING.BACKSWING_MAX_DEG - SWING_TUNING.BACKSWING_START_DEG)));
          firedFace = Math.max(-SWING_TUNING.FACE_MAX_DEG, Math.min(SWING_TUNING.FACE_MAX_DEG, faceIntegral * SWING_TUNING.FACE_SCALE));
          phase = "spin-watch";
          spinStart = s.t;
          spinSum = 0;
          spinN = 0;
        } else {
          // came down slowly — not a strike
          toIdle();
          onEvent({ type: "cancel" });
        }
      }
    },

    reset() {
      toIdle();
      lastT = null;
      cooldownUntil = -Infinity;
    },
  };
}
