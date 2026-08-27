import { describe, it, expect } from "vitest";
import { generateCourse } from "./course";
import { surfaceNormal } from "./terrain";
import { launch, step } from "./physics";
import { len } from "./vec";

const SEEDS = [1, 7, 42, 1234, 987654];

describe("generateCourse", () => {
  it("is deterministic for a given seed and varies across seeds", () => {
    const a = generateCourse(42, 3);
    const b = generateCourse(42, 3);
    const c = generateCourse(43, 3);
    expect(a.map((h) => h.cup)).toEqual(b.map((h) => h.cup));
    expect(a.map((h) => h.cup)).not.toEqual(c.map((h) => h.cup));
  });

  it("produces the requested number of holes with pars 3 or 4", () => {
    for (const n of [3, 6, 9]) {
      const course = generateCourse(7, n);
      expect(course).toHaveLength(n);
      for (const h of course) expect([3, 4]).toContain(h.par);
    }
  });

  it("every hole is well-formed: tee on tee, cup on green, apart, in bounds", () => {
    for (const seed of SEEDS) {
      for (const h of generateCourse(seed, 3)) {
        expect(h.surfaceAt(h.tee.x, h.tee.z)).toBe("tee");
        expect(h.surfaceAt(h.cup.x, h.cup.z)).toBe("green");
        expect(h.cup.z - h.tee.z).toBeGreaterThan(40);
        expect(Math.abs(h.cup.x)).toBeLessThan(h.bounds.w / 2);
        expect(h.tee.y).toBeCloseTo(h.height(h.tee.x, h.tee.z), 3);
      }
    }
  });

  it("heightfields stay finite, continuous, and walkable on every hole", () => {
    for (const seed of SEEDS.slice(0, 2)) {
      for (const h of generateCourse(seed, 3)) {
        for (let i = 0; i < 150; i++) {
          const x = (Math.random() - 0.5) * h.bounds.w;
          const z = Math.random() * h.bounds.l;
          const y = h.height(x, z);
          expect(Number.isFinite(y)).toBe(true);
          expect(Math.abs(h.height(x + 0.01, z) - y)).toBeLessThan(0.05);
          const n = surfaceNormal(h, x, z);
          expect(len(n)).toBeCloseTo(1, 5);
          expect(n.y).toBeGreaterThan(0);
        }
      }
    }
  });

  it("a straight mid-power stroke settles on every generated hole", () => {
    const DT = 1 / 120;
    for (const h of generateCourse(42, 3)) {
      let b = launch(h.tee, { power: 0.6, aimDeg: 0, faceDeg: 0 });
      let t = 0;
      while (b.phase !== "stopped" && b.phase !== "holed" && t < 60) {
        b = step(h, b, DT);
        t += DT;
      }
      expect(t).toBeLessThan(60);
    }
  });
});
