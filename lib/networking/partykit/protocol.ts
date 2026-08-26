/** Signaling protocol shared between the browser and party/server.ts.
 *  ⚠️ This file is also compiled by PartyKit's esbuild for workerd:
 *  it must NOT import DOM or Next types. DOM-ish shapes are redeclared
 *  structurally below. */

export const PROTOCOL_VERSION = 1;

export type PeerId = string;
export type Role = "host" | "controller";

export type PeerInfo = { peerId: PeerId; role: Role; joinedAt: number };

/** Structural stand-in for the DOM's RTCIceCandidateInit. */
export type IceCandidateInit = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: IceCandidateInit };

export type TelemetrySample = {
  seq: number;
  t: number;                                  // performance.now() on the phone
  acc: [number, number, number] | null;       // acceleration (gravity removed)
  accG: [number, number, number] | null;      // accelerationIncludingGravity
  rot: [number, number, number] | null;       // rotationRate alpha/beta/gamma
  interval: number;                           // event.interval in ms
};

/** client → server */
export type ClientMessage =
  | { type: "signal"; to: PeerId; payload: SignalPayload }
  | { type: "telemetry-fallback"; sample: TelemetrySample };

/** server → client */
export type ServerMessage =
  | { type: "welcome"; peerId: PeerId; role: Role; peers: PeerInfo[] }
  | { type: "room-busy" }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peerId: PeerId }
  | { type: "signal"; from: PeerId; payload: SignalPayload }
  | { type: "telemetry-fallback"; from: PeerId; sample: TelemetrySample };

// ---------------------------------------------------------------------------
// Runtime guards. Network input is never cast blindly — anything that does not
// validate here gets dropped by the caller.
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null;
}

function isSignalPayload(v: unknown): v is SignalPayload {
  if (!isRec(v)) return false;
  if (v.kind === "offer" || v.kind === "answer") return typeof v.sdp === "string";
  if (v.kind === "ice") {
    const c = v.candidate;
    return isRec(c) && typeof c.candidate === "string";
  }
  return false;
}

function isTelemetrySample(v: unknown): v is TelemetrySample {
  return isRec(v) && typeof v.seq === "number" && typeof v.t === "number";
}

function isPeerInfo(v: unknown): v is PeerInfo {
  return isRec(v) && typeof v.peerId === "string" && (v.role === "host" || v.role === "controller");
}

export function isServerMessage(v: unknown): v is ServerMessage {
  if (!isRec(v)) return false;
  switch (v.type) {
    case "welcome":
      return typeof v.peerId === "string" && Array.isArray(v.peers) && v.peers.every(isPeerInfo);
    case "room-busy":
      return true;
    case "peer-joined":
      return isPeerInfo(v.peer);
    case "peer-left":
      return typeof v.peerId === "string";
    case "signal":
      return typeof v.from === "string" && isSignalPayload(v.payload);
    case "telemetry-fallback":
      return typeof v.from === "string" && isTelemetrySample(v.sample);
    default:
      return false;
  }
}

export function isClientMessage(v: unknown): v is ClientMessage {
  if (!isRec(v)) return false;
  switch (v.type) {
    case "signal":
      return typeof v.to === "string" && isSignalPayload(v.payload);
    case "telemetry-fallback":
      return isTelemetrySample(v.sample);
    default:
      return false;
  }
}
