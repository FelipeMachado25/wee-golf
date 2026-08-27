"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameMessage, PeerId, TelemetrySample } from "@/lib/networking/partykit/protocol";
import { connectRoom, type RoomConnection } from "@/lib/networking/partykit/client";
import { createControllerPeer, type ControllerPeer } from "@/lib/networking/webrtc/peer-controller";
import { P2P_FALLBACK_TIMEOUT_MS } from "@/lib/networking/webrtc/config";
import { createSwingDetector } from "@/lib/game/swing";
import { playRumble } from "@/lib/audio/rumble";
import { ConnectionBadge, type ConnectionPhase } from "./ConnectionBadge";
import { PermissionGate } from "./PermissionGate";
import { GamePad, type PadState } from "./GamePad";

export function ControllerClient({ roomId }: { roomId: string }) {
  const [phase, setPhase] = useState<ConnectionPhase>("connecting");
  const [hidden, setHidden] = useState(false);
  const connRef = useRef<RoomConnection | null>(null);
  const peerRef = useRef<ControllerPeer | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const myPeerIdRef = useRef<string>("");

  // --- game pad state --------------------------------------------------------
  const [turn, setTurn] = useState<PadState["turn"]>(null);
  const [aimLocked, setAimLocked] = useState(false);
  const [swung, setSwung] = useState(false);
  const [result, setResult] = useState<PadState["result"]>(null);
  const [finished, setFinished] = useState<PadState["finished"]>(null);
  const detectorArmed = useRef(false);

  const sendGameToHost = useCallback((msg: GameMessage) => {
    if (peerRef.current?.sendGame(msg)) return;
    connRef.current?.send({ type: "game", to: "host", payload: msg });
  }, []);

  const handleGame = useCallback((msg: GameMessage) => {
    switch (msg.kind) {
      case "turn":
        setTurn({ yourTurn: msg.yourTurn, strokeIndex: msg.strokeIndex });
        setAimLocked(false);
        setSwung(false);
        detectorArmed.current = false;
        if (msg.yourTurn) playRumble({ hz: 60, ms: 200 }); // ¡te toca!
        break;
      case "stroke-result":
        setResult(msg);
        setSwung(false);
        setAimLocked(false);
        detectorArmed.current = false;
        if (msg.outcome === "holed") {
          playRumble({ hz: 60, ms: 150 });
          setTimeout(() => playRumble({ hz: 60, ms: 150 }), 250); // double pulse
        }
        break;
      case "hole-finished":
        setFinished(msg);
        setTurn(null);
        detectorArmed.current = false;
        break;
    }
  }, []);
  const handleGameRef = useRef(handleGame);
  handleGameRef.current = handleGame;

  const detector = useRef(
    createSwingDetector((s) => {
      if (!detectorArmed.current) return;
      detectorArmed.current = false;
      setSwung(true);
      sendGameToHost({ kind: "swing", power: s.power, faceDeg: s.faceDeg });
    }),
  );

  const onMotion = useCallback((s: Omit<TelemetrySample, "seq">) => {
    if (detectorArmed.current) detector.current.feed({ t: s.t, accG: s.accG, rot: s.rot });
  }, []);

  function lockAim() {
    detector.current.reset();
    detectorArmed.current = true;
    setAimLocked(true);
    sendGameToHost({ kind: "aim-lock", aimDeg: 0 });
  }

  // --- connection ------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    let peer: ControllerPeer | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const myPeerId = crypto.randomUUID();
    myPeerIdRef.current = myPeerId;
    let channelEverOpened = false;

    function startPeer(hostPeerId: PeerId, conn: RoomConnection) {
      if (disposed || peer) return;
      setPhase("signaling");
      peer = createControllerPeer({
        hostPeerId,
        sendSignal: (to, payload) => conn.send({ type: "signal", to, payload }),
        onGame: (msg) => handleGameRef.current(msg),
        events: {
          onState: (s) => {
            if (s === "failed" || s === "closed") {
              // ICE failure before the channel ever opened is the normal
              // "this network blocks P2P" case — flip straight to the
              // WebSocket relay instead of waiting out the 8s timer.
              if (fallbackTimer) clearTimeout(fallbackTimer);
              setPhase(channelEverOpened ? "disconnected" : "relay");
            }
          },
          onChannelOpen: () => {
            channelEverOpened = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            setPhase("p2p");
          },
          onChannelClose: () => setPhase((p) => (p === "relay" ? p : "disconnected")),
        },
      });
      peerRef.current = peer;
      void peer.start();
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
          case "game":
            handleGameRef.current(msg.payload);
            break;
          case "peer-left":
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

  /** Telemetry lane: P2P when open, WebSocket relay otherwise. */
  const sendSample = useCallback((sample: TelemetrySample): "p2p" | "relay" | "dropped" => {
    if (peerRef.current?.send(sample)) return "p2p";
    if (connRef.current) {
      connRef.current.send({ type: "telemetry-fallback", sample });
      return "relay";
    }
    return "dropped";
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-xl font-semibold tracking-tight">
        Wee Golf <span className="text-neutral-500">· controller</span>
      </h1>
      <div className="font-mono text-2xl tracking-[0.3em] text-emerald-400">{roomId}</div>
      <ConnectionBadge phase={phase} hidden={hidden} />
      <GamePad
        state={{ turn, aimLocked, swung, result, finished, myPeerId: myPeerIdRef.current }}
        onLockAim={lockAim}
      />
      <PermissionGate sendSample={sendSample} onMotion={onMotion} />
    </main>
  );
}
