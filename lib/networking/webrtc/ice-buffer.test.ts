import { describe, it, expect, vi } from "vitest";
import { createIceBuffer } from "./ice-buffer";
import type { IceCandidateInit } from "../partykit/protocol";

const cand = (n: string): IceCandidateInit => ({ candidate: n, sdpMid: "0", sdpMLineIndex: 0 });

describe("createIceBuffer", () => {
  it("buffers candidates until the remote description is set", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const buf = createIceBuffer(apply);
    await buf.add(cand("a"));
    await buf.add(cand("b"));
    expect(apply).not.toHaveBeenCalled();
    expect(buf.pendingCount).toBe(2);
  });

  it("flushes buffered candidates in arrival order", async () => {
    const seen: string[] = [];
    const buf = createIceBuffer(async (c) => {
      seen.push(c.candidate);
    });
    await buf.add(cand("a"));
    await buf.add(cand("b"));
    await buf.markRemoteDescriptionSet();
    expect(seen).toEqual(["a", "b"]);
    expect(buf.pendingCount).toBe(0);
  });

  it("applies immediately once flushed", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const buf = createIceBuffer(apply);
    await buf.markRemoteDescriptionSet();
    await buf.add(cand("c"));
    expect(apply).toHaveBeenCalledOnce();
    expect(buf.pendingCount).toBe(0);
  });
});
