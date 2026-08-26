import { describe, it, expect } from "vitest";
import { HOLE_ONE, surfaceNormal } from "./terrain";
import { len } from "./vec";

const rnd = (min: number, max: number) => min + Math.random() * (max - min);

describe("HOLE_ONE", () => {
  it("has sane geometry: tee and cup inside bounds, apart from each other", () => {
    const { bounds, tee, cup } = HOLE_ONE;
    expect(Math.abs(tee.x)).toBeLessThan(bounds.w / 2);
    expect(tee.z).toBeGreaterThan(0);
    expect(Math.abs(cup.x)).toBeLessThan(bounds.w / 2);
    expect(cup.z).toBeLessThan(bounds.l);
    expect(cup.z - tee.z).toBeGreaterThan(50); // it's a real hole, not a putt
  });

  it("tee sits on tee surface and cup on green", () => {
    expect(HOLE_ONE.surfaceAt(HOLE_ONE.tee.x, HOLE_ONE.tee.z)).toBe("tee");
    expect(HOLE_ONE.surfaceAt(HOLE_ONE.cup.x, HOLE_ONE.cup.z)).toBe("green");
  });

  it("outside the bounds is oob", () => {
    expect(HOLE_ONE.surfaceAt(HOLE_ONE.bounds.w, 10)).toBe("oob");
    expect(HOLE_ONE.surfaceAt(0, -5)).toBe("oob");
    expect(HOLE_ONE.surfaceAt(0, HOLE_ONE.bounds.l + 1)).toBe("oob");
  });

  it("height is finite and continuous across the playfield", () => {
    for (let i = 0; i < 500; i++) {
      const x = rnd(-HOLE_ONE.bounds.w / 2, HOLE_ONE.bounds.w / 2);
      const z = rnd(0, HOLE_ONE.bounds.l);
      const h = HOLE_ONE.height(x, z);
      expect(Number.isFinite(h)).toBe(true);
      // continuity: a 1cm step never jumps more than 5cm in height
      expect(Math.abs(HOLE_ONE.height(x + 0.01, z) - h)).toBeLessThan(0.05);
      expect(Math.abs(HOLE_ONE.height(x, z + 0.01) - h)).toBeLessThan(0.05);
    }
  });

  it("tee position rests on the terrain", () => {
    expect(HOLE_ONE.tee.y).toBeCloseTo(HOLE_ONE.height(HOLE_ONE.tee.x, HOLE_ONE.tee.z), 3);
  });
});

describe("surfaceNormal", () => {
  it("returns unit vectors pointing upward", () => {
    for (let i = 0; i < 200; i++) {
      const x = rnd(-HOLE_ONE.bounds.w / 2, HOLE_ONE.bounds.w / 2);
      const z = rnd(0, HOLE_ONE.bounds.l);
      const n = surfaceNormal(HOLE_ONE, x, z);
      expect(len(n)).toBeCloseTo(1, 5);
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it("is vertical on flat ground far from features", () => {
    // The far-corner rough is nearly flat: normal ≈ +y
    const n = surfaceNormal(HOLE_ONE, -13, 15);
    expect(n.y).toBeGreaterThan(0.95);
  });
});
