"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { GameMessage, PeerId, TelemetrySample } from "@/lib/networking/partykit/protocol";
import { connectRoom, type RoomConnection } from "@/lib/networking/partykit/client";
import { createHostPeerRegistry } from "@/lib/networking/webrtc/peer-host";
import { generateRoomId } from "@/lib/room/room-id";
import { QrPanel } from "./QrPanel";
import { TelemetryDebug } from "./TelemetryDebug";
import type { GameBus } from "./game/useGameLoop";

// three.js only ever loads in the browser
const GameView = dynamic(() => import("./game/GameView").then((m) => m.GameView), { ssr: false });

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
  const [mode, setMode] = useState<"lobby" | "playing">("lobby");
  const [holeCount, setHoleCount] = useState(3);
  const [debug, setDebug] = useState(false);
  const seedRef = useRef((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  const statsRef = useRef<Map<PeerId, PeerStats>>(new Map());
  const gameBusRef = useRef<GameBus | null>(null);
  const sendGameRef = useRef<(to: PeerId, msg: GameMessage) => void>(() => {});

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).has("debug"));
  }, []);

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
      onSample: (from, sample) => {
        recordSample(stats, from, sample, "p2p");
        if (sample.rot) gameBusRef.current?.feedMotion(from, sample.t, sample.rot[0], sample.accG);
      },
      onGame: (from, msg) => gameBusRef.current?.handleGameMessage(from, msg),
      onPeerState: (from, s) => {
        setPeers((p) => (p[from] ? { ...p, [from]: { ...p[from], rtcState: s, transport: s === "connected" ? "p2p" : p[from].transport } } : p));
      },
    });

    // Reliable outbound lane: events channel first, WS relay as fallback.
    sendGameRef.current = (to, msg) => {
      if (!registry.sendGame(to, msg)) conn?.send({ type: "game", to, payload: msg });
    };

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
                gameBusRef.current?.addPlayer(msg.peer.peerId);
              }
              break;
            case "peer-left":
              registry.removePeer(msg.peerId);
              stats.delete(msg.peerId);
              gameBusRef.current?.removePlayer(msg.peerId);
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
              if (msg.sample.rot) gameBusRef.current?.feedMotion(msg.from, msg.sample.t, msg.sample.rot[0], msg.sample.accG);
              setPeers((p) => (p[msg.from] && p[msg.from].transport !== "relay" ? { ...p, [msg.from]: { ...p[msg.from], transport: "relay" } } : p));
              break;
            case "game":
              gameBusRef.current?.handleGameMessage(msg.from, msg.payload);
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

  const peerIds = Object.keys(peers);
  const canStart = peerIds.length > 0 || debug;

  if (mode === "playing") {
    return (
      <div className="relative">
        <GameView
          initialPeers={peerIds.length > 0 ? peerIds : ["DEBUG"]}
          holeCount={holeCount}
          seed={seedRef.current}
          sendGame={(to, msg) => sendGameRef.current(to, msg)}
          busRef={gameBusRef}
          debug={debug}
        />
        {/* QR shrinks to a corner so latecomers can still join */}
        {roomId && (
          <div className="absolute bottom-4 right-4 z-10 flex flex-col items-center gap-1 rounded-xl bg-white p-2 opacity-80">
            <QrCorner roomId={roomId} />
          </div>
        )}
      </div>
    );
  }

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
          <div className="flex items-center gap-2">
            {[3, 6, 9].map((n) => (
              <button
                key={n}
                onClick={() => setHoleCount(n)}
                className={`rounded-xl px-5 py-2 font-mono text-sm font-bold ${
                  holeCount === n ? "bg-emerald-500 text-neutral-950" : "bg-neutral-900 text-neutral-400"
                }`}
              >
                {n} holes
              </button>
            ))}
          </div>
          <button
            onClick={() => canStart && setMode("playing")}
            disabled={!canStart}
            className="h-14 rounded-2xl bg-emerald-500 px-10 text-lg font-bold text-neutral-950 shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-30"
          >
            Start round ⛳
          </button>
          <TelemetryDebug statsRef={statsRef} peerIds={peerIds} />
        </>
      )}
    </main>
  );
}

function QrCorner({ roomId }: { roomId: string }) {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => setBase(process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin), []);
  if (!base) return null;
  return (
    <>
      <QRCode value={`${base}/controller/${roomId}`} size={88} />
      <span className="font-mono text-[10px] font-bold text-neutral-800">{roomId}</span>
    </>
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
