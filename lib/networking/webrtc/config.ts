export const ICE_SERVERS: { urls: string | string[] }[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

export const TELEMETRY_CHANNEL_LABEL = "telemetry";
export const EVENTS_CHANNEL_LABEL = "events";

/** The whole point of using WebRTC here: unreliable, unordered datagram-style
 *  delivery. A lost sample is worthless 16ms later — never retransmit. */
export const DATA_CHANNEL_INIT: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0,
};

/** If the P2P channel hasn't opened after this long, the controller falls back
 *  to relaying telemetry over the PartyKit WebSocket (host shows RELAY badge). */
export const P2P_FALLBACK_TIMEOUT_MS = 8_000;

export const TELEMETRY_HZ = 60;
