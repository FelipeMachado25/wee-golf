"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { PeerId } from "@/lib/networking/partykit/protocol";
import type { PeerStats } from "./HostClient";

/** Live telemetry panel. Samples arrive at 60Hz per peer and land in a ref
 *  (plan D8) — this component NEVER setStates on them. A rAF loop reads the
 *  stats map and writes straight to the DOM. The counters (pps, drops,
 *  out-of-order, age) are the instrument that will tell Phase 2 whether the
 *  physics feels wrong because of the network or because of the math. */
export function TelemetryDebug({
  statsRef,
  peerIds,
}: {
  statsRef: RefObject<Map<PeerId, PeerStats>>;
  peerIds: PeerId[];
}) {
  if (peerIds.length === 0) return null;
  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      {peerIds.map((id) => (
        <PeerDebugRow key={id} peerId={id} statsRef={statsRef} />
      ))}
    </div>
  );
}

const AXES = ["x", "y", "z"] as const;
const BAR_RANGE = 20; // m/s² full-scale for the bars

function PeerDebugRow({ peerId, statsRef }: { peerId: PeerId; statsRef: RefObject<Map<PeerId, PeerStats>> }) {
  const root = useRef<HTMLDivElement>(null);
  const rate = useRef({ lastReceived: 0, lastT: 0, pps: 0 });

  useEffect(() => {
    let raf = 0;
    const set = (name: string, value: string) => {
      const el = root.current?.querySelector<HTMLElement>(`[data-f="${name}"]`);
      if (el && el.textContent !== value) el.textContent = value;
    };
    const fmt = (v: number) => (v >= 0 ? " " : "") + v.toFixed(2);
    const tuple = (name: string, v: [number, number, number] | null) => {
      AXES.forEach((axis, i) => set(`${name}-${axis}`, v ? fmt(v[i]) : "  --"));
    };

    const tick = () => {
      const s = statsRef.current?.get(peerId);
      if (s) {
        tuple("acc", s.last?.acc ?? null);
        tuple("accG", s.last?.accG ?? null);
        tuple("rot", s.last?.rot ?? null);
        set("recv", String(s.received));
        set("drop", String(s.dropped));
        set("ooo", String(s.outOfOrder));
        set("age", s.lastArrivalMs ? `${Math.round(performance.now() - s.lastArrivalMs)}ms` : "--");
        set("transport", s.transport.toUpperCase());

        // packets/sec over a ~1s window
        const now = performance.now();
        const r = rate.current;
        if (now - r.lastT >= 1000) {
          r.pps = Math.round(((s.received - r.lastReceived) * 1000) / (now - r.lastT));
          r.lastReceived = s.received;
          r.lastT = now;
        }
        set("pps", String(r.pps));

        // center-zero bars for acceleration (or gravity-included as fallback)
        const src = s.last?.acc ?? s.last?.accG;
        AXES.forEach((axis, i) => {
          const bar = root.current?.querySelector<HTMLElement>(`[data-bar="${axis}"]`);
          if (!bar) return;
          const v = src ? Math.max(-1, Math.min(1, src[i] / BAR_RANGE)) : 0;
          bar.style.transform = `scaleX(${Math.abs(v)})`;
          bar.style.transformOrigin = v >= 0 ? "left" : "right";
          bar.style.left = v >= 0 ? "50%" : "0";
          bar.style.right = v >= 0 ? "0" : "50%";
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [peerId, statsRef]);

  return (
    <div ref={root} className="rounded-xl bg-neutral-900 p-4 font-mono text-xs text-neutral-300">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-neutral-500">{peerId.slice(0, 8)}</span>
        <span data-f="transport" className="rounded bg-neutral-800 px-1.5 py-0.5 text-emerald-300" />
        <span className="text-neutral-500">
          <span data-f="pps" className="text-neutral-100" /> pps
        </span>
        <span className="text-neutral-500">
          drops <span data-f="drop" className="text-neutral-100" />
        </span>
        <span className="text-neutral-500">
          ooo <span data-f="ooo" className="text-neutral-100" />
        </span>
        <span className="text-neutral-500">
          age <span data-f="age" className="text-neutral-100" />
        </span>
        <span className="text-neutral-500">
          total <span data-f="recv" className="text-neutral-100" />
        </span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
        {(["acc", "accG", "rot"] as const).map((name) => (
          <div key={name} className="contents">
            <span className="text-neutral-500">{name}</span>
            <span className="whitespace-pre">
              {AXES.map((axis) => (
                <span key={axis}>
                  <span className="text-neutral-600"> {axis}:</span>
                  <span data-f={`${name}-${axis}`} />
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {AXES.map((axis) => (
          <div key={axis} className="relative h-2 overflow-hidden rounded bg-neutral-800">
            <div className="absolute inset-y-0 left-1/2 w-px bg-neutral-600" />
            <div data-bar={axis} className="absolute inset-y-0 bg-emerald-400/80" style={{ left: "50%", right: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
