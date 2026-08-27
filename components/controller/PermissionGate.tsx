"use client";

import { useEffect, useRef, useState } from "react";
import type { TelemetrySample } from "@/lib/networking/partykit/protocol";
import { requestMotionPermission, startMotionCapture, type MotionPermission } from "@/lib/sensors/device-motion";
import { unlockAudio } from "@/lib/audio/rumble";
import { RumbleTester } from "./RumbleTester";

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<unknown> };
};

export function PermissionGate({
  sendSample,
  onMotion,
}: {
  sendSample: (s: TelemetrySample) => "p2p" | "relay" | "dropped";
  /** Raw motion tap for the swing detector — called with every sample. */
  onMotion?: (s: Omit<TelemetrySample, "seq">) => void;
}) {
  const [perm, setPerm] = useState<MotionPermission | "idle">("idle");
  const [sent, setSent] = useState(0);
  const seqRef = useRef(0);
  const sentRef = useRef(0);
  const stopRef = useRef<(() => void) | null>(null);

  function onTap() {
    // Gesture-critical ordering (plan D6/D10): everything that needs the user
    // gesture runs synchronously, BEFORE any await.
    unlockAudio();
    const permission = requestMotionPermission(); // sync call, awaited later
    (navigator as WakeLockNavigator).wakeLock?.request("screen").catch(() => {});

    void permission.then((result) => {
      setPerm(result);
      if (result === "granted" || result === "not-required") {
        stopRef.current?.();
        stopRef.current = startMotionCapture((s) => {
          onMotion?.(s);
          const sample: TelemetrySample = { ...s, seq: seqRef.current++ };
          if (sendSample(sample) !== "dropped") sentRef.current += 1;
        });
      }
    });
  }

  // The 60Hz counter lives in a ref; the UI refreshes it at 4Hz.
  useEffect(() => {
    const id = setInterval(() => setSent(sentRef.current), 250);
    return () => {
      clearInterval(id);
      stopRef.current?.();
    };
  }, []);

  if (perm === "idle") {
    return (
      <button
        onClick={onTap}
        className="h-20 w-full max-w-xs rounded-2xl bg-emerald-500 text-lg font-bold text-neutral-950 shadow-lg shadow-emerald-500/20 active:scale-95"
      >
        Enable motion control
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      {perm === "denied" && (
        <p className="text-center text-sm text-red-400">
          Motion access denied. On iPhone: Settings → Safari → Motion &amp; Orientation Access, then reload.
        </p>
      )}
      {perm === "unsupported" && (
        <p className="text-center text-sm text-amber-400">
          This device has no motion sensors — open this page on a phone.
        </p>
      )}
      {(perm === "granted" || perm === "not-required") && (
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm text-emerald-400">Motion streaming</p>
          <p className="font-mono text-3xl tabular-nums text-neutral-100">{sent}</p>
          <p className="text-xs text-neutral-500">samples sent — shake the phone</p>
        </div>
      )}
      <RumbleTester />
    </div>
  );
}
