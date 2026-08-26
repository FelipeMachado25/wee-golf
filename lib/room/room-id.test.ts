import { describe, it, expect } from "vitest";
import { generateRoomId, normalizeRoomId, ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from "./room-id";

describe("generateRoomId", () => {
  it("returns an id of the configured length", () => {
    expect(generateRoomId()).toHaveLength(ROOM_ID_LENGTH);
  });

  it("only uses characters from the alphabet", () => {
    for (let i = 0; i < 500; i++) {
      for (const ch of generateRoomId()) {
        expect(ROOM_ID_ALPHABET).toContain(ch);
      }
    }
  });

  it("never emits visually ambiguous characters", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateRoomId()).not.toMatch(/[01OIL]/);
    }
  });

  it("produces distinct ids across many draws", () => {
    const seen = new Set(Array.from({ length: 1000 }, generateRoomId));
    expect(seen.size).toBeGreaterThan(990);
  });
});

describe("normalizeRoomId", () => {
  it("uppercases and strips characters outside the alphabet", () => {
    expect(normalizeRoomId(" a2-b3 ")).toBe("A2B3");
  });
});
