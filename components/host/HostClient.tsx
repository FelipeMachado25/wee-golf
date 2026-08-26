"use client";

import { useEffect, useRef, useState } from "react";
import type { PeerId, TelemetrySample } from "@/lib/networking/partykit/protocol";
import { connectRoom, type RoomConnection } from "@/lib/networking/partykit/client";
import { createHostPeerRegistry } from "@/lib/networking/webrtc/peer-host";
import { generateRoomId } from "@/lib/room/room-id";
import { QrPanel } from "./QrPanel";
import { TelemetryDebug } from "./TelemetryDebug";

export type Transport = "p2p" | "relay";

export type PeerRow = {
  peerId: PeerId;
  rtcState: RTCPeerConnectionState | "signaling";
  transport: Transport | null;
};

/** Live per-peer sample stats. Written at 60Hz — lives in a ref, NEVER in
 *  React state (plan D8). The debug panel reads it from a rAF loop. */
export type PeerStats = {
  last: TelemetrySample | null;
  received: number;
  dropped: number;
  outOfOrder: number;
  maxSeq: number;
  lastArrivalMs: number;
  transport: Transport;
};

type Status = "connecting" | "ready" | "error";

const MAX_ROOM_ATTEMPTS = 5;

export function HostClient() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [peers, setPeers] = useState<Record<PeerId, PeerRow>>({});
  const statsRef = useRef<Map<PeerId, PeerStats>>(new Map());

  useEffect(() => {
    // Full init here, full teardown in cleanup — StrictMode's dev double-mount
    // just builds the room twice and cleanly discards the first one.
    let disposed = false;
    let conn: RoomConnection | null = null;
    let attempts = 0;
    const hostPeerId = crypto.randomUUID();
    const stats = statsRef.current;

    const registry = createHostPeerRegistry({
      sendSignal: (to, payload) => conn?.send({ type: "signal", to, payload }),
      onSample: (from, sample) => recordSample(stats, from, sample, "p2p"),
      onPeerState: (from, s) => {
        setPeers((p) => (p[from] ? { ...p, [from]: { ...p[from], rtcState: s, transport: s === "connected" ? "p2p" : p[from].transport } } : p));
      },
    });

    function join() {
      if (disposed) return;
      const candidate = generateRoomId();
      conn = connectRoom({
        roomId: candidate,
        role: "host",
        peerId: hostPeerId,
        onMessage: (msg) => {
          switch (msg.type) {
            case "welcome":
              setRoomId(candidate);
              setStatus("ready");
              break;
            case "room-busy":
              conn?.close();
              if (++attempts < MAX_ROOM_ATTEMPTS) join();
              else setStatus("error");
              break;
            case "peer-joined":
              if (msg.peer.role === "controller") {
                setPeers((p) => ({ ...p, [msg.peer.peerId]: { peerId: msg.peer.peerId, rtcState: "signaling", transport: null } }));
              }
              break;
            case "peer-left":
              registry.removePeer(msg.peerId);
              stats.delete(msg.peerId);
              setPeers((p) => {
                const next = { ...p };
                delete next[msg.peerId];
                return next;
              });
              break;
            case "signal":
              void registry.handleSignal(msg.from, msg.payload);
              break;
            case "telemetry-fallback":
              recordSample(stats, msg.from, msg.sample, "relay");
              setPeers((p) => (p[msg.from] && p[msg.from].transport !== "relay" ? { ...p, [msg.from]: { ...p[msg.from], transport: "relay" } } : p));
              break;
          }
        },
      });
    }

    join();
    return () => {
      disposed = true;
      registry.closeAll();
      conn?.close();
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-neutral-950 p-8 text-neutral-100">
      <h1 className="text-2xl font-semibold tracking-tight">
        Wee Golf <span className="text-neutral-500">· host</span>
      </h1>

      {status === "error" && (
        <p className="text-red-400">Could not claim a room after {MAX_ROOM_ATTEMPTS} attempts. Reload to retry.</p>
      )}
      {status === "connecting" && <p className="animate-pulse text-neutral-400">Creating room…</p>}
      {status === "ready" && roomId && (
        <>
          <QrPanel roomId={roomId} />
          <p className="text-sm text-neutral-400">Scan with your phone to join</p>
          <PeerList peers={peers} />
          <TelemetryDebug statsRef={statsRef} peerIds={Object.keys(peers)} />
        </>
      )}
    </main>
  );
}

function PeerList({ peers }: { peers: Record<PeerId, PeerRow> }) {
  const rows = Object.values(peers);
  if (rows.length === 0) return <p className="font-mono text-xs text-neutral-600">0 controllers connected</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((p) => (
        <li key={p.peerId} className="flex items-center gap-3 rounded-lg bg-neutral-900 px-4 py-2 font-mono text-xs">
          <span
            className={
              p.rtcState === "connected"
                ? "h-2 w-2 rounded-full bg-emerald-400"
                : p.transport === "relay"
                  ? "h-2 w-2 rounded-full bg-amber-400"
                  : p.rtcState === "failed" || p.rtcState === "disconnected"
                    ? "h-2 w-2 rounded-full bg-red-400"
                    : "h-2 w-2 animate-pulse rounded-full bg-amber-400"
            }
          />
          <span className="text-neutral-300">{p.peerId.slice(0, 8)}</span>
          <span className="text-neutral-500">
            {/* "failed" while the relay carries traffic is the fallback doing
                its job — don't scare the room with raw ICE states. */}
            {p.transport === "relay" && p.rtcState !== "connected" ? "via server" : p.rtcState}
          </span>
          {p.transport && (
            <span className={p.transport === "p2p" ? "rounded bg-emerald-900 px-1.5 py-0.5 text-emerald-300" : "rounded bg-amber-900 px-1.5 py-0.5 text-amber-300"}>
              {p.transport.toUpperCase()}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function recordSample(stats: Map<PeerId, PeerStats>, from: PeerId, sample: TelemetrySample, transport: Transport) {
  let s = stats.get(from);
  if (!s) {
    s = { last: null, received: 0, dropped: 0, outOfOrder: 0, maxSeq: -1, lastArrivalMs: 0, transport };
    stats.set(from, s);
  }
  s.received += 1;
  s.lastArrivalMs = performance.now();
  s.transport = transport;
  if (sample.seq < s.maxSeq) {
    s.outOfOrder += 1;
  } else {
    if (s.maxSeq >= 0) s.dropped += sample.seq - s.maxSeq - 1;
    s.maxSeq = sample.seq;
    s.last = sample;
  }
}
