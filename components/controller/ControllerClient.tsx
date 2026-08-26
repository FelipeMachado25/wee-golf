"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerId, TelemetrySample } from "@/lib/networking/partykit/protocol";
import { connectRoom, type RoomConnection } from "@/lib/networking/partykit/client";
import { createControllerPeer, type ControllerPeer } from "@/lib/networking/webrtc/peer-controller";
import { P2P_FALLBACK_TIMEOUT_MS } from "@/lib/networking/webrtc/config";
import { ConnectionBadge, type ConnectionPhase } from "./ConnectionBadge";

export function ControllerClient({ roomId }: { roomId: string }) {
  const [phase, setPhase] = useState<ConnectionPhase>("connecting");
  const [hidden, setHidden] = useState(false);
  const connRef = useRef<RoomConnection | null>(null);
  const peerRef = useRef<ControllerPeer | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let disposed = false;
    let peer: ControllerPeer | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const myPeerId = crypto.randomUUID();

    function startPeer(hostPeerId: PeerId, conn: RoomConnection) {
      if (disposed || peer) return;
      setPhase("signaling");
      peer = createControllerPeer({
        hostPeerId,
        sendSignal: (to, payload) => conn.send({ type: "signal", to, payload }),
        events: {
          onState: (s) => {
            if (s === "failed" || s === "closed") setPhase((p) => (p === "relay" ? p : "disconnected"));
          },
          onChannelOpen: () => {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            setPhase("p2p");
          },
          onChannelClose: () => setPhase((p) => (p === "relay" ? p : "disconnected")),
        },
      });
      peerRef.current = peer;
      void peer.start();
      // D5: if the channel hasn't opened by now, telemetry will flow over the
      // WebSocket instead (send() routes it). Flip the badge so the user knows.
      fallbackTimer = setTimeout(() => {
        if (!disposed && phaseRef.current !== "p2p") setPhase("relay");
      }, P2P_FALLBACK_TIMEOUT_MS);
    }

    const conn = connectRoom({
      roomId,
      role: "controller",
      peerId: myPeerId,
      onMessage: (msg) => {
        switch (msg.type) {
          case "welcome": {
            const host = msg.peers.find((p) => p.role === "host");
            if (host) startPeer(host.peerId, conn);
            else setPhase("waiting-host");
            break;
          }
          case "peer-joined":
            if (msg.peer.role === "host") startPeer(msg.peer.peerId, conn);
            break;
          case "signal":
            void peer?.handleSignal(msg.payload);
            break;
          case "peer-left":
            // Host gone: nothing to send to until it comes back.
            break;
        }
      },
    });
    connRef.current = conn;

    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      peer?.close();
      conn.close();
    };
  }, [roomId]);

  /** Used by the sensor pipeline (PermissionGate): P2P when open, WebSocket
   *  relay otherwise. Returns the transport used. */
  const sendSample = useCallback((sample: TelemetrySample): "p2p" | "relay" | "dropped" => {
    if (peerRef.current?.send(sample)) return "p2p";
    if (connRef.current) {
      connRef.current.send({ type: "telemetry-fallback", sample });
      return "relay";
    }
    return "dropped";
  }, []);
  // sendSample is wired into PermissionGate in the sensors task; referenced
  // here so the pipeline contract is already in place.
  void sendSample;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-xl font-semibold tracking-tight">
        Wee Golf <span className="text-neutral-500">· controller</span>
      </h1>
      <div className="font-mono text-2xl tracking-[0.3em] text-emerald-400">{roomId}</div>
      <ConnectionBadge phase={phase} hidden={hidden} />
      <p className="max-w-xs text-center text-sm text-neutral-500">
        Motion capture arrives in the next checkpoint — this build verifies the connection only.
      </p>
    </main>
  );
}
