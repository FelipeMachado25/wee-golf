import type * as Party from "partykit/server";
import type { ClientMessage, ServerMessage, PeerInfo, PeerId, Role } from "../lib/networking/partykit/protocol";
import { isClientMessage } from "../lib/networking/partykit/protocol";

type ConnState = PeerInfo;

/** One game room. The host connects first (it generated the roomId and shows
 *  the QR); controllers join by scanning. The server only does presence and a
 *  TARGETED signal relay — once WebRTC is up, telemetry bypasses it entirely,
 *  except for the telemetry-fallback path when P2P cannot be established. */
export default class WeeGolfRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection<ConnState>, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const role: Role = url.searchParams.get("role") === "host" ? "host" : "controller";
    const peerId = url.searchParams.get("peerId") ?? conn.id;

    // D1: a room has exactly one host. A second host means a roomId collision —
    // it gets told to regenerate and retry.
    if (role === "host" && this.findHost()) {
      this.send(conn, { type: "room-busy" });
      conn.close(4001, "room-busy");
      return;
    }

    const info: ConnState = { peerId, role, joinedAt: Date.now() };
    conn.setState(info);

    this.send(conn, { type: "welcome", peerId, role, peers: this.peers(peerId) });
    this.broadcastExcept(peerId, { type: "peer-joined", peer: info });
  }

  onMessage(raw: string | ArrayBuffer, sender: Party.Connection<ConnState>) {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isClientMessage(parsed)) return;
    const msg: ClientMessage = parsed;
    const from = sender.state?.peerId;
    if (!from) return;

    if (msg.type === "signal") {
      // D4: targeted relay — SDP/ICE go to exactly one peer, never broadcast.
      const target = this.findByPeerId(msg.to);
      if (target) this.send(target, { type: "signal", from, payload: msg.payload });
      return;
    }

    if (msg.type === "telemetry-fallback") {
      const host = this.findHost();
      if (host) this.send(host, { type: "telemetry-fallback", from, sample: msg.sample });
    }
  }

  onClose(conn: Party.Connection<ConnState>) {
    const peerId = conn.state?.peerId;
    if (peerId) this.broadcastExcept(peerId, { type: "peer-left", peerId });
  }

  // --- helpers -------------------------------------------------------------

  private connections(): Party.Connection<ConnState>[] {
    return [...this.room.getConnections<ConnState>()];
  }

  private peers(excludePeerId: PeerId): PeerInfo[] {
    return this.connections()
      .map((c) => c.state)
      .filter((s): s is ConnState => s != null && s.peerId !== excludePeerId);
  }

  private findHost(): Party.Connection<ConnState> | undefined {
    return this.connections().find((c) => c.state?.role === "host");
  }

  private findByPeerId(peerId: PeerId): Party.Connection<ConnState> | undefined {
    return this.connections().find((c) => c.state?.peerId === peerId);
  }

  private send(conn: Party.Connection<ConnState>, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastExcept(peerId: PeerId, msg: ServerMessage) {
    for (const c of this.connections()) {
      if (c.state?.peerId !== peerId) this.send(c, msg);
    }
  }
}
