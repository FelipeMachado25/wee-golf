"use client";

export type ConnectionPhase =
  | "connecting"      // socket not open yet
  | "waiting-host"    // in the room, no host present
  | "signaling"       // host found, SDP/ICE in flight
  | "p2p"             // data channel open
  | "relay"           // fallback over the PartyKit socket
  | "disconnected";

const STYLE: Record<ConnectionPhase, { label: string; cls: string }> = {
  connecting: { label: "Connecting…", cls: "bg-neutral-800 text-neutral-400" },
  "waiting-host": { label: "Waiting for host screen…", cls: "bg-amber-900 text-amber-300" },
  signaling: { label: "Pairing…", cls: "bg-amber-900 text-amber-300 animate-pulse" },
  p2p: { label: "P2P", cls: "bg-emerald-900 text-emerald-300" },
  relay: { label: "RELAY", cls: "bg-amber-900 text-amber-300" },
  disconnected: { label: "Disconnected", cls: "bg-red-900 text-red-300" },
};

export function ConnectionBadge({ phase, hidden }: { phase: ConnectionPhase; hidden?: boolean }) {
  const s = STYLE[phase];
  return (
    <div className="flex items-center gap-2">
      <span className={`rounded-full px-3 py-1 font-mono text-xs font-semibold ${s.cls}`}>{s.label}</span>
      {hidden && (
        <span className="rounded-full bg-red-900 px-3 py-1 font-mono text-xs text-red-300">
          app in background — sensors paused
        </span>
      )}
    </div>
  );
}
