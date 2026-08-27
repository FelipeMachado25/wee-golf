export interface SwingSample {
  t: number; // ms, monotonic (performance.now())
  accG: [number, number, number] | null;
  rot: [number, number, number] | null; // deg/s
}

export type WiiEvent =
  | { type: "address" } // armed and reference captured — meter live
  | { type: "meter"; power: number } // live backswing meter, 0..1
  | { type: "cancel" } // lowered gently without striking — still locked, meter reset
  | { type: "swing"; power: number; faceDeg: number; backspin: number };

/** Wii-golf tuning. Everything is measured RELATIVE to the phone's orientation
 *  at the moment the player taps Lock — no pose or axis-sign assumptions. */
export const SWING_TUNING = {
  BACKSWING_START_DEG: 20, // rotating past this from the lock pose starts the meter
  BACKSWING_MAX_DEG: 120, // full-power top (generous — a natural raise reaches it)
  IMPACT_DEG: 25, // direct hit: swinging back within this of the lock pose
  IMPACT_PASS_MAX_DEG: 50, // swing-through: bottoming out under this also counts…
  PASS_HYSTERESIS_DEG: 8, // …once the angle rises again by this much (passed bottom)
  MIN_DOWNSWING_RATE: 180, // deg/s |rot| somewhere in the swing to count as a strike
  SPIN_WINDOW_MS: 150, // post-impact observation for the dead-stop
  SPIN_STOP_RATE: 120, // mean |rot| below this in the window's 2nd half → backspin
  FACE_SCALE: 0.05, // deg of face per integrated deg of long-axis twist
  FACE_MAX_DEG: 10,
  COOLDOWN_MS: 800,
  MIN_G: 4, // ignore near-freefall samples — orientation is meaningless
};

type Phase = "idle" | "arming" | "address" | "backswing" | "spin-watch";

/** Angle in degrees between the current gravity vector and the reference one.
 *  Exported so the host HUD can mirror the meter from the telemetry stream. */
export function relAngle(g0: [number, number, number], g: [number, number, number]): number | null {
  const m0 = Math.hypot(...g0);
  const m = Math.hypot(...g);
  if (m < SWING_TUNING.MIN_G || m0 < SWING_TUNING.MIN_G) return null;
  const c = Math.max(-1, Math.min(1, (g0[0] * g[0] + g0[1] * g[1] + g0[2] * g[2]) / (m0 * m)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Button-armed Wii swing: `arm()` on the Lock tap captures the current
 *  orientation as the club-at-the-ball reference; raising rotates away from it
 *  (live meter), swinging back through it with speed fires, and a dead stop
 *  right after impact turns into backspin. */
export function createWiiSwing(onEvent: (e: WiiEvent) => void) {
  let phase: Phase = "idle";
  let g0: [number, number, number] | null = null;
  let topDeg = 0;
  let minTheta = Infinity; // lowest angle seen after the top — the swing's bottom
  let peakRate = 0;
  let faceIntegral = 0;
  let lastT: number | null = null;
  let cooldownUntil = -Infinity;
  // spin-watch — only the window's second half counts: right at impact the
  // hand still carries downswing speed even in a deliberate stop.
  let spinStart = 0;
  let spinSum = 0;
  let spinN = 0;
  let firedPower = 0;
  let firedFace = 0;

  const meterOf = (deg: number) =>
    Math.max(0, Math.min(1, (deg - SWING_TUNING.BACKSWING_START_DEG) / (SWING_TUNING.BACKSWING_MAX_DEG - SWING_TUNING.BACKSWING_START_DEG)));

  function backToAddress() {
    phase = "address";
    topDeg = 0;
    minTheta = Infinity;
    peakRate = 0;
    faceIntegral = 0;
  }

  return {
    /** Call from the Lock button tap. Reference captured on the next sample. */
    arm() {
      phase = "arming";
      g0 = null;
    },

    feed(s: SwingSample) {
      const dt = lastT != null ? Math.max(0, (s.t - lastT) / 1000) : 0;
      lastT = s.t;
      if (s.t < cooldownUntil || phase === "idle") return;

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
          phase = "idle";
          g0 = null;
          onEvent({ type: "swing", power: firedPower, faceDeg: firedFace, backspin });
        }
        return;
      }

      if (!s.accG) return;

      if (phase === "arming") {
        const m = Math.hypot(...s.accG);
        if (m < SWING_TUNING.MIN_G) return; // wait for a usable gravity reading
        g0 = [...s.accG];
        backToAddress();
        onEvent({ type: "address" });
        return;
      }

      const theta = g0 ? relAngle(g0, s.accG) : null;
      if (theta == null) return;

      if (phase === "address") {
        if (theta >= SWING_TUNING.BACKSWING_START_DEG) {
          phase = "backswing";
          topDeg = theta;
          minTheta = Infinity;
          peakRate = rate;
          faceIntegral = 0;
        }
        return;
      }

      // backswing
      topDeg = Math.max(topDeg, theta);
      peakRate = Math.max(peakRate, rate);
      if (s.rot) faceIntegral += s.rot[2] * dt; // twist about the long axis
      onEvent({ type: "meter", power: meterOf(topDeg) });

      // Once we're past the top and descending, track the bottom of the arc.
      if (theta < topDeg) minTheta = Math.min(minTheta, theta);

      // Impact: either a direct pass through the lock cone, or a swing-through
      // whose bottom stayed near it and is now clearly rising up the far side.
      // Real swings drift off-plane — demanding a perfect return kills strikes.
      const directHit = theta <= SWING_TUNING.IMPACT_DEG;
      const passedBottom =
        minTheta <= SWING_TUNING.IMPACT_PASS_MAX_DEG && theta >= minTheta + SWING_TUNING.PASS_HYSTERESIS_DEG;

      if (directHit || passedBottom) {
        if (peakRate >= SWING_TUNING.MIN_DOWNSWING_RATE) {
          firedPower = Math.max(0.05, meterOf(topDeg));
          firedFace = Math.max(-SWING_TUNING.FACE_MAX_DEG, Math.min(SWING_TUNING.FACE_MAX_DEG, faceIntegral * SWING_TUNING.FACE_SCALE));
          phase = "spin-watch";
          spinStart = s.t;
          spinSum = 0;
          spinN = 0;
        } else if (directHit) {
          // lowered gently — stay locked, just reset the charge
          backToAddress();
          onEvent({ type: "cancel" });
        }
      }
    },

    reset() {
      phase = "idle";
      g0 = null;
      topDeg = 0;
      peakRate = 0;
      faceIntegral = 0;
      lastT = null;
      cooldownUntil = -Infinity;
    },
  };
}
