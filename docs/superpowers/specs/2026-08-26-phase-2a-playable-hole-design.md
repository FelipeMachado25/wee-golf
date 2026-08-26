# Phase 2A — Playable Hole: Design Spec

Approved in chat 2026-08-26. Presentation: **3D low-poly** (three.js / react-three-fiber).
Mechanic: **real gestural swing** (phone held like a club). Multiplayer: **classic turns**.
Architecture: **host-authoritative custom analytic physics**; swing detected **on the phone**.

Out of scope for 2A: procedural course (2B), avatars/polish (2C), TURN servers, binary
telemetry. One fixed hole, playable end-to-end by 1–4 phones.

## 1. Units, axes, world

Meters, Y-up. The hole lays along +Z from tee to cup. Fixed timestep simulation at
**120Hz** (`dt = 1/120`), decoupled from render (accumulator in the rAF loop).
Ball radius 0.03 (gameplay-scaled, not regulation). Gravity 9.81.

## 2. `lib/game/` — pure, tested modules

All simulation code is plain TS with no DOM/three imports, tested with Vitest.

### 2.1 `terrain.ts`

```ts
export type Surface = "tee" | "fairway" | "green" | "rough" | "bunker" | "oob";
export type Vec3 = { x: number; y: number; z: number };

export interface HoleDef {
  id: string;
  par: number;
  bounds: { w: number; l: number };          // playfield extents (x ∈ [-w/2,w/2], z ∈ [0,l])
  height(x: number, z: number): number;      // smooth heightfield
  surfaceAt(x: number, z: number): Surface;
  tee: Vec3;
  cup: { x: number; z: number; r: number };  // r ≈ 0.11
}

export const HOLE_ONE: HoleDef;              // fixed par-3, ~90m: valley fairway,
                                             // raised green, two bunkers. Defined
                                             // analytically (sum of gaussians) — no assets.
export function surfaceNormal(h: HoleDef, x: number, z: number): Vec3; // via central differences
```

`HoleDef` is the contract Phase 2B's procedural generator will implement — nothing in
2A may assume HOLE_ONE specifics outside `terrain.ts`.

### 2.2 `physics.ts`

```ts
export type BallPhase = "flying" | "rolling" | "stopped" | "holed";
export interface BallState {
  pos: Vec3; vel: Vec3; spin: Vec3;          // spin = angular velocity, rad/s
  phase: BallPhase;
}
export interface StrokeInput { power: number /*0..1*/; aimDeg: number; faceDeg: number }

export function launch(from: Vec3, input: StrokeInput): BallState;
export function step(hole: HoleDef, b: BallState, dt: number): BallState; // pure
```

- **Launch:** speed = `power * V_MAX` (V_MAX ≈ 32 m/s), fixed loft 18°, direction from
  `aimDeg`; `faceDeg` (± ~10°) adds sidespin → curve in flight.
- **Flight:** `a = g + drag(-kd·|v|·v) + magnus(km·(spin × v))`.
- **Bounce** when crossing the heightfield: reflect normal component with restitution
  `e(surface)` (green .35, fairway .4, rough .25, bunker .05), tangential damped, spin
  decays. Normal speed under threshold → rolling.
- **Rolling:** velocity projected on surface, downhill gravity component minus friction
  `μ(surface)·g` opposing motion (green .06, fairway .12, rough .30, bunker .45).
  Stopped when `|v| < 0.08` on slope < limit.
- **Cup capture:** rolling within `cup.r` of the cup at `|v| < 1.6` → `holed`. Faster →
  roll over (lip-out is free emergent behavior).
- **OOB / out of bounds surface:** stroke result "oob"; ball returns to stroke origin,
  +1 penalty (handled by turns, not physics).

Invariants under test: energy never increases; every stroke reaches `stopped|holed`
within 60 simulated seconds; capture requires low speed; bounce keeps ball above
terrain.

### 2.3 `swing.ts` (runs on the phone)

```ts
export interface SwingSample { t: number; accG: [number,number,number] | null; rot: [number,number,number] | null }
export interface SwingResult { power: number; faceDeg: number }
export function createSwingDetector(onSwing: (s: SwingResult) => void): { feed(s: SwingSample): void; reset(): void };
```

Peak detection over `|accG|`: arm when magnitude exceeds `START_G` (≈ 15 m/s²), track
the peak inside a 350ms window, fire once on the falling edge. `power =
clamp((peak − START_G) / (PEAK_G − START_G))` with `PEAK_G ≈ 45`. `faceDeg` = integral
of yaw rate (`rot.alpha`) over the window, clamped to ±10°. Cooldown 1s. Constants live
in one exported `SWING_TUNING` object — Checkpoint F tunes them on the real iPhone.

Aiming is separate from swinging: while aiming, the phone's yaw rate integrates into an
aim angle (drift is fine — the player watches the arrow on the host and taps **Lock
aim** on the phone). After locking, the detector arms.

### 2.4 `turns.ts`

```ts
export interface PlayerScore { peerId: string; strokes: number; holed: boolean }
export interface TurnState {
  order: string[]; current: string | null;   // null → hole finished
  phase: "aiming" | "ball-in-motion" | "finished";
  scores: PlayerScore[];
}
export function createTurnMachine(peerIds: string[]): {
  state(): TurnState;
  strokeTaken(peerId: string): void;
  ballSettled(result: "stopped" | "holed" | "oob"): TurnState;
  addPlayer(peerId: string): void; removePlayer(peerId: string): void;
};
```

Round-robin in join order, skipping holed players. Stroke cap 8 (auto-pickup). Hole
ends when everyone is holed/capped → `finished` with the scorecard. Players may join
mid-hole (queued at the end of the order); a leaving player forfeits.

## 3. Protocol & transport

Discrete game events must not be lost → they use a **reliable path**; the 60Hz
telemetry stays on the unreliable channel (aim preview reads it on the host).

- New RTCDataChannel `"events"` (`ordered: true`, default reliability), created by the
  controller next to `"telemetry"`. Fallback: the PartyKit WebSocket, via one new
  server-relayed message so the Worker stays generic:
  - `ClientMessage += { type: "game"; to: PeerId; payload: GameMessage }`
  - `ServerMessage += { type: "game"; from: PeerId; payload: GameMessage }`
  (server change → requires one `npm run party:deploy`).
- `GameMessage` (in `protocol.ts`, DOM-free):
  - ctrl → host: `{ kind: "aim-lock", aimDeg }` · `{ kind: "swing", power, faceDeg }`
  - host → ctrl: `{ kind: "turn", yourTurn, strokeIndex }` ·
    `{ kind: "stroke-result", outcome: "stopped"|"holed"|"oob", distToCup }` ·
    `{ kind: "hole-finished", scores }`
- Telemetry gains nothing; aim preview derives from the existing `rot` stream.

## 4. Host rendering — `components/host/GameCanvas.tsx`

Deps: `three`, `@react-three/fiber`, `@react-three/drei` (only these).

- Terrain: one segmented plane displaced by `height()`, vertex-colored by `surfaceAt`
  (low-poly look = flat shading + coarse segments ~1.5m). Cup = dark disc + flagpole.
- Ball mesh mirrors the sim state (sim runs in a `useRef` loop, fixed-step accumulator;
  rendering interpolates — same no-setState-at-60Hz discipline as TelemetryDebug).
- Aim arrow from the tee/ball while the active player aims (yaw from live telemetry).
- Chase camera with damping: behind the ball looking at cup while aiming, follows the
  ball in flight, orbits gently to the scorecard on hole end.
- DOM HUD overlay: active player, stroke count, last-stroke power bar, scorecard panel.
- The QR panel collapses to a corner badge once ≥1 player is in and the game starts
  (start = host clicks "Start hole" / first player locks aim). Joining stays open.

## 5. Controller UI states

`PermissionGate` grants sensors as today, then the controller becomes a game pad:

1. **Waiting** — "It's X's turn" + your scorecard line.
2. **Your turn / aiming** — big **Lock aim** button; rumble (60Hz, 200ms) fires on turn
   start; rotating the phone steers the host arrow.
3. **Swing** — "Swing now" screen; detector armed; on fire, show power % + face.
4. **Result** — stroke outcome + distance to cup; then back to Waiting.
Rumble also on: your ball holed (double pulse).

## 6. Testing

- Vitest: physics invariants (§2.2), swing detector on synthetic traces (clean swing,
  jitter-no-swing, double-peak), turn machine (round-robin, skip holed, cap, join/leave).
- Integration = user checkpoints:
  - **Checkpoint E (desktop):** hole renders on the host; a debug "test stroke" button
    (host-only, dev flag) fires strokes with sliders for power/aim — ball flies,
    bounces, rolls, and can hole out. No phone needed.
  - **Checkpoint F (iPhone):** full loop — aim by rotating the phone, lock, swing for
    real, turns rotate between 2 phones, rumble on turn, scorecard at the end.
    Includes on-device tuning of `SWING_TUNING`.

## 7. Risks

- Swing feel is the product; constants are guesses until Checkpoint F — that checkpoint
  is explicitly a tuning session, not pass/fail.
- Gyro drift while aiming: mitigated by watch-the-arrow + Lock button (no absolute
  heading needed).
- r3f + React 19 + Next 15: pin current stable `@react-three/fiber@^9`; canvas must be
  client-only (`dynamic` import, `ssr: false`).
- Host tab throttling if backgrounded: sim runs on rAF; pause turns while hidden
  (visibilitychange) instead of letting the accumulator explode.
