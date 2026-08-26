import PartySocket from "partysocket";
import type { ClientMessage, PeerId, Role, ServerMessage } from "./protocol";
import { isServerMessage } from "./protocol";

/** Typed wrapper around PartySocket. Inbound messages are validated at runtime
 *  (never blind-cast network data); anything that fails the guard is dropped.
 *  PartySocket already reconnects with backoff — we do not reimplement that. */
export function connectRoom(args: {
  roomId: string;
  role: Role;
  peerId: PeerId;
  onMessage: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}) {
  const socket = new PartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "127.0.0.1:1999",
    room: args.roomId,
    query: { role: args.role, peerId: args.peerId },
  });

  socket.addEventListener("message", (e) => {
    if (typeof e.data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(e.data);
    } catch {
      return;
    }
    if (isServerMessage(parsed)) args.onMessage(parsed);
  });
  if (args.onOpen) socket.addEventListener("open", args.onOpen);
  if (args.onClose) socket.addEventListener("close", args.onClose);

  return {
    socket,
    send: (msg: ClientMessage) => socket.send(JSON.stringify(msg)),
    close: () => socket.close(),
  };
}

export type RoomConnection = ReturnType<typeof connectRoom>;
