import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limiter";

describe("createRateLimiter", () => {
  it("allows the first sample immediately", () => {
    expect(createRateLimiter(60)(0)).toBe(true);
  });

  it("rejects samples arriving faster than the target rate", () => {
    const limit = createRateLimiter(60); // ~16.67ms
    expect(limit(0)).toBe(true);
    expect(limit(5)).toBe(false);
    expect(limit(10)).toBe(false);
  });

  it("allows a sample once the interval has elapsed", () => {
    const limit = createRateLimiter(60);
    expect(limit(0)).toBe(true);
    expect(limit(17)).toBe(true);
  });

  it("measures the interval from the last accepted sample, not from now", () => {
    const limit = createRateLimiter(60);
    limit(0);
    limit(10); // rejected — must not move the reference point
    expect(limit(17)).toBe(true);
  });
});
