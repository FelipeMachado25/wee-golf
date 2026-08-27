"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameMessage, PeerId, TelemetrySample } from "@/lib/networking/partykit/protocol";
import { connectRoom, type RoomConnection } from "@/lib/networking/partykit/client";
import { createControllerPeer, type ControllerPeer } from "@/lib/networking/webrtc/peer-controller";
import { P2P_FALLBACK_TIMEOUT_MS } from "@/lib/networking/webrtc/config";
import { createWiiSwing } from "@/lib/game/swing";
import { playRumble } from "@/lib/audio/rumble";
import { ConnectionBadge, type ConnectionPhase } from "./ConnectionBadge";
import { PermissionGate } from "./PermissionGate";
import { GamePad, type PadState, type SwingPhase } from "./GamePad";

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
  const [swingPhase, setSwingPhase] = useState<SwingPhase>("aim");
  const [swung, setSwung] = useState(false);
  const [result, setResult] = useState<PadState["result"]>(null);
  const [hole, setHole] = useState<PadState["hole"]>(null);
  const [finished, setFinished] = useState<PadState["finished"]>(null);
  const [courseTotals, setCourseTotals] = useState<PadState["courseTotals"]>(null);
  const detectorArmed = useRef(false);
  const meterRef = useRef(0);

  const sendGameToHost = useCallback((msg: GameMessage) => {
    if (peerRef.current?.sendGame(msg)) return;
    connRef.current?.send({ type: "game", to: "host", payload: msg });
  }, []);

  // Wii swing machine, button-armed: Lock tap captures the reference pose →
  // raise = live meter → swing back through = strike; dead stop = backspin.
  const detector = useRef(
    createWiiSwing((e) => {
      switch (e.type) {
        case "address":
          setSwingPhase("address");
          meterRef.current = 0;
          playRumble({ hz: 60, ms: 80 }); // tactile "locked" tick
          break;
        case "meter":
          meterRef.current = e.power;
          setSwingPhase((p) => (p === "backswing" ? p : "backswing"));
          break;
        case "cancel":
          // gentle lower: still locked, charge resets — no unlock
          setSwingPhase("address");
          meterRef.current = 0;
          break;
        case "swing":
          detectorArmed.current = false;
          setSwung(true);
          setSwingPhase("aim");
          sendGameToHost({ kind: "swing", power: e.power, faceDeg: e.faceDeg, backspin: e.backspin });
          break;
      }
    }),
  );

  /** The Lock button: freezes the host arrow and arms the swing machine with
   *  the phone's CURRENT orientation as the club-at-the-ball reference. */
  const lockAim = useCallback(() => {
    detector.current.arm();
    sendGameToHost({ kind: "aim-lock", aimDeg: 0 });
  }, [sendGameToHost]);

  /** Back out of the lock to re-aim. */
  const reAim = useCallback(() => {
    detector.current.reset();
    setSwingPhase("aim");
    meterRef.current = 0;
    sendGameToHost({ kind: "aim-unlock" });
  }, [sendGameToHost]);

  const handleGame = useCallback((msg: GameMessage) => {
    switch (msg.kind) {
      case "turn":
        setTurn({ yourTurn: msg.yourTurn, strokeIndex: msg.strokeIndex });
        setSwingPhase("aim");
        setSwung(false);
        meterRef.current = 0;
        detector.current.reset();
        detectorArmed.current = msg.yourTurn;
        if (msg.yourTurn) playRumble({ hz: 60, ms: 200 }); // ¡te toca!
        break;
      case "stroke-result":
        setResult(msg);
        setSwung(false);
        setSwingPhase("aim");
        detectorArmed.current = false;
        if (msg.outcome === "holed") {
          playRumble({ hz: 60, ms: 150 });
          setTimeout(() => playRumble({ hz: 60, ms: 150 }), 250); // double pulse
        }
        break;
      case "hole-start":
        setHole(msg);
        setFinished(null);
        setResult(null);
        setSwung(false);
        setSwingPhase("aim");
        break;
      case "hole-finished":
        setFinished(msg);
        setTurn(null);
        detectorArmed.current = false;
        break;
      case "course-finished":
        setCourseTotals(msg);
        setFinished(null);
        setTurn(null);
        detectorArmed.current = false;
        break;
    }
  }, []);
  const handleGameRef = useRef(handleGame);
  handleGameRef.current = handleGame;

  const onMotion = useCallback((s: Omit<TelemetrySample, "seq">) => {
    if (detectorArmed.current) detector.current.feed({ t: s.t, accG: s.accG, rot: s.rot });
  }, []);

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
        state={{ turn, swingPhase, swung, result, hole, finished, courseTotals, myPeerId: myPeerIdRef.current }}
        meterRef={meterRef}
        onLockAim={lockAim}
        onReAim={reAim}
      />
      <PermissionGate sendSample={sendSample} onMotion={onMotion} />
    </main>
  );
}
