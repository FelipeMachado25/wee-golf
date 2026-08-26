/** 32 characters, no 0/O/1/I/L, so an id can be read aloud or typed without
 *  ambiguity. Being 32 (a power of two dividing 256) makes the modulo over
 *  random bytes uniform — no bias. */
export const ROOM_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_ID_LENGTH = 6;

export function generateRoomId(): string {
  const bytes = new Uint8Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ROOM_ID_ALPHABET[b % ROOM_ID_ALPHABET.length];
  return out;
}

export function normalizeRoomId(raw: string): string {
  return Array.from(raw.toUpperCase())
    .filter((ch) => ROOM_ID_ALPHABET.includes(ch))
    .join("");
}
