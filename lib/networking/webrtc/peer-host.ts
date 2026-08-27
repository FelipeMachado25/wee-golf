import type { GameMessage, IceCandidateInit, PeerId, SignalPayload, TelemetrySample } from "../partykit/protocol";
import { isGameMessage } from "../partykit/protocol";
import { EVENTS_CHANNEL_LABEL, MAX_DC_MESSAGE_BYTES } from "./config";
import { ICE_SERVERS } from "./config";
import { createIceBuffer, type IceBuffer } from "./ice-buffer";

type PeerSession = {
  pc: RTCPeerConnection;
  iceBuffer: IceBuffer;
  events: RTCDataChannel | null;
};

/** The host side: one RTCPeerConnection per controller, keyed by peerId, so N
 *  phones work without rework. The host never offers — it answers whatever
 *  offer arrives and accepts the controller-created "telemetry" channel via
 *  ondatachannel. */
export function createHostPeerRegistry(args: {
  sendSignal: (to: PeerId, payload: SignalPayload) => void;
  onSample: (from: PeerId, sample: TelemetrySample) => void;
  onPeerState: (from: PeerId, s: RTCPeerConnectionState) => void;
  onGame?: (from: PeerId, msg: GameMessage) => void;
}) {
  const sessions = new Map<PeerId, PeerSession>();

  function createSession(from: PeerId): PeerSession {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const iceBuffer = createIceBuffer(async (c) => {
      await pc.addIceCandidate(c);
    });

    pc.ondatachannel = (e) => {
      if (e.channel.label === EVENTS_CHANNEL_LABEL) {
        const session = sessions.get(from);
        if (session) session.events = e.channel;
        e.channel.onmessage = (m) => {
          if (typeof m.data !== "string") return;
          try {
            const parsed: unknown = JSON.parse(m.data);
            if (isGameMessage(parsed)) args.onGame?.(from, parsed);
          } catch {
            /* drop malformed */
          }
        };
        return;
      }
      // telemetry (unreliable) channel
      e.channel.onmessage = (m) => {
        if (typeof m.data !== "string") return;
        try {
          args.onSample(from, JSON.parse(m.data) as TelemetrySample);
        } catch {
          // Malformed sample on an unreliable channel: drop it.
        }
      };
    };
    pc.onconnectionstatechange = () => args.onPeerState(from, pc.connectionState);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        args.sendSignal(from, { kind: "ice", candidate: e.candidate.toJSON() as IceCandidateInit });
      }
    };

    const session: PeerSession = { pc, iceBuffer, events: null };
    sessions.set(from, session);
    return session;
  }

  return {
    async handleSignal(from: PeerId, payload: SignalPayload) {
      if (payload.kind === "offer") {
        // A re-offer from the same peer (e.g. page reload) replaces its session.
        sessions.get(from)?.pc.close();
        sessions.delete(from);
        const { pc, iceBuffer } = createSession(from);
        await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        await iceBuffer.markRemoteDescriptionSet();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        args.sendSignal(from, { kind: "answer", sdp: answer.sdp! });
      } else if (payload.kind === "ice") {
        await sessions.get(from)?.iceBuffer.add(payload.candidate);
      }
      // "answer" is never valid here — the host is the answerer.
    },

    /** Reliable lane to one controller. False → caller uses the WS fallback. */
    sendGame(peerId: PeerId, msg: GameMessage): boolean {
      const ec = sessions.get(peerId)?.events;
      if (!ec || ec.readyState !== "open") return false;
      const payload = JSON.stringify(msg);
      if (payload.length > MAX_DC_MESSAGE_BYTES) return false;
      try {
        ec.send(payload);
        return true;
      } catch {
        return false;
      }
    },

    removePeer(peerId: PeerId) {
      sessions.get(peerId)?.pc.close();
      sessions.delete(peerId);
    },

    closeAll() {
      for (const s of sessions.values()) s.pc.close();
      sessions.clear();
    },
  };
}

export type HostPeerRegistry = ReturnType<typeof createHostPeerRegistry>;
