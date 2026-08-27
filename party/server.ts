import { Server, routePartykitRequest, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import type { ClientMessage, ServerMessage, PeerInfo, PeerId, Role } from "../lib/networking/partykit/protocol";
import { isClientMessage } from "../lib/networking/partykit/protocol";

type ConnState = PeerInfo;

type Env = {
  WeeGolfRoom: DurableObjectNamespace;
};

/** One game room, running as a Durable Object via partyserver (the maintained
 *  successor of PartyKit — its hosted platform hit Cloudflare's shared-zone
 *  domain limit, so we deploy to our own Workers account instead).
 *
 *  The host connects first (it generated the roomId and shows the QR);
 *  controllers join by scanning. The server only does presence and a TARGETED
 *  signal relay — once WebRTC is up, telemetry bypasses it entirely, except
 *  for the telemetry-fallback path when P2P cannot be established. */
export class WeeGolfRoom extends Server<Env> {
  onConnect(conn: Connection<ConnState>, ctx: ConnectionContext) {
    const url = new URL(ctx.request.url);
    const role: Role = url.searchParams.get("role") === "host" ? "host" : "controller";
    const peerId = url.searchParams.get("peerId") ?? conn.id;

    // D1: a room has exactly one host. A second host means a roomId collision —
    // it gets told to regenerate and retry.
    if (role === "host" && this.findHost()) {
      this.sendTo(conn, { type: "room-busy" });
      conn.close(4001, "room-busy");
      return;
    }

    const info: ConnState = { peerId, role, joinedAt: Date.now() };
    conn.setState(info);

    this.sendTo(conn, { type: "welcome", peerId, role, peers: this.peers(peerId) });
    this.broadcastExcept(peerId, { type: "peer-joined", peer: info });
  }

  onMessage(sender: Connection<ConnState>, raw: WSMessage) {
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
      if (target) this.sendTo(target, { type: "signal", from, payload: msg.payload });
      return;
    }

    if (msg.type === "telemetry-fallback") {
      const host = this.findHost();
      if (host) this.sendTo(host, { type: "telemetry-fallback", from, sample: msg.sample });
      return;
    }

    if (msg.type === "game") {
      // Reliable game events over the WS fallback path. "host" resolves to
      // whoever holds the host role so controllers need no peerId lookup.
      const target = msg.to === "host" ? this.findHost() : this.findByPeerId(msg.to);
      if (target) this.sendTo(target, { type: "game", from, payload: msg.payload });
    }
  }

  onClose(conn: Connection<ConnState>) {
    const peerId = conn.state?.peerId;
    if (peerId) this.broadcastExcept(peerId, { type: "peer-left", peerId });
  }

  // --- helpers -------------------------------------------------------------

  private connections(): Connection<ConnState>[] {
    return [...this.getConnections<ConnState>()];
  }

  private peers(excludePeerId: PeerId): PeerInfo[] {
    return this.connections()
      .map((c) => c.state)
      .filter((s): s is ConnState => s != null && s.peerId !== excludePeerId);
  }

  private findHost(): Connection<ConnState> | undefined {
    return this.connections().find((c) => c.state?.role === "host");
  }

  private findByPeerId(peerId: PeerId): Connection<ConnState> | undefined {
    return this.connections().find((c) => c.state?.peerId === peerId);
  }

  private sendTo(conn: Connection<ConnState>, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastExcept(peerId: PeerId, msg: ServerMessage) {
    for (const c of this.connections()) {
      if (c.state?.peerId !== peerId) this.sendTo(c, msg);
    }
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routePartykitRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
};

export default worker;
