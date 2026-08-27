import type { GameMessage, IceCandidateInit, PeerId, SignalPayload, TelemetrySample } from "../partykit/protocol";
import { isGameMessage } from "../partykit/protocol";
import { DATA_CHANNEL_INIT, EVENTS_CHANNEL_LABEL, ICE_SERVERS, TELEMETRY_CHANNEL_LABEL } from "./config";
import { createIceBuffer } from "./ice-buffer";

export type ControllerPeerEvents = {
  onState: (s: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  onChannelClose: () => void;
};

/** The phone side. Roles are fixed (see plan D2): the controller always
 *  offers, the host always answers — no glare, no perfect negotiation. */
export function createControllerPeer(args: {
  hostPeerId: PeerId;
  sendSignal: (to: PeerId, payload: SignalPayload) => void;
  events: ControllerPeerEvents;
  onGame?: (msg: GameMessage) => void;
}) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const iceBuffer = createIceBuffer(async (c) => {
    await pc.addIceCandidate(c);
  });

  // Channels must exist BEFORE createOffer so the m=application section
  // makes it into the SDP.
  const dc = pc.createDataChannel(TELEMETRY_CHANNEL_LABEL, DATA_CHANNEL_INIT);
  dc.onopen = () => args.events.onChannelOpen();
  dc.onclose = () => args.events.onChannelClose();

  // Reliable, ordered lane for discrete game events (swings, turns).
  const ec = pc.createDataChannel(EVENTS_CHANNEL_LABEL, { ordered: true });
  ec.onmessage = (m) => {
    if (typeof m.data !== "string") return;
    try {
      const parsed: unknown = JSON.parse(m.data);
      if (isGameMessage(parsed)) args.onGame?.(parsed);
    } catch {
      /* drop malformed */
    }
  };

  pc.onconnectionstatechange = () => args.events.onState(pc.connectionState);
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      args.sendSignal(args.hostPeerId, { kind: "ice", candidate: e.candidate.toJSON() as IceCandidateInit });
    }
  };

  return {
    async start() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      args.sendSignal(args.hostPeerId, { kind: "offer", sdp: offer.sdp! });
    },

    async handleSignal(payload: SignalPayload) {
      if (payload.kind === "answer") {
        await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
        await iceBuffer.markRemoteDescriptionSet();
      } else if (payload.kind === "ice") {
        await iceBuffer.add(payload.candidate);
      }
      // "offer" is never valid here — the controller is the offerer.
    },

    /** Returns false when the channel isn't open — the caller uses that to
     *  route the sample through the WebSocket fallback instead. */
    send(sample: TelemetrySample): boolean {
      if (dc.readyState !== "open") return false;
      dc.send(JSON.stringify(sample));
      return true;
    },

    /** Reliable lane. Returns false when the caller must use the WS fallback. */
    sendGame(msg: GameMessage): boolean {
      if (ec.readyState !== "open") return false;
      ec.send(JSON.stringify(msg));
      return true;
    },

    close() {
      dc.close();
      ec.close();
      pc.close();
    },
  };
}

export type ControllerPeer = ReturnType<typeof createControllerPeer>;
