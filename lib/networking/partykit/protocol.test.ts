import { describe, it, expect } from "vitest";
import { isServerMessage, isClientMessage } from "./protocol";

describe("isServerMessage", () => {
  it("accepts a welcome message", () => {
    expect(isServerMessage({ type: "welcome", peerId: "a", role: "host", peers: [] })).toBe(true);
  });
  it("accepts a relayed signal", () => {
    expect(isServerMessage({ type: "signal", from: "a", payload: { kind: "offer", sdp: "v=0" } })).toBe(true);
  });
  it("rejects unknown types", () => {
    expect(isServerMessage({ type: "nope" })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage("welcome")).toBe(false);
  });
});

describe("isClientMessage", () => {
  it("accepts a directed signal", () => {
    expect(
      isClientMessage({
        type: "signal",
        to: "b",
        payload: { kind: "ice", candidate: { candidate: "", sdpMid: null, sdpMLineIndex: null } },
      }),
    ).toBe(true);
  });
  it("rejects a signal without a target", () => {
    expect(isClientMessage({ type: "signal", payload: { kind: "answer", sdp: "v=0" } })).toBe(false);
  });
});
