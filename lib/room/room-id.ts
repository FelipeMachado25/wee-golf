/** 31 characters: digits 2-9 plus uppercase letters minus O/I/L, so an id can
 *  be read aloud or typed without ambiguity (0/O, 1/I/L). 31 does not divide
 *  256, so plain modulo over random bytes would be biased — we use rejection
 *  sampling instead: discard bytes >= 248 (the largest multiple of 31 <= 256),
 *  then modulo is exactly uniform. */
export const ROOM_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_ID_LENGTH = 6;

const REJECTION_LIMIT = 256 - (256 % ROOM_ID_ALPHABET.length); // 248

export function generateRoomId(): string {
  let out = "";
  while (out.length < ROOM_ID_LENGTH) {
    const bytes = new Uint8Array(ROOM_ID_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= REJECTION_LIMIT) continue;
      out += ROOM_ID_ALPHABET[b % ROOM_ID_ALPHABET.length];
      if (out.length === ROOM_ID_LENGTH) break;
    }
  }
  return out;
}

export function normalizeRoomId(raw: string): string {
  return Array.from(raw.toUpperCase())
    .filter((ch) => ROOM_ID_ALPHABET.includes(ch))
    .join("");
}
