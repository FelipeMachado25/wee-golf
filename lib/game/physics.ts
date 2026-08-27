import { add, cross, dot, len, norm, scale, sub, vec, type Vec3 } from "./vec";
import { surfaceNormal, type HoleDef, type Surface } from "./terrain";

export type BallPhase = "flying" | "rolling" | "stopped" | "holed";

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3; // angular velocity, rad/s
  phase: BallPhase;
}

export interface StrokeInput {
  power: number; // 0..1
  aimDeg: number; // 0 = +z (toward the hole), positive = right
  faceDeg: number; // clubface offset → sidespin/curve, clamped ±10 upstream
  backspin?: number; // 0..1 — dead-stop swing (Wii style): lift + bite on landing
}

/** All tuning in one place — Checkpoint F edits THIS object, nothing else. */
export const PHYS = {
  G: 9.81,
  V_MAX: 32, // m/s at power 1
  LOFT_DEG: 18,
  KD: 0.02, // quadratic air drag coefficient
  KM: 0.0004, // magnus coefficient
  SIDESPIN_MAX: 90, // rad/s at faceDeg 10
  BACKSPIN_RATE: 200, // rad/s at backspin 1
  SPIN_BITE: 0.006, // how hard backspin kills tangential velocity on a bounce
  STOP_SPEED: 0.08,
  CAPTURE_SPEED: 1.6,
  ROLL_TRANSITION_VN: 0.6, // bounce weaker than this (m/s normal) → start rolling
  SPIN_DECAY: 0.985, // per bounce+per rolling step factor
  E: { green: 0.35, fairway: 0.4, rough: 0.25, bunker: 0.05, tee: 0.4, oob: 0.3 } as Record<Surface, number>,
  MU: { green: 0.05, fairway: 0.12, rough: 0.3, bunker: 0.45, tee: 0.1, oob: 0.2 } as Record<Surface, number>,
};

export function launch(from: Vec3, input: StrokeInput): BallState {
  const speed = Math.max(0, Math.min(1, input.power)) * PHYS.V_MAX;
  const loft = (PHYS.LOFT_DEG * Math.PI) / 180;
  const aim = (input.aimDeg * Math.PI) / 180;
  const horizontal = speed * Math.cos(loft);
  const dir = vec(Math.sin(aim), 0, Math.cos(aim));
  // Sidespin: positive faceDeg curves right (+x) — ŷ×ẑ = x̂.
  // Backspin: ω = rate·(dir×ŷ) gives (dir×ŷ)×v ∝ +ŷ, i.e. magnus lift.
  const back = scale(cross(dir, vec(0, 1, 0)), (input.backspin ?? 0) * PHYS.BACKSPIN_RATE);
  return {
    pos: { ...from, y: from.y + 0.03 },
    vel: vec(horizontal * dir.x, speed * Math.sin(loft), horizontal * dir.z),
    spin: add(vec(0, (input.faceDeg / 10) * PHYS.SIDESPIN_MAX, 0), back),
    phase: "flying",
  };
}

/** One fixed-timestep integration step. Pure: returns a new state. */
export function step(hole: HoleDef, b: BallState, dt: number): BallState {
  if (b.phase === "stopped" || b.phase === "holed") return b;
  return b.phase === "flying" ? stepFlight(hole, b, dt) : stepRolling(hole, b, dt);
}

function stepFlight(hole: HoleDef, b: BallState, dt: number): BallState {
  // a = gravity + quadratic drag + magnus lift
  const speed = len(b.vel);
  const drag = scale(b.vel, -PHYS.KD * speed);
  const magnus = scale(cross(b.spin, b.vel), PHYS.KM);
  const acc = add(vec(0, -PHYS.G, 0), add(drag, magnus));
  const vel = add(b.vel, scale(acc, dt));
  const pos = add(b.pos, scale(vel, dt));

  const ground = hole.height(pos.x, pos.z);
  if (pos.y > ground) return { ...b, pos, vel };

  // Impact: reflect against the local surface normal.
  const surface = hole.surfaceAt(pos.x, pos.z);
  const n = surfaceNormal(hole, pos.x, pos.z);
  const vn = dot(vel, n);
  const vNormal = scale(n, vn);
  const vTangent = sub(vel, vNormal);
  const e = PHYS.E[surface];
  // Backspin bites: the spin component along (travel×ŷ) opposes the roll and
  // eats tangential velocity at the bounce (a strong bite can pull it back).
  const travel = norm(vec(vel.x, 0, vel.z));
  const backAmount = dot(b.spin, cross(travel, vec(0, 1, 0)));
  const tangentialKeep = Math.max(-0.2, Math.min(0.75, 0.75 - PHYS.SPIN_BITE * backAmount));
  const bounced = add(scale(vNormal, -e), scale(vTangent, tangentialKeep));
  const spin = scale(b.spin, PHYS.SPIN_DECAY);
  const rest = { x: pos.x, y: ground, z: pos.z };

  if (Math.abs(vn) * e < PHYS.ROLL_TRANSITION_VN) {
    // Too weak to bounce again: project velocity onto the surface and roll.
    const vSurf = sub(bounced, scale(n, dot(bounced, n)));
    return { pos: rest, vel: vSurf, spin, phase: "rolling" };
  }
  return { pos: rest, vel: bounced, spin, phase: "flying" };
}

function stepRolling(hole: HoleDef, b: BallState, dt: number): BallState {
  const surface = hole.surfaceAt(b.pos.x, b.pos.z);
  const n = surfaceNormal(hole, b.pos.x, b.pos.z);

  // Downslope gravity component (gravity minus its normal part) …
  const gVec = vec(0, -PHYS.G, 0);
  const gSlope = sub(gVec, scale(n, dot(gVec, n)));
  // … minus rolling friction opposing motion.
  const speed = len(b.vel);
  const friction = speed > 1e-6 ? scale(norm(b.vel), -PHYS.MU[surface] * PHYS.G) : vec();

  let vel = add(b.vel, scale(add(gSlope, friction), dt));
  // friction can't reverse the direction of motion within a step
  if (dot(vel, b.vel) < 0) vel = vec();

  let pos = add(b.pos, scale(vel, dt));
  pos = { x: pos.x, y: hole.height(pos.x, pos.z), z: pos.z };
  const spin = scale(b.spin, PHYS.SPIN_DECAY);

  // Cup capture: near the cup and slow enough → in. Fast → rolls over.
  const dCup = Math.hypot(pos.x - hole.cup.x, pos.z - hole.cup.z);
  if (dCup < hole.cup.r && len(vel) < PHYS.CAPTURE_SPEED) {
    return { pos, vel: vec(), spin: vec(), phase: "holed" };
  }

  if (len(vel) < PHYS.STOP_SPEED) {
    // Only truly stop on gentle ground; steep slopes keep it rolling.
    if (n.y > 0.94) return { pos, vel: vec(), spin: vec(), phase: "stopped" };
  }
  return { pos, vel, spin, phase: "rolling" };
}
