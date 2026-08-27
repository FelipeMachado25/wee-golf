import { createRng } from "./rng";
import type { HoleDef, Surface } from "./terrain";

/** Parametric hole generator — same analytic-gaussian recipe as HOLE_ONE, with
 *  seeded variety: length/par, lateral dogleg, mounds, bunkers, green size.
 *  Everything a hole exposes goes through the HoleDef contract, so the rest of
 *  the game never knows whether a hole was handcrafted or generated. */

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number, amp: number) =>
  amp * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

type Mound = { cx: number; cz: number; sx: number; sz: number; amp: number };
type Bunker = { x: number; z: number; r: number };

export function generateCourse(seed: number, holeCount: number): HoleDef[] {
  const rng = createRng(seed);
  return Array.from({ length: holeCount }, (_, i) => generateHole(rng, seed, i));
}

function generateHole(rng: () => number, seed: number, index: number): HoleDef {
  const par = rng() < 0.6 ? 3 : 4;
  const length = par === 3 ? 70 + rng() * 40 : 105 + rng() * 35;
  const w = 28 + rng() * 8;

  const cup = {
    x: (rng() - 0.5) * (w * 0.45), // lateral dogleg target
    z: length - 10 - rng() * 4,
    r: 0.11,
  };
  const greenR = 5 + rng() * 2.5;

  const mounds: Mound[] = Array.from({ length: 2 + Math.floor(rng() * 3) }, () => ({
    cx: (rng() - 0.5) * w * 0.9,
    cz: 15 + rng() * (length - 35),
    sx: 5 + rng() * 4,
    sz: 8 + rng() * 10,
    amp: 0.8 + rng() * 1.2,
  }));

  const bunkers: Bunker[] = Array.from({ length: Math.floor(rng() * 3) }, () => {
    const angle = rng() * Math.PI * 2;
    const dist = greenR + 1.5 + rng() * 2.5;
    return {
      x: clamp(cup.x + Math.cos(angle) * dist, -w / 2 + 2, w / 2 - 2),
      z: clamp(cup.z + Math.sin(angle) * dist, 10, length - 6),
      r: 1.8 + rng() * 1.2,
    };
  });

  const greenAmp = 0.7 + rng() * 0.5;
  const baseSlope = 0.005 + rng() * 0.004;
  const tee = { x: 0, z: 4 };

  function height(x: number, z: number): number {
    let h = z * baseSlope;
    for (const m of mounds) h += gauss(x, z, m.cx, m.cz, m.sx, m.sz, m.amp);
    h += gauss(x, z, cup.x, cup.z, greenR + 2.5, greenR + 1.5, greenAmp);
    h += gauss(x, z, tee.x, tee.z + 8, 10, 8, 0.25);
    for (const b of bunkers) h -= gauss(x, z, b.x, b.z, b.r, b.r, 0.35);
    return h;
  }

  /** Lateral distance to the tee→cup centerline, for the fairway corridor. */
  function offCenter(x: number, z: number): number {
    const t = clamp((z - tee.z) / Math.max(1, cup.z - tee.z), 0, 1);
    return Math.abs(x - (tee.x + (cup.x - tee.x) * t));
  }

  function surfaceAt(x: number, z: number): Surface {
    if (x < -w / 2 || x > w / 2 || z < 0 || z > length) return "oob";
    for (const b of bunkers) if (Math.hypot(x - b.x, z - b.z) < b.r) return "bunker";
    if (Math.hypot(x - cup.x, z - cup.z) < greenR) return "green";
    if (Math.hypot(x - tee.x, z - tee.z) < 2.5) return "tee";
    if (offCenter(x, z) < 7 && z > 2 && z < cup.z + 4) return "fairway";
    return "rough";
  }

  return {
    id: `seed${seed}-hole${index + 1}`,
    par,
    bounds: { w, l: length },
    height,
    surfaceAt,
    tee: { x: tee.x, y: height(tee.x, tee.z), z: tee.z },
    cup,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
