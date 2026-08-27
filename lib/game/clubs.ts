import type { HoleDef, Surface } from "./terrain";
import { launch, step } from "./physics";

/** Real-golf club set. The putter is special: no flight at all — the ball is
 *  launched directly into the rolling phase, which is what makes short game
 *  and putting controllable (a flight swing tuned for 90m can't do 3m). */
export type ClubId = "driver" | "iron" | "wedge" | "putter";

export type Club = {
  id: ClubId;
  label: string;
  loftDeg: number; // launch angle
  vMax: number; // m/s at power 1
  rollsOnly: boolean;
};

export const CLUBS: Record<ClubId, Club> = {
  driver: { id: "driver", label: "Driver", loftDeg: 14, vMax: 40, rollsOnly: false },
  iron: { id: "iron", label: "Iron", loftDeg: 30, vMax: 27, rollsOnly: false },
  wedge: { id: "wedge", label: "Wedge", loftDeg: 52, vMax: 18, rollsOnly: false },
  putter: { id: "putter", label: "Putter", loftDeg: 0, vMax: 4, rollsOnly: true },
};

export const CLUB_ORDER: ClubId[] = ["driver", "iron", "wedge", "putter"];

// ---------------------------------------------------------------------------
// Honest range numbers: the "max distance" shown in the UI is measured by
// simulating a full-power stroke on flat reference ground with the real
// physics, not hand-typed. Cached per club.
// ---------------------------------------------------------------------------

const FLAT: HoleDef = {
  id: "flat-reference",
  par: 3,
  bounds: { w: 1000, l: 1000 },
  height: () => 0,
  surfaceAt: (): Surface => "fairway",
  tee: { x: 0, y: 0, z: 0 },
  cup: { x: 0, z: 999, r: 0.11 }, // far away — never captures during the probe
};

const GREEN_FLAT: HoleDef = { ...FLAT, surfaceAt: () => "green" };

const rangeCache = new Map<ClubId, number>();

export function estimateMaxDistance(club: ClubId): number {
  const cached = rangeCache.get(club);
  if (cached != null) return cached;
  const hole = CLUBS[club].rollsOnly ? GREEN_FLAT : FLAT; // putts are read on greens
  let b = launch({ x: 0, y: 0, z: 0 }, { power: 1, aimDeg: 0, faceDeg: 0, club });
  const dt = 1 / 120;
  let t = 0;
  while (b.phase !== "stopped" && b.phase !== "holed" && t < 60) {
    b = step(hole, b, dt);
    t += dt;
  }
  const dist = Math.round(b.pos.z);
  rangeCache.set(club, dist);
  return dist;
}

/** Pick the shortest club that still covers the distance (with 10% headroom).
 *  On the green — or inside comfortable putting range — always the putter. */
export function suggestClub(distToCup: number, surface: Surface): ClubId {
  if (surface === "green") return "putter";
  if (distToCup <= estimateMaxDistance("putter")) return "putter";
  if (distToCup <= estimateMaxDistance("wedge") * 1.1) return "wedge";
  if (distToCup <= estimateMaxDistance("iron") * 1.1) return "iron";
  return "driver";
}
