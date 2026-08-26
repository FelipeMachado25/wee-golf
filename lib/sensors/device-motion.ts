import type { TelemetrySample } from "../networking/partykit/protocol";
import { TELEMETRY_HZ } from "../networking/webrtc/config";
import { createRateLimiter } from "./rate-limiter";

export type MotionPermission = "granted" | "denied" | "unsupported" | "not-required";

type MotionEventCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** ⚠️ Must be CALLED synchronously inside the user-gesture handler (no await
 *  before the call) — iOS silently denies otherwise. Awaiting the returned
 *  promise afterwards is fine. */
export function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof DeviceMotionEvent === "undefined") return Promise.resolve("unsupported");
  const ctor = DeviceMotionEvent as MotionEventCtor;
  if (typeof ctor.requestPermission !== "function") return Promise.resolve("not-required"); // Android / desktop
  return ctor.requestPermission().catch(() => "denied" as const);
}

function xyz(v: DeviceMotionEventAcceleration | null): [number, number, number] | null {
  // event.acceleration is null on some devices; treat partially-null the same.
  if (!v || v.x == null || v.y == null || v.z == null) return null;
  return [v.x, v.y, v.z];
}

function abg(v: DeviceMotionEventRotationRate | null): [number, number, number] | null {
  if (!v || v.alpha == null || v.beta == null || v.gamma == null) return null;
  return [v.alpha, v.beta, v.gamma];
}

/** Listens to devicemotion, throttled to ~TELEMETRY_HZ. Returns the cleanup. */
export function startMotionCapture(onSample: (s: Omit<TelemetrySample, "seq">) => void): () => void {
  const allow = createRateLimiter(TELEMETRY_HZ);
  const handler = (e: DeviceMotionEvent) => {
    if (!allow()) return;
    onSample({
      t: performance.now(),
      acc: xyz(e.acceleration),
      accG: xyz(e.accelerationIncludingGravity),
      rot: abg(e.rotationRate),
      interval: e.interval ?? 0,
    });
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}
