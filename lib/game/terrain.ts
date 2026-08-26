import { norm, vec, type Vec3 } from "./vec";

export type Surface = "tee" | "fairway" | "green" | "rough" | "bunker" | "oob";

export interface HoleDef {
  id: string;
  par: number;
  bounds: { w: number; l: number }; // x ∈ [-w/2, w/2], z ∈ [0, l]
  height(x: number, z: number): number;
  surfaceAt(x: number, z: number): Surface;
  tee: Vec3;
  cup: { x: number; z: number; r: number };
}

/** Central differences over the heightfield. Always unit-length, y > 0. */
export function surfaceNormal(h: HoleDef, x: number, z: number): Vec3 {
  const eps = 0.05;
  const dx = (h.height(x + eps, z) - h.height(x - eps, z)) / (2 * eps);
  const dz = (h.height(x, z + eps) - h.height(x, z - eps)) / (2 * eps);
  return norm(vec(-dx, 1, -dz));
}

// ---------------------------------------------------------------------------
// HOLE_ONE — fixed par-3, ~90m. Defined analytically (no assets): a gentle
// valley fairway between two mounds, a raised green plateau, two bunkers.
// Phase 2B's procedural generator replaces this behind the same HoleDef.
// ---------------------------------------------------------------------------

const gauss = (x: number, z: number, cx: number, cz: number, sx: number, sz: number, amp: number) =>
  amp * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));

const CUP = { x: 2, z: 88, r: 0.11 };
const GREEN_R = 6.5;
const BUNKERS: { x: number; z: number; r: number }[] = [
  { x: -5.5, z: 80, r: 2.6 },
  { x: 7.5, z: 84, r: 2.2 },
];

function heightOne(x: number, z: number): number {
  let h = 0;
  h += z * 0.008; // gentle overall rise toward the green
  h += gauss(x, z, -11, 45, 6, 18, 1.6); // left mound
  h += gauss(x, z, 12, 30, 7, 16, 1.3); // right mound
  h += gauss(x, z, CUP.x, CUP.z, 9, 8, 0.9); // raised green plateau
  h += gauss(x, z, 0, 12, 10, 8, 0.25); // slight tee-box shelf
  for (const b of BUNKERS) h -= gauss(x, z, b.x, b.z, b.r, b.r, 0.35); // sand depressions
  return h;
}

function surfaceOne(x: number, z: number): Surface {
  const W = 30;
  const L = 100;
  if (x < -W / 2 || x > W / 2 || z < 0 || z > L) return "oob";
  for (const b of BUNKERS) {
    if (Math.hypot(x - b.x, z - b.z) < b.r) return "bunker";
  }
  if (Math.hypot(x - CUP.x, z - CUP.z) < GREEN_R) return "green";
  if (Math.hypot(x - 0, z - 4) < 2.5) return "tee";
  if (Math.abs(x) < 7 && z > 2 && z < 92) return "fairway";
  return "rough";
}

export const HOLE_ONE: HoleDef = {
  id: "hole-1",
  par: 3,
  bounds: { w: 30, l: 100 },
  height: heightOne,
  surfaceAt: surfaceOne,
  tee: { x: 0, y: heightOne(0, 4), z: 4 },
  cup: CUP,
};
