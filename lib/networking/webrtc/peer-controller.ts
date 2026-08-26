import type { IceCandidateInit, PeerId, SignalPayload, TelemetrySample } from "../partykit/protocol";
import { DATA_CHANNEL_INIT, ICE_SERVERS, TELEMETRY_CHANNEL_LABEL } from "./config";
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
}) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const iceBuffer = createIceBuffer(async (c) => {
    await pc.addIceCandidate(c);
  });

  // The channel must exist BEFORE createOffer so the m=application section
  // makes it into the SDP.
  const dc = pc.createDataChannel(TELEMETRY_CHANNEL_LABEL, DATA_CHANNEL_INIT);
  dc.onopen = () => args.events.onChannelOpen();
  dc.onclose = () => args.events.onChannelClose();

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

    close() {
      dc.close();
      pc.close();
    },
  };
}

export type ControllerPeer = ReturnType<typeof createControllerPeer>;
