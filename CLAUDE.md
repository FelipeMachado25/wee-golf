# Wee Golf

Multiplayer browser golf. Phones act as motion controllers (accelerometer/gyroscope);
a host screen renders the game. This file is the contract for future sessions — read it
before touching code. The detailed phase plan lives in `tasks/phase-0-plan.md`.

## Stack (pinned — do not upgrade casually)

- **Next.js 15** (App Router, Turbopack). Do NOT move to Next 16.
- TypeScript strict · Tailwind v4 (`@tailwindcss/postcss`)
- **partyserver on Cloudflare Workers** — signaling only, deployed separately with wrangler
  (`npm run party:deploy`), never on Vercel. (PartyKit's hosted platform is full — its
  shared partykit.dev zone hit Cloudflare's 10k-domain limit — so we run the maintained
  successor, `partyserver`, on our own free Workers account. The browser client still
  uses `partysocket`, with `party: "wee-golf-room"`.)
- **WebRTC RTCDataChannel** for live telemetry — ALWAYS `{ ordered: false, maxRetransmits: 0 }`.
- Vitest for pure logic modules only (`lib/**/*.test.ts`). Integration is verified by
  hand on real devices via checkpoints, not mocked.

## Commands

```bash
npm run dev          # Next on :3000
npm run party:dev    # wrangler dev on :8787 (separate terminal, required for rooms)
npm test             # vitest run
npm run party:deploy # deploy signaling server → wee-golf.<subdomain>.workers.dev
npx vercel --prod    # deploy app
```

Env (`.env.local`, template in `.env.example`):
- `NEXT_PUBLIC_PARTYKIT_HOST` — `127.0.0.1:8787` locally, `wee-golf.<subdomain>.workers.dev` in prod (no protocol).
- `NEXT_PUBLIC_APP_URL` — optional QR-base override for local LAN testing only. Unset in prod.

## Layout

```
party/server.ts                    Durable Object room (partyserver): host/controller
                                   roles, presence, TARGETED relay (never broadcast SDP)
wrangler.jsonc                     Workers config: SQLite-backed DO binding WeeGolfRoom
party/tsconfig.json                workers-types build; party/ is EXCLUDED from root tsconfig
app/page.tsx                       host screen (thin server component)
app/controller/[roomId]/page.tsx   phone screen (thin; Next 15 async params pattern)
components/host/                   "use client" host UI (QR panel, telemetry debug)
components/controller/             "use client" phone UI (permission gate, rumble)
lib/room/room-id.ts                unbiased 6-char id, alphabet without 0/O/1/I/L
lib/networking/partykit/protocol.ts  ⚠️ shared with party/server.ts — see rule below
lib/networking/partykit/client.ts  typed PartySocket wrapper, validates inbound msgs
lib/networking/webrtc/             config, ICE buffer, controller offerer, host registry
lib/sensors/                       rate limiter (~60Hz), devicemotion capture
lib/audio/rumble.ts                Web Audio low-freq "vibration" pulse
```

## Conventions

- Code, file names, types, commit messages: **English**. Comments may explain "why" in either language.
- `"use client"` lives only under `components/`; `app/` pages stay thin server components.
- **`lib/networking/partykit/protocol.ts` must not import DOM or Next types.** wrangler's
  esbuild compiles it for workerd. DOM-ish types (e.g. `RTCIceCandidateInit`) are
  redeclared structurally there.
- Never trust the network: inbound socket messages go through `isServerMessage` /
  `isClientMessage` guards, no blind casts.
- Telemetry payloads carry a mandatory `seq` — the channel is unreliable/unordered and
  the host diagnoses drops/reordering from it.

## Architecture decisions (condensed — full rationale in tasks/phase-0-plan.md §2)

- Room ids are generated **client-side** by the host (PartyKit rooms are lazy). Server
  rejects a second host with `room-busy`; host regenerates and retries (max 5).
- WebRTC roles are fixed: **controller = offerer, host = answerer**. No perfect
  negotiation needed. The data channel is created BEFORE `createOffer`.
- ICE candidates are buffered (`ice-buffer.ts`) until the remote description is set.
- STUN only (Google + Twilio). No TURN yet. If the channel doesn't open in 8s, telemetry
  falls back to the PartyKit WebSocket (`telemetry-fallback`); host shows P2P vs RELAY badge.
- Host never `setState`s at 60Hz: samples land in a `useRef`, a rAF loop writes to the
  DOM directly.

## iOS gotchas (each one cost real debugging time — do not rediscover them)

- `devicemotion` requires a **secure context**. Plain `http://<lan-ip>:3000` won't even
  show the permission prompt. Test sensors against the Vercel HTTPS deploy, or use
  `next dev --experimental-https` / a cloudflared tunnel.
- `DeviceMotionEvent.requestPermission()` must be called **synchronously inside the user
  gesture handler** — any `await` before it and iOS denies silently.
- `event.acceleration` can be `null` on some devices; `accelerationIncludingGravity`
  always arrives. We send acc, accG and rotationRate, each nullable.
- The `AudioContext` is created+resumed in the same gesture as the permission tap.
- The iPhone **mute switch silences Safari audio** — the #1 false "rumble is broken" report.
- Screen sleep kills sensors → request a screen Wake Lock in the same gesture.
- Backgrounding the tab stops `devicemotion` → watch `visibilitychange`.

## Production

- App: **https://wee-golf.vercel.app** (Vercel project `wee-golf`, org `felipemachado25s-projects`)
- Signaling: **wee-golf.wee-golf.workers.dev** (Cloudflare Worker, deploy with `npm run party:deploy`)
- Repo: **https://github.com/FelipeMachado25/wee-golf** (public) — every push to `main`
  auto-deploys the app on Vercel. The Worker does NOT auto-deploy.
- Local folder: `~/Desktop/04_Projects/We Sports` (note the space in the path — quote it).

## Phase status

- **Phase 2C (clubs, minimap, avatars): BUILT 2026-08-26** — real club set
  (`lib/game/clubs.ts`: driver/iron/wedge/putter) whose displayed max ranges are MEASURED
  by simulating a full-power stroke, not hand-typed; the putter launches straight into the
  rolling phase, which is what makes the short game dosable. Host auto-suggests a club from
  distance+surface, phone can override. Top-down minimap with aim line and club range arc.
  Low-poly suit avatars per player (name tag + selfie face texture, or a seeded
  procedurally ugly face when no photo is given); arms track the live backswing meter.
- **Phase 2B (multi-hole courses): BUILT 2026-08-26** — seeded parametric hole generator
  (`lib/game/course.ts`, same HoleDef contract), 3/6/9-hole selector in the host lobby,
  automatic hole sequencing with per-hole and course-total scorecards. Swing is Wii-style
  and button-armed: Lock captures the grip as reference, meter is grip-relative, strike
  registers on any swing-through past the bottom, dead stop = backspin.
- **Phase 2A (playable hole): DONE** — host-authoritative analytic physics (120Hz),
  reliable "events" DataChannel + WS fallback, r3f low-poly render, round-robin turns.
- **Phase 0/1 (connection + sensors): DONE.** All four checkpoints approved by the user
  on real hardware (2026-08-26): iPhone scans the QR, permission flow works, host shows
  live 60Hz telemetry, transport reached **P2P** on the user's network (fallback relay
  untested in the wild so far). Rumble default is **60Hz** — winner of the on-device A/B.
- Open questions inherited by Phase 2: is TURN ever needed (P2P worked; relay fallback
  exists)? binary telemetry payload? orientation calibration for the swing model?
- Phase 2+ (physics, procedural course, avatars, scoring): not started. Out of scope now.

## Verification

`node scripts/smoke.mjs` drives a host page + an emulated iPhone controller in
**WebKit** (Safari engine — what this game actually ships to) through join, profile,
start-round, and reports uncaught exceptions plus a screenshot. Run it after any change
to the game view: Chromium alone has hidden Safari-only breakage before (roundRect,
SCTP message size).

```bash
npm run build && npx next start -p 3210 &   # app
npx wrangler dev &                          # signaling
node scripts/smoke.mjs
```
