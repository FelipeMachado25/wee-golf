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

/** Discrete game events. They ride the reliable "events" RTCDataChannel when
 *  it is open, else the WebSocket relay ({type:"game"}). Never the unreliable
 *  telemetry channel — a lost swing is a lost stroke. */
/** Redeclared structurally (like IceCandidateInit) so the Worker bundle never
 *  drags in the game's physics modules. */
export type ClubIdWire = "driver" | "iron" | "wedge" | "putter";

export type GameMessage =
  // controller → host
  | { kind: "aim-lock"; aimDeg: number }
  | { kind: "aim-unlock" } // left the address pose without striking
  | { kind: "club"; club: ClubIdWire }
  | { kind: "profile"; name: string; face?: string } // face: small data-URL selfie
  | { kind: "swing"; power: number; faceDeg: number; backspin: number }
  // host → controller
  | { kind: "turn"; yourTurn: boolean; strokeIndex: number; club: ClubIdWire; distToCup: number }
  | { kind: "stroke-result"; outcome: "stopped" | "holed" | "oob"; distToCup: number }
  | { kind: "hole-start"; index: number; total: number; par: number }
  | { kind: "hole-finished"; scores: { peerId: PeerId; strokes: number; holed: boolean }[] }
  | { kind: "course-finished"; totals: { peerId: PeerId; strokes: number }[] };

/** client → server */
export type ClientMessage =
  | { type: "signal"; to: PeerId; payload: SignalPayload }
  | { type: "telemetry-fallback"; sample: TelemetrySample }
  | { type: "game"; to: PeerId | "host"; payload: GameMessage };

/** server → client */
export type ServerMessage =
  | { type: "welcome"; peerId: PeerId; role: Role; peers: PeerInfo[] }
  | { type: "room-busy" }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peerId: PeerId }
  | { type: "signal"; from: PeerId; payload: SignalPayload }
  | { type: "telemetry-fallback"; from: PeerId; sample: TelemetrySample }
  | { type: "game"; from: PeerId; payload: GameMessage };

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

export function isGameMessage(v: unknown): v is GameMessage {
  if (!isRec(v)) return false;
  switch (v.kind) {
    case "aim-lock":
      return typeof v.aimDeg === "number";
    case "aim-unlock":
      return true;
    case "club":
      return v.club === "driver" || v.club === "iron" || v.club === "wedge" || v.club === "putter";
    case "profile":
      // Name: user-chosen, uncapped in content by design; only sanity-bounded.
      // Face: small data-URL (client downsizes to 96px) — cap under the
      // 48KB RTCDataChannel ceiling so profiles never take the slow path.
      return (
        typeof v.name === "string" &&
        v.name.length <= 24 &&
        (v.face === undefined || (typeof v.face === "string" && v.face.length <= 40_000 && v.face.startsWith("data:image/")))
      );
    case "swing":
      return typeof v.power === "number" && typeof v.faceDeg === "number" && typeof v.backspin === "number";
    case "turn":
      return typeof v.yourTurn === "boolean" && typeof v.strokeIndex === "number" && typeof v.club === "string" && typeof v.distToCup === "number";
    case "stroke-result":
      return (v.outcome === "stopped" || v.outcome === "holed" || v.outcome === "oob") && typeof v.distToCup === "number";
    case "hole-start":
      return typeof v.index === "number" && typeof v.total === "number" && typeof v.par === "number";
    case "hole-finished":
      return Array.isArray(v.scores);
    case "course-finished":
      return Array.isArray(v.totals);
    default:
      return false;
  }
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
    case "game":
      return typeof v.from === "string" && isGameMessage(v.payload);
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
    case "game":
      return typeof v.to === "string" && isGameMessage(v.payload);
    default:
      return false;
  }
}
