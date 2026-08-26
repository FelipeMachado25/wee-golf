# Phase 2A — Playable Hole Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use
> checkboxes. 🛑 Checkpoints E and F require explicit user approval before advancing.

**Goal:** One fixed par-3 hole, playable end-to-end: 3D low-poly render on the host,
real phone swing, classic turns for 1–4 players, rumble on your turn.

**Architecture:** Host-authoritative custom analytic physics at fixed 120Hz; swing
detected on the phone; discrete game events over a new reliable "events" DataChannel
with WebSocket fallback. See spec: `docs/superpowers/specs/2026-08-26-phase-2a-playable-hole-design.md`
(§2 carries the exact module signatures — they are the contract for every task below).

**Tech Stack adds:** `three`, `@react-three/fiber@^9`, `@react-three/drei` — nothing else.

## Global Constraints

- All Phase-0 constraints hold (CLAUDE.md): Next 15, protocol.ts DOM-free, telemetry
  channel stays `{ordered:false, maxRetransmits:0}`, no setState at 60Hz.
- New "events" channel: `{ordered: true}` (reliable), label `"events"`.
- Simulation: fixed `dt = 1/120`, accumulator in rAF, never in React state.
- `lib/game/**` imports nothing from three/react/DOM.
- Physics/tuning constants live in exported objects (`PHYS`, `SWING_TUNING`) — single
  source for Checkpoint-F tuning.

### Task 1: deps + vec helpers
`npm i three @react-three/fiber @react-three/drei && npm i -D @types/three`.
`lib/game/vec.ts`: `add/sub/scale/dot/cross/len/norm` over `{x,y,z}` (pure, no class).
Commit: `feat(game): add three/r3f deps and vector helpers`.

### Task 2: `lib/game/terrain.ts` (TDD)
Tests (`terrain.test.ts`): HOLE_ONE bounds/tee/cup sane; `height` smooth (finite,
continuous at random points); `surfaceAt(tee)==="tee"`, `surfaceAt(cup)==="green"`,
outside bounds → `"oob"`; `surfaceNormal` unit-length, points up (`y>0`).
HOLE_ONE: bounds {w:30,l:100}, tee {0,h,4}, cup at {x:2,z:88,r:0.11}; height = base
slope + 2 gaussian mounds + green plateau gaussian; bunkers = 2 discs; green = disc
r≈6 around cup; fairway = corridor |x|<7; else rough.
Commit: `feat(game): fixed hole one behind HoleDef contract`.

### Task 3: `lib/game/physics.ts` (TDD)
`PHYS = { G:9.81, V_MAX:32, LOFT_DEG:18, KD:0.02, KM:0.00008, STOP_SPEED:0.08,
CAPTURE_SPEED:1.6, E:{green:.35,fairway:.4,rough:.25,bunker:.05,tee:.4,oob:.3},
MU:{green:.06,fairway:.12,rough:.3,bunker:.45,tee:.1,oob:.2} }`.
Tests: launch(power 1) speed==V_MAX with +y component; full-power stroke lands within
bounds l; every stroke (grid of powers/aims) reaches stopped|holed < 60 sim-seconds;
kinetic+potential energy non-increasing while rolling; slow roll into cup → holed;
fast roll across cup → not holed; ball never rests below terrain.
Commit: `feat(game): analytic golf ball physics with invariant tests`.

### Task 4: `lib/game/turns.ts` (TDD)
Tests: round-robin order; strokes increment; holed players skipped; oob adds penalty
stroke; cap 8 → auto-holed(capped); all holed → finished + scores; addPlayer queues at
end; removePlayer forfeits current turn cleanly.
Commit: `feat(game): turn machine`.

### Task 5: `lib/game/swing.ts` (TDD)
Detector per spec §2.3. Tests with synthetic traces: clean gaussian pulse → one swing,
power∈(0,1]; sub-threshold jitter → none; two pulses inside cooldown → one; faceDeg
clamps ±10.
Commit: `feat(game): phone-side swing detector`.

### Task 6: protocol + reliable transport
`protocol.ts`: add `GameMessage` union (spec §3) + `{type:"game"}` client/server
messages + guards (tests). `party/server.ts`: relay `game` targeted like `signal`
(to:"host" resolves host conn). `peer-controller`: create second channel `"events"`
(ordered) + `sendGame`/`onGame`; `peer-host`: accept by label, expose `sendGame(peerId)`
/`onGame`. Both fall back to WS `game` message when channel not open.
Deploy Worker: `npm run party:deploy`. Verify with relay-test extension (game msg
ctrl→host). Commit: `feat(net): reliable game-event channel with WS fallback`.

### Task 7: host game — sim loop + GameCanvas + HUD
`components/host/game/useGameLoop.ts`: refs for BallState+TurnState; accumulator step;
applies SwingEvents; emits turn/stroke-result/hole-finished via sendGame; pauses on
visibilitychange. `GameCanvas.tsx` (dynamic ssr:false): terrain mesh from heightfield
(1.5m segments, vertex colors by surface, flatShading), ball, flag, aim arrow (yaw from
live rot telemetry integration), chase camera (damped). `Hud.tsx` DOM overlay: active
player, strokes, power bar, scorecard on finish. HostClient: game replaces idle view
when host clicks **Start hole** (needs ≥1 controller); QR shrinks to corner badge
component. Dev-only `TestStrokeBar` (sliders power/aim + fire) behind `?debug=1`.
Commit: `feat(host): 3D hole, simulation loop and HUD`.

### Task 8: controller game UI
`ControllerClient` states per spec §5 (waiting/aiming/swing/result) driven by `turn` +
`stroke-result` messages; **Lock aim** sends aim-lock (yaw integration from rot while
aiming); detector feeds from existing motion capture; rumble 60Hz/200ms on turn start,
double pulse on holed. Commit: `feat(controller): aim/swing game pad flow`.

### Task 9: 🛑 CHECKPOINT E (desktop)
`npm run dev` + party:dev; host `?debug=1`; connect one desktop tab as controller;
Start hole; fire test strokes with sliders: ball flies/bounces/rolls, can hole out,
camera follows, HUD updates, scorecard appears. Then push (auto-deploy) and have the
user repeat on production desktop. STOP for approval. Commit checkpoint.

### Task 10: 🛑 CHECKPOINT F (iPhone, tuning session)
User plays a full hole from the phone: aim by rotating, lock, real swing, turns across
2 phones, rumble on turn. Tune SWING_TUNING/PHYS live from their feedback (power too
strong/weak, swing too hard to trigger…), pushing tweaks. STOP for approval; then
docs task: CLAUDE.md phase status + spec deltas. Commit + push.
