# Wee Golf — Fase 0/1: Conexión y Captura de Sensores

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento. **NO avanzar de checkpoint sin aprobación explícita del usuario tras probarlo en su iPhone.**

**Goal:** Que un iPhone escanee un QR mostrado por una pantalla host, abra un canal WebRTC directo, y envíe aceleración/giroscopio crudos a ~60Hz que el host visualiza en tiempo real — más un botón de "vibración" por Web Audio.

**Architecture:** Next.js sirve dos superficies (host `/` y controller `/controller/[roomId]`). PartyKit es **solo señalización**: relay de mensajes dirigidos por `peerId` dentro de una sala. Una vez negociado el SDP, la telemetría viaja por `RTCDataChannel` **no confiable y no ordenado** (`ordered:false, maxRetransmits:0`) — el servidor deja de participar. El host mantiene un `Map<peerId, PeerSession>` desde el día uno para que N teléfonos funcionen sin reescritura.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · PartyKit (`partykit` CLI + `partysocket`) · WebRTC nativo del browser · `react-qr-code` · Vitest (solo módulos puros) · Deploy: Vercel + `partykit.dev`

**Spec:** Brief del usuario, sesión 2026-08-26 — transcrito íntegro en §1 de este documento.

---

## Global Constraints

- **Next.js 15** (App Router). Pinneado explícitamente: `next@^15`. *No* usar Next 16 aunque exista.
- **TypeScript strict**. Tailwind v4 (`@import "tailwindcss"`, plugin `@tailwindcss/postcss`).
- **PartyKit se despliega aparte** de Vercel. Vercel nunca hostea el servidor de salas.
- **El DataChannel de telemetría es SIEMPRE** `{ ordered: false, maxRetransmits: 0 }`.
- **Frecuencia objetivo de envío: ~60Hz**, limitada por rate limiter propio (no confiar en el ritmo del evento).
- **`lib/networking/partykit/protocol.ts` no puede importar tipos DOM ni de Next.** Lo compila también esbuild de PartyKit sobre workerd. Tipos como `RTCIceCandidateInit` se redefinen estructuralmente.
- **Fuera de alcance en esta fase:** física, campo procedural, avatares, scoring, render 3D. Solo conexión + sensores + debug.
- **Idioma:** código, nombres de archivo, tipos y mensajes de commit en **inglés**. Comentarios, docs y `CLAUDE.md` en **español**.

---

## §1 — Brief original (spec)

Golf multijugador en navegador. El celular actúa como control de movimiento (acelerómetro/giroscopio) y una pantalla host renderiza el juego. Entregas de esta fase:

1. `/CLAUDE.md` documentando stack, estructura de carpetas y convenciones, para que las próximas sesiones lo lean solas.
2. Estructura base: `app/page.tsx` (host), la página del celular, `lib/networking/partykit`, `lib/networking/webrtc`, `party/server.ts`.
3. Servidor PartyKit: crea una sala al conectarse el host, genera un `roomId`, expone el estado mínimo (jugadores conectados).
4. Pantalla host: al cargar se conecta a una sala nueva y muestra un QR apuntando a `/controller/[roomId]` con el dominio de producción.
5. Pantalla del celular: al escanear el QR se conecta a la misma sala, deposita sus credenciales SDP y abre un `RTCDataChannel` directo con el host (`ordered:false, maxRetransmits:0`).
6. Botón de permiso en el celular que llama `DeviceMotionEvent.requestPermission()` y, aprobado, escucha `devicemotion` y envía la aceleración cruda por el data channel a ~60Hz.
7. Hack de vibración: botón de prueba que reproduce con Web Audio API una onda de 20Hz a volumen máximo por 100ms, desbloqueada por la misma interacción del botón de permiso.
8. En el host, mostrar en pantalla (debug) los valores de aceleración que llegan del celular en tiempo real.

**Corrección de tipeo asumida:** el brief escribe `app/control]/page.tsx` en el punto 2, pero el punto 4 dice que el QR apunta a `/controller/[roomId]`. Se toma el punto 4 como autoritativo: la ruta es **`app/controller/[roomId]/page.tsx`**.

---

## §2 — Decisiones de arquitectura (revisar antes de aprobar)

Estas son las decisiones que quiero que valides. Cada una tiene alternativas descartadas y el porqué.

### D1. El `roomId` lo genera el cliente host, no el servidor

PartyKit crea salas **de forma perezosa**: la sala existe en cuanto alguien se conecta a ese nombre. No hace falta un endpoint "create room". Entonces el host genera un id corto y se conecta.

- **Alfabeto:** `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — 32 caracteres, sin `0/O/1/I/L` (ambiguos si alguien lo teclea a mano). Longitud 6 → ~1.07e9 combinaciones.
- 32 divide a 256 exacto, así que `crypto.getRandomValues` + módulo **no tiene sesgo**. Testeable.
- **Guardia de colisión:** si el servidor ya tiene un host en esa sala, responde `{type:"room-busy"}` y cierra; el host genera otro id y reintenta (máx. 5 veces). Barato y elimina el riesgo de que dos partidas caigan en la misma sala.

*Descartado:* pedir el id al servidor por HTTP. Añade un round-trip y un endpoint para nada.

### D2. El **controller** es el ofertante (offerer), el host responde

El teléfono llega después y sabe que el host ya está ahí. Roles fijos y asimétricos → **no hace falta "perfect negotiation"** ni manejo de glare. Flujo:

```
host                     PartyKit                  controller (iPhone)
 │  connect ?role=host       │                            │
 │─────────────────────────► │                            │
 │  ◄── welcome              │  ◄── connect ?role=ctrl ────│
 │  ◄── peer-joined(ctrlId)  │  ──► welcome(hostPeerId) ──►│
 │                           │                            │ createDataChannel("telemetry")
 │                           │                            │ createOffer / setLocalDescription
 │  ◄── signal{offer} ───────│◄── signal{to:host, offer}──│
 │ setRemoteDescription      │                            │
 │ createAnswer              │                            │
 │──► signal{to:ctrl,answer}►│───► signal{answer} ───────►│
 │  ◄══════ ICE trickle en ambos sentidos (relay) ═══════► │
 │  ◄═══════ RTCDataChannel abierto — 60Hz ══════════════► │
```

El host expone `ondatachannel`; el controller crea el canal. El canal se crea **antes** de `createOffer` para que el `m=application` entre en el SDP.

### D3. Buffer de candidatos ICE — la causa #1 de conexiones intermitentes

Los candidatos ICE llegan por el relay y pueden adelantarse a `setRemoteDescription`. `addIceCandidate` antes de tener descripción remota lanza. Solución: un buffer explícito (`lib/networking/webrtc/ice-buffer.ts`) que acumula hasta que la descripción remota está puesta y entonces vacía en orden. Es lógica pura → **se testea con vitest** (Task 6).

### D4. Relay **dirigido**, no broadcast

`{type:"signal", to: peerId}`. Con un solo teléfono da igual, pero en cuanto haya 4 jugadores el broadcast haría que cada teléfono recibiera los SDP de los demás. Cuesta lo mismo hacerlo bien ahora.

### D5. STUN sí, TURN aplazado — con fallback por WebSocket

- ICE servers por defecto: `stun:stun.l.google.com:19302` + `stun:global.stun.twilio.com:3478`.
- **Mismo WiFi** (tu caso probable en Checkpoint C): conectan por candidatos `host`, ni siquiera se usa STUN. Funciona seguro.
- **iPhone en 5G + laptop en WiFi:** NAT simétrico puede bloquear. Sin TURN no hay conexión.
- **Propuesta:** implementar un **fallback por el WebSocket de PartyKit**. Si el `RTCDataChannel` no abre en 8s, la telemetría se manda como `{type:"telemetry-fallback"}` por el socket que ya está abierto. Peor latencia (TCP + round-trip al servidor) pero *funciona siempre*. El host muestra un badge `RELAY` vs `P2P` para que sepas cuál está activo.
- TURN real (Cloudflare/Metered vía env vars) queda para una fase posterior.

**➡️ Necesito tu decisión: ¿incluyo el fallback WS en esta fase (Task 11) o lo dejo fuera?** Añade ~40 líneas y elimina el riesgo de que el Checkpoint C se bloquee por red.

### D6. iOS: `devicemotion` exige **contexto seguro (HTTPS)**

Esto define la forma de tus checkpoints, y tu división A/C ya es correcta:

- `http://192.168.1.x:3000` **no** entrega `devicemotion` en Safari iOS. Ni siquiera aparece el prompt de permiso.
- Por eso **Checkpoint A se valida en escritorio** (dos pestañas: host + controller) — verifica señalización, WebRTC y QR, no sensores.
- **Checkpoint C es el primer test real en teléfono**, ya sobre HTTPS de Vercel.
- Si quieres iterar sensores en local sin desplegar, la vía es `next dev --experimental-https` (Next 15 genera certificado autofirmado) o un túnel `cloudflared`. Lo documento en `CLAUDE.md` pero no lo pongo en el camino crítico.

Otros detalles iOS que van al código:

- `DeviceMotionEvent.requestPermission()` **debe llamarse dentro del handler del gesto**, de forma síncrona — no después de un `await`. Si se hace tras un await, iOS lo rechaza silenciosamente.
- `event.acceleration` (sin gravedad) **puede venir `null`**. `accelerationIncludingGravity` siempre viene. Mandamos **los tres**: `acceleration`, `accelerationIncludingGravity` y `rotationRate` (el brief pide acelerómetro *y* giroscopio).
- **Wake Lock** (`navigator.wakeLock.request('screen')`): si la pantalla del iPhone se apaga, los sensores paran. Safari iOS 16.4+ lo soporta. Se pide en el mismo gesto.
- Poner la app en background mata `devicemotion`. Se detecta con `visibilitychange` y se muestra en el estado.

### D7. Payload de telemetría: JSON con `seq`, tuplas en vez de objetos

```
{ seq, t, acc:[x,y,z]|null, accG:[x,y,z]|null, rot:[a,b,g]|null, interval }
```

- **`seq` es obligatorio**: el canal es *unreliable* y *unordered*, así que el host necesita detectar pérdidas y reordenamientos. Sin `seq` no hay forma de diagnosticar nada.
- ~150 bytes/msg × 60Hz = ~9 KB/s. Irrelevante.
- Tuplas en vez de `{x,y,z}` para recortar ~40%.
- *Binario (`Float32Array`) queda para más adelante* — en Fase 0 la legibilidad en DevTools vale más que los bytes.

### D8. El host **no** hace `setState` a 60Hz

React re-renderizando 60 veces por segundo por 4 jugadores es una tormenta. Patrón:

- Las muestras entrantes se escriben en un `useRef` (buffer circular).
- Un loop `requestAnimationFrame` lee el ref y escribe **directo al DOM** vía refs de `<span>`, más una sparkline en `<canvas>`.
- Solo el estado discreto (conectado/desconectado, transporte P2P vs RELAY, nº de peers) pasa por `setState`.

Esto convierte el panel de debug en una herramienta de diagnóstico real para las fases siguientes: packets/seg, drops, gaps de `seq`, edad de la última muestra.

### D9. "Vibración" a 20Hz: implemento lo pedido, pero con control de frecuencia

El brief pide 20Hz a ganancia máxima por 100ms. Lo implemento tal cual como default. Dos matices de ingeniería:

- Un altavoz de iPhone **no reproduce 20Hz**. Lo que se percibe es distorsión armónica y excursión del cono. En la práctica **40–90Hz suele sentirse bastante más**. Por eso el botón de test lleva un **selector de frecuencia (20/40/60/90Hz) y de duración** para que hagas A/B en tu iPhone real en el Checkpoint D y fijemos el valor bueno con datos, no con teoría.
- Envolvente de ataque/release de ~4ms con `GainNode` para evitar un "click" de conmutación sucio. Es ajustable; si el click ayuda a la percepción, lo subimos a 0ms.

**⚠️ Checkpoint D fallará silenciosamente si el iPhone está con el switch de silencio activado.** Safari usa categoría de sesión "ambient", que el interruptor de timbre silencia. Hay que verificarlo antes de dar el checkpoint por roto.

### D10. `AudioContext` se desbloquea en el gesto del botón de permiso

Tal como pide el brief: el handler del botón de permiso crea el `AudioContext` y llama `resume()`. Se guarda en un singleton (`lib/audio/rumble.ts`) para que el botón de test pueda dispararlo después sin gesto propio.

### D11. Next 15: `params` es una `Promise`

En Next 15 los `params` de una página son asíncronos. Y la página del controller necesita ser cliente (WebRTC). Patrón:

```tsx
// app/controller/[roomId]/page.tsx  (Server Component, delgado)
export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <ControllerClient roomId={roomId} />;
}
```

Igual en el host: `app/page.tsx` queda delgado y el `"use client"` vive en el componente hijo.

### D12. URL del QR

`window.location.origin` es el default correcto — la página host se sirve del mismo origen al que debe apuntar el QR, en local y en producción. La única razón para sobreescribir es el caso local: `localhost` no es alcanzable desde el teléfono, ahí quieres `http://192.168.1.x:3000`. Por eso:

```
NEXT_PUBLIC_APP_URL  (opcional, override)  →  si no está, window.location.origin
```

En Vercel no hace falta setearlo. En local se pone la IP LAN si se quiere escanear.

### D13. Tests: solo donde aportan

WebRTC y los sensores no se testean unitariamente sin montar un circo de mocks que no prueba nada real — **tus checkpoints A–D son la verificación de integración**. Lo que sí es lógica pura y sí se testea con Vitest:

| Módulo | Qué se testea |
|---|---|
| `lib/room/room-id.ts` | longitud, alfabeto, ausencia de caracteres ambiguos, normalización |
| `lib/networking/webrtc/ice-buffer.ts` | bufferea antes de ready, vacía en orden, aplica directo después |
| `lib/sensors/rate-limiter.ts` | deja pasar a la frecuencia pedida con reloj inyectado |
| `lib/networking/partykit/protocol.ts` | type guards de mensajes rechazan basura |

**➡️ Si prefieres cero tests en esta fase, dilo y quito Vitest** (afecta Tasks 2, 4, 6, 12).

---

## §3 — Estructura de archivos

```
wee-golf/
├── CLAUDE.md                          # ← entrega 1: contrato para sesiones futuras
├── README.md
├── package.json                       # next@^15, react@19, partysocket, react-qr-code
├── partykit.json                      # name + main: party/server.ts
├── next.config.ts
├── tsconfig.json                      # strict, paths: "@/*"
├── vitest.config.ts
├── .env.example                       # NEXT_PUBLIC_PARTYKIT_HOST, NEXT_PUBLIC_APP_URL
├── .env.local                         # gitignored
│
├── tasks/
│   └── phase-0-plan.md                # este documento
│
├── party/
│   └── server.ts                      # sala PartyKit: roles, presencia, relay dirigido
│
├── app/
│   ├── layout.tsx
│   ├── globals.css                    # Tailwind v4
│   ├── page.tsx                       # host (server, delgado)
│   └── controller/[roomId]/page.tsx   # celular (server, delgado)
│
├── components/
│   ├── host/
│   │   ├── HostClient.tsx             # "use client" — orquesta socket + peers
│   │   ├── QrPanel.tsx                # QR + roomId legible + URL
│   │   └── TelemetryDebug.tsx         # panel rAF, una fila por peer
│   └── controller/
│       ├── ControllerClient.tsx       # "use client" — orquesta socket + peer + sensores
│       ├── PermissionGate.tsx         # botón de permiso (gesto: motion + audio + wakelock)
│       ├── RumbleTester.tsx           # botón 20Hz + selector de freq/duración
│       └── ConnectionBadge.tsx        # estado ICE / P2P vs RELAY
│
└── lib/
    ├── room/
    │   ├── room-id.ts                 # generateRoomId, normalizeRoomId, ROOM_ID_ALPHABET
    │   └── room-id.test.ts
    ├── networking/
    │   ├── partykit/
    │   │   ├── protocol.ts            # ⚠️ sin tipos DOM — compartido con party/server.ts
    │   │   ├── protocol.test.ts
    │   │   └── client.ts              # wrapper de PartySocket tipado
    │   └── webrtc/
    │       ├── config.ts              # ICE servers, DATA_CHANNEL_INIT, timeouts
    │       ├── ice-buffer.ts
    │       ├── ice-buffer.test.ts
    │       ├── peer-controller.ts     # offerer: crea DC, offer, trickle
    │       └── peer-host.ts           # answerer: Map<peerId, PeerSession>
    ├── sensors/
    │   ├── rate-limiter.ts
    │   ├── rate-limiter.test.ts
    │   └── device-motion.ts           # requestPermission + listener + wake lock
    └── audio/
        └── rumble.ts                  # unlock(), playRumble({hz, ms, gain})
```

---

## §4 — Contratos compartidos

Se definen una vez aquí y **todas las tareas los usan literalmente**. Cualquier desviación de nombres es un bug.

### `lib/networking/partykit/protocol.ts`

```ts
export const PROTOCOL_VERSION = 1;

export type PeerId = string;
export type Role = "host" | "controller";

export type PeerInfo = { peerId: PeerId; role: Role; joinedAt: number };

/** Reimplementación estructural de RTCIceCandidateInit: protocol.ts lo compila
 *  también esbuild de PartyKit sobre workerd, donde no existen los tipos DOM. */
export type IceCandidateInit = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

export type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: IceCandidateInit };

export type TelemetrySample = {
  seq: number;
  t: number;                                  // performance.now() en el teléfono
  acc: [number, number, number] | null;       // acceleration (sin gravedad)
  accG: [number, number, number] | null;      // accelerationIncludingGravity
  rot: [number, number, number] | null;       // rotationRate alpha/beta/gamma
  interval: number;                           // event.interval en ms
};

/** cliente → servidor */
export type ClientMessage =
  | { type: "signal"; to: PeerId; payload: SignalPayload }
  | { type: "telemetry-fallback"; sample: TelemetrySample };

/** servidor → cliente */
export type ServerMessage =
  | { type: "welcome"; peerId: PeerId; role: Role; peers: PeerInfo[] }
  | { type: "room-busy" }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peerId: PeerId }
  | { type: "signal"; from: PeerId; payload: SignalPayload }
  | { type: "telemetry-fallback"; from: PeerId; sample: TelemetrySample };

export function isServerMessage(v: unknown): v is ServerMessage;
export function isClientMessage(v: unknown): v is ClientMessage;
```

Query params de conexión: `?role=host|controller&peerId=<uuid>`.

### `lib/networking/webrtc/config.ts`

```ts
export const ICE_SERVERS: { urls: string | string[] }[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

export const TELEMETRY_CHANNEL_LABEL = "telemetry";

export const DATA_CHANNEL_INIT: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0,
};

export const P2P_FALLBACK_TIMEOUT_MS = 8_000;
export const TELEMETRY_HZ = 60;
```

### Interfaces de los módulos WebRTC

```ts
// lib/networking/webrtc/peer-controller.ts
export type ControllerPeerEvents = {
  onState: (s: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  onChannelClose: () => void;
};
export function createControllerPeer(args: {
  hostPeerId: PeerId;
  sendSignal: (to: PeerId, payload: SignalPayload) => void;
  events: ControllerPeerEvents;
}): {
  start: () => Promise<void>;
  handleSignal: (payload: SignalPayload) => Promise<void>;
  send: (sample: TelemetrySample) => boolean;   // false si el canal no está abierto
  close: () => void;
};

// lib/networking/webrtc/peer-host.ts
export function createHostPeerRegistry(args: {
  sendSignal: (to: PeerId, payload: SignalPayload) => void;
  onSample: (from: PeerId, sample: TelemetrySample) => void;
  onPeerState: (from: PeerId, s: RTCPeerConnectionState) => void;
}): {
  handleSignal: (from: PeerId, payload: SignalPayload) => Promise<void>;
  removePeer: (peerId: PeerId) => void;
  closeAll: () => void;
};
```

---

# CHECKPOINT A — corre en local, el host muestra un QR

**Criterio de aceptación:** `npm run dev` + `npx partykit dev` levantan sin error. `http://localhost:3000` muestra un QR y un `roomId`. Abriendo la URL del QR en una **segunda pestaña de escritorio**, el host pasa a `P2P` y muestra un peer conectado. (Sensores todavía no — ver D6.)

---

### Task 1: Scaffold del proyecto + `CLAUDE.md`

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `vitest.config.ts`, `.env.example`, `.gitignore`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: Scaffold Next 15**

```bash
cd ~/Desktop/04_Projects/wee-golf
npx create-next-app@15 . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --turbopack --no-git
```

- [ ] **Step 2: Verificar que quedó en Next 15, no 16**

```bash
node -p "require('./package.json').dependencies.next"
```
Esperado: una versión `15.x`. Si sale `16.x`, corregir con `npm i next@^15 --save-exact`.

- [ ] **Step 3: Dependencias**

```bash
npm i partysocket react-qr-code
npm i -D partykit vitest @vitejs/plugin-react
```

- [ ] **Step 4: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
});
```

Añadir a `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest",
"party:dev": "partykit dev",
"party:deploy": "partykit deploy"
```

- [ ] **Step 5: `.env.example`**

```bash
# Host de PartyKit. Local: 127.0.0.1:1999 — Prod: wee-golf.<usuario>.partykit.dev
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999

# Opcional. Solo para que el QR local apunte a tu IP LAN en vez de localhost.
# En Vercel dejar sin setear: se usa window.location.origin.
# NEXT_PUBLIC_APP_URL=http://192.168.1.42:3000
```

Copiar a `.env.local`. Confirmar que `.env*.local` está en `.gitignore`.

- [ ] **Step 6: Escribir `CLAUDE.md`** (entrega 1 del brief)

Contenido: stack y versiones pinneadas · el árbol de §3 · las trece decisiones de §2 en forma condensada · convenciones (inglés en código / español en docs, `"use client"` solo en `components/`, protocol.ts sin tipos DOM) · comandos (`npm run dev`, `npm run party:dev`, `npm test`, deploy) · **la sección de gotchas de iOS** (HTTPS obligatorio, gesto síncrono, switch de silencio, wake lock) · estado por fases con Fase 0 marcada en progreso.

- [ ] **Step 7: Verificar que arranca**

```bash
npm run dev
```
Esperado: Next levanta en `:3000` sin errores de tipos.

- [ ] **Step 8: Init git y commit**

```bash
git init && git add -A
git commit -m "chore: scaffold Next 15 + Tailwind + PartyKit deps, add CLAUDE.md"
```

---

### Task 2: `lib/room/room-id.ts` (TDD)

**Files:**
- Create: `lib/room/room-id.ts`, `lib/room/room-id.test.ts`

**Interfaces:**
- Produces: `ROOM_ID_ALPHABET: string`, `ROOM_ID_LENGTH: number`, `generateRoomId(): string`, `normalizeRoomId(raw: string): string`

- [ ] **Step 1: Test que falla**

```ts
// lib/room/room-id.test.ts
import { describe, it, expect } from "vitest";
import { generateRoomId, normalizeRoomId, ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from "./room-id";

describe("generateRoomId", () => {
  it("returns an id of the configured length", () => {
    expect(generateRoomId()).toHaveLength(ROOM_ID_LENGTH);
  });

  it("only uses characters from the alphabet", () => {
    for (let i = 0; i < 500; i++) {
      for (const ch of generateRoomId()) {
        expect(ROOM_ID_ALPHABET).toContain(ch);
      }
    }
  });

  it("never emits visually ambiguous characters", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateRoomId()).not.toMatch(/[01OIL]/);
    }
  });

  it("produces distinct ids across many draws", () => {
    const seen = new Set(Array.from({ length: 1000 }, generateRoomId));
    expect(seen.size).toBeGreaterThan(990);
  });
});

describe("normalizeRoomId", () => {
  it("uppercases and strips characters outside the alphabet", () => {
    expect(normalizeRoomId(" a2-b3 ")).toBe("A2B3");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npm test -- room-id
```
Esperado: FAIL — no existe `./room-id`.

- [ ] **Step 3: Implementación mínima**

```ts
// lib/room/room-id.ts

/** 32 caracteres sin 0/O/1/I/L para que un id se pueda dictar o teclear sin ambigüedad.
 *  Que sean 32 (potencia de 2 que divide a 256) hace que el módulo sobre bytes
 *  aleatorios sea uniforme, sin sesgo. */
export const ROOM_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_ID_LENGTH = 6;

export function generateRoomId(): string {
  const bytes = new Uint8Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ROOM_ID_ALPHABET[b % ROOM_ID_ALPHABET.length];
  return out;
}

export function normalizeRoomId(raw: string): string {
  return Array.from(raw.toUpperCase())
    .filter((ch) => ROOM_ID_ALPHABET.includes(ch))
    .join("");
}
```

- [ ] **Step 4: Correr y ver que pasa**

```bash
npm test -- room-id
```
Esperado: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/room && git commit -m "feat(room): add unbiased room id generator with unambiguous alphabet"
```

---

### Task 3: `lib/networking/partykit/protocol.ts` (+ guards, TDD)

**Files:**
- Create: `lib/networking/partykit/protocol.ts`, `lib/networking/partykit/protocol.test.ts`

**Interfaces:**
- Produces: todos los tipos de §4 más `isServerMessage`, `isClientMessage`.
- Consumed by: `party/server.ts` (Task 4), `client.ts` (Task 5), ambos módulos WebRTC.

- [ ] **Step 1: Test que falla**

```ts
// lib/networking/partykit/protocol.test.ts
import { describe, it, expect } from "vitest";
import { isServerMessage, isClientMessage } from "./protocol";

describe("isServerMessage", () => {
  it("accepts a welcome message", () => {
    expect(isServerMessage({ type: "welcome", peerId: "a", role: "host", peers: [] })).toBe(true);
  });
  it("accepts a relayed signal", () => {
    expect(isServerMessage({ type: "signal", from: "a", payload: { kind: "offer", sdp: "v=0" } })).toBe(true);
  });
  it("rejects unknown types", () => {
    expect(isServerMessage({ type: "nope" })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isServerMessage(null)).toBe(false);
    expect(isServerMessage("welcome")).toBe(false);
  });
});

describe("isClientMessage", () => {
  it("accepts a directed signal", () => {
    expect(isClientMessage({ type: "signal", to: "b", payload: { kind: "ice", candidate: { candidate: "", sdpMid: null, sdpMLineIndex: null } } })).toBe(true);
  });
  it("rejects a signal without a target", () => {
    expect(isClientMessage({ type: "signal", payload: { kind: "answer", sdp: "v=0" } })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npm test -- protocol
```
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar** los tipos exactos de §4 más los guards. Los guards discriminan por `type` y comprueban la presencia de los campos requeridos (`to` en `signal` de cliente, `from` en `signal` de servidor). **Sin importar ningún tipo DOM** (ver Global Constraints).

- [ ] **Step 4: Correr y ver que pasa**

```bash
npm test -- protocol
```
Esperado: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/networking/partykit && git commit -m "feat(protocol): define DOM-free signaling protocol shared with the PartyKit server"
```

---

### Task 4: `party/server.ts` — sala, roles y relay dirigido

**Files:**
- Create: `party/server.ts`, `partykit.json`

**Interfaces:**
- Consumes: `ClientMessage`, `ServerMessage`, `PeerInfo`, `Role` de Task 3.
- Produces: sala PartyKit en `ws://127.0.0.1:1999/parties/main/<roomId>`.

- [ ] **Step 1: `partykit.json`**

```json
{
  "$schema": "https://www.partykit.io/schema.json",
  "name": "wee-golf",
  "main": "party/server.ts",
  "compatibilityDate": "2025-01-01"
}
```

- [ ] **Step 2: Implementar el servidor**

Estructura, usando `conn.setState()` (no un `Map` externo: sobrevive a hibernación):

```ts
import type * as Party from "partykit/server";
import type { ClientMessage, ServerMessage, PeerInfo, Role } from "../lib/networking/partykit/protocol";
import { isClientMessage } from "../lib/networking/partykit/protocol";

type ConnState = PeerInfo;

export default class WeeGolfRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection<ConnState>, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const role: Role = url.searchParams.get("role") === "host" ? "host" : "controller";
    const peerId = url.searchParams.get("peerId") ?? conn.id;

    // D1: una sala tiene un solo host. El segundo host regenera su roomId.
    if (role === "host" && this.findHost()) {
      this.send(conn, { type: "room-busy" });
      conn.close(4001, "room-busy");
      return;
    }

    const info: ConnState = { peerId, role, joinedAt: Date.now() };
    conn.setState(info);

    this.send(conn, { type: "welcome", peerId, role, peers: this.peers(conn.id) });
    this.broadcastExcept(conn.id, { type: "peer-joined", peer: info });
  }

  onMessage(raw: string, sender: Party.Connection<ConnState>) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!isClientMessage(parsed)) return;
    const msg = parsed as ClientMessage;
    const from = sender.state?.peerId;
    if (!from) return;

    if (msg.type === "signal") {
      // D4: relay DIRIGIDO — nunca broadcast de SDP.
      const target = this.findByPeerId(msg.to);
      if (target) this.send(target, { type: "signal", from, payload: msg.payload });
      return;
    }

    if (msg.type === "telemetry-fallback") {
      const host = this.findHost();
      if (host) this.send(host, { type: "telemetry-fallback", from, sample: msg.sample });
    }
  }

  onClose(conn: Party.Connection<ConnState>) {
    const peerId = conn.state?.peerId;
    if (peerId) this.broadcastExcept(conn.id, { type: "peer-left", peerId });
  }

  // --- helpers: peers(), findHost(), findByPeerId(), send(), broadcastExcept() ---
  // Todos iteran this.room.getConnections<ConnState>() y serializan con JSON.stringify.
}
```

Los helpers son cinco funciones de 2–5 líneas cada una sobre `this.room.getConnections<ConnState>()`. `send(conn, msg: ServerMessage)` hace `conn.send(JSON.stringify(msg))` — tipar el parámetro como `ServerMessage` es lo que impide mandar mensajes fuera de protocolo.

- [ ] **Step 3: Verificar que compila y levanta**

```bash
npx partykit dev
```
Esperado: `Ready on http://127.0.0.1:1999`. Sin errores de TypeScript por importar desde `../lib`.

- [ ] **Step 4: Verificación manual del relay**

Con `partykit dev` corriendo, en dos pestañas de la consola del browser:

```js
// pestaña 1 (host)
const h = new WebSocket("ws://127.0.0.1:1999/parties/main/TEST01?role=host&peerId=H1");
h.onmessage = (e) => console.log("HOST <-", e.data);
// pestaña 2 (controller)
const c = new WebSocket("ws://127.0.0.1:1999/parties/main/TEST01?role=controller&peerId=C1");
c.onmessage = (e) => console.log("CTRL <-", e.data);
c.onopen = () => c.send(JSON.stringify({ type: "signal", to: "H1", payload: { kind: "offer", sdp: "v=0" } }));
```
Esperado: la pestaña 1 loguea `welcome`, luego `peer-joined` con `C1`, luego `signal` con `from:"C1"`.

- [ ] **Step 5: Commit**

```bash
git add party partykit.json && git commit -m "feat(party): room server with host/controller roles and targeted signal relay"
```

---

### Task 5: `lib/networking/partykit/client.ts` — wrapper tipado

**Files:**
- Create: `lib/networking/partykit/client.ts`

**Interfaces:**
- Produces:
```ts
export function connectRoom(args: {
  roomId: string;
  role: Role;
  peerId: PeerId;
  onMessage: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}): {
  send: (msg: ClientMessage) => void;
  socket: PartySocket;
  close: () => void;
};
```

- [ ] **Step 1: Implementar**

Envuelve `PartySocket` de `partysocket` con `host: process.env.NEXT_PUBLIC_PARTYKIT_HOST`, `room: roomId`, `query: { role, peerId }`. En `message`, `JSON.parse` + `isServerMessage` y descartar lo que no valide (nunca hacer cast a ciegas de datos de red). `send` serializa un `ClientMessage`.

`PartySocket` ya reconecta solo con backoff — no reimplementarlo.

- [ ] **Step 2: Verificar tipos**

```bash
npx tsc --noEmit
```
Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add lib/networking/partykit/client.ts && git commit -m "feat(networking): typed PartySocket wrapper with runtime message validation"
```

---

### Task 6: `lib/networking/webrtc/` — config e ice-buffer (TDD)

**Files:**
- Create: `lib/networking/webrtc/config.ts`, `lib/networking/webrtc/ice-buffer.ts`, `lib/networking/webrtc/ice-buffer.test.ts`

**Interfaces:**
- Produces: las constantes de §4 y
```ts
export function createIceBuffer(apply: (c: IceCandidateInit) => Promise<void>): {
  add: (c: IceCandidateInit) => Promise<void>;
  markRemoteDescriptionSet: () => Promise<void>;
  readonly pendingCount: number;
};
```

- [ ] **Step 1: Test que falla**

```ts
// lib/networking/webrtc/ice-buffer.test.ts
import { describe, it, expect, vi } from "vitest";
import { createIceBuffer } from "./ice-buffer";
import type { IceCandidateInit } from "../partykit/protocol";

const cand = (n: string): IceCandidateInit => ({ candidate: n, sdpMid: "0", sdpMLineIndex: 0 });

describe("createIceBuffer", () => {
  it("buffers candidates until the remote description is set", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const buf = createIceBuffer(apply);
    await buf.add(cand("a"));
    await buf.add(cand("b"));
    expect(apply).not.toHaveBeenCalled();
    expect(buf.pendingCount).toBe(2);
  });

  it("flushes buffered candidates in arrival order", async () => {
    const seen: string[] = [];
    const buf = createIceBuffer(async (c) => { seen.push(c.candidate); });
    await buf.add(cand("a"));
    await buf.add(cand("b"));
    await buf.markRemoteDescriptionSet();
    expect(seen).toEqual(["a", "b"]);
    expect(buf.pendingCount).toBe(0);
  });

  it("applies immediately once flushed", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const buf = createIceBuffer(apply);
    await buf.markRemoteDescriptionSet();
    await buf.add(cand("c"));
    expect(apply).toHaveBeenCalledOnce();
    expect(buf.pendingCount).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npm test -- ice-buffer
```
Esperado: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
import type { IceCandidateInit } from "../partykit/protocol";

/** Los candidatos ICE pueden llegar por el relay antes de que tengamos
 *  descripción remota; addIceCandidate lanzaría. Se acumulan y se vacían
 *  en orden en cuanto la descripción está puesta. (Ver D3 del plan.) */
export function createIceBuffer(apply: (c: IceCandidateInit) => Promise<void>) {
  let ready = false;
  const pending: IceCandidateInit[] = [];

  return {
    async add(c: IceCandidateInit) {
      if (ready) await apply(c);
      else pending.push(c);
    },
    async markRemoteDescriptionSet() {
      ready = true;
      while (pending.length) await apply(pending.shift()!);
    },
    get pendingCount() { return pending.length; },
  };
}
```

- [ ] **Step 4: Correr y ver que pasa**

```bash
npm test -- ice-buffer
```
Esperado: PASS, 3 tests.

- [ ] **Step 5: Crear `config.ts`** con las constantes exactas de §4.

- [ ] **Step 6: Commit**

```bash
git add lib/networking/webrtc && git commit -m "feat(webrtc): add ICE candidate buffer and shared connection config"
```

---

### Task 7: `peer-controller.ts` y `peer-host.ts`

**Files:**
- Create: `lib/networking/webrtc/peer-controller.ts`, `lib/networking/webrtc/peer-host.ts`

**Interfaces:** exactamente las firmas de §4. Consume `createIceBuffer`, `ICE_SERVERS`, `DATA_CHANNEL_INIT`, `TELEMETRY_CHANNEL_LABEL`.

- [ ] **Step 1: `peer-controller.ts` (el ofertante)**

`start()` hace, en este orden — el orden importa, el canal debe existir antes de la oferta para que entre el `m=application` en el SDP:

```ts
const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
const dc = pc.createDataChannel(TELEMETRY_CHANNEL_LABEL, DATA_CHANNEL_INIT);
dc.onopen = events.onChannelOpen;
dc.onclose = events.onChannelClose;
pc.onconnectionstatechange = () => events.onState(pc.connectionState);
pc.onicecandidate = (e) => {
  if (e.candidate) sendSignal(hostPeerId, { kind: "ice", candidate: e.candidate.toJSON() as IceCandidateInit });
};
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
sendSignal(hostPeerId, { kind: "offer", sdp: offer.sdp! });
```

`handleSignal`: en `answer` → `setRemoteDescription({type:"answer", sdp})` y después `iceBuffer.markRemoteDescriptionSet()`. En `ice` → `iceBuffer.add(candidate)`.

`send(sample)`: devuelve `false` si `dc.readyState !== "open"`; si está abierto, `dc.send(JSON.stringify(sample))` y devuelve `true`. **Es lo que dispara el fallback WS de la Task 11.**

- [ ] **Step 2: `peer-host.ts` (el registro de peers)**

Mantiene `Map<PeerId, { pc, dc, iceBuffer }>`. En `handleSignal(from, payload)`:

- `offer` → crear la `RTCPeerConnection` para ese `from` si no existe, montar `pc.ondatachannel = (e) => { e.channel.onmessage = (m) => onSample(from, JSON.parse(m.data)); }`, `setRemoteDescription`, `markRemoteDescriptionSet()`, `createAnswer`, `setLocalDescription`, `sendSignal(from, {kind:"answer", sdp})`.
- `ice` → `iceBuffer.add`.

`removePeer` cierra `pc` y borra del Map. `closeAll` para el unmount.

- [ ] **Step 3: Verificar tipos**

```bash
npx tsc --noEmit
```
Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
git add lib/networking/webrtc && git commit -m "feat(webrtc): controller offerer and multi-peer host registry"
```

---

### Task 8: Pantalla host — QR + estado de peers

**Files:**
- Create: `components/host/HostClient.tsx`, `components/host/QrPanel.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: `app/page.tsx` delgado**

```tsx
import { HostClient } from "@/components/host/HostClient";
export default function Page() {
  return <HostClient />;
}
```

- [ ] **Step 2: `HostClient.tsx`**

`"use client"`. En un `useEffect` con guardia de StrictMode (React 19 monta dos veces en dev — usar un `useRef` de "ya arrancado" para no abrir dos sockets):

1. `generateRoomId()` → estado.
2. `connectRoom({ roomId, role: "host", peerId: crypto.randomUUID(), ... })`.
3. Si llega `room-busy` → regenerar id y reintentar (máx. 5).
4. Crear `createHostPeerRegistry`, cablear `signal` → `registry.handleSignal`, `peer-left` → `registry.removePeer`.
5. Cleanup: `closeAll()` + `close()`.

- [ ] **Step 3: `QrPanel.tsx`**

```tsx
const base = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
const url = `${base}/controller/${roomId}`;
```
Renderiza `<QRCode value={url} size={280} />` de `react-qr-code`, el `roomId` en grande y monoespaciado, y la URL en texto pequeño (para poder teclearla si el escaneo falla). El QR debe ir sobre **fondo blanco sólido con padding**; los lectores fallan sobre fondos oscuros.

⚠️ `window` no existe en SSR: leer el origen dentro de un `useEffect` o renderizar el QR solo tras montar.

- [ ] **Step 4: Verificación en escritorio (esto ES el Checkpoint A)**

Dos terminales:
```bash
npm run party:dev     # :1999
npm run dev           # :3000
```
Abrir `http://localhost:3000` → aparece QR + roomId. Copiar la URL del panel, abrirla en **otra pestaña de escritorio**. Esperado: el host lista 1 peer y el estado pasa a `connected`.

En la consola del host debe verse la secuencia `welcome` → `peer-joined` → `signal(offer)` → `signal(ice)…` y `connectionState: connected`.

- [ ] **Step 5: 🛑 PARAR — reportar al usuario y esperar aprobación del Checkpoint A**

- [ ] **Step 6: Commit (solo tras aprobación)**

```bash
git add -A && git commit -m "feat(host): room bootstrap, QR panel and WebRTC peer registry wiring"
```

---

# CHECKPOINT B — deploy a Vercel + PartyKit

**Criterio de aceptación:** la app vive en una URL HTTPS de producción, el servidor PartyKit vive en `*.partykit.dev`, y el QR de producción apunta a la URL real.

---

### Task 9: Deploy

**Files:**
- Modify: `.env.example`, `README.md`

- [ ] **Step 1: 🛑 Mostrar los comandos al usuario y esperar visto bueno antes de ejecutarlos** (requisito explícito del brief)

```bash
# 1) PartyKit — pide login en el browser la primera vez
npx partykit deploy
#    Devuelve una URL tipo: https://wee-golf.<usuario>.partykit.dev
#    ⚠️ Anotar el host SIN el https:// para la env var.

# 2) Vercel
npx vercel link
npx vercel env add NEXT_PUBLIC_PARTYKIT_HOST production
#    Pegar: wee-golf.<usuario>.partykit.dev   (sin protocolo, sin barra final)
npx vercel --prod
```

`NEXT_PUBLIC_APP_URL` **no se setea en Vercel**: sin ella, el QR usa `window.location.origin`, que en producción ya es la URL correcta (D12).

- [ ] **Step 2: Ejecutar los comandos aprobados**

- [ ] **Step 3: Verificar el QR de producción**

Abrir la URL de producción. El texto bajo el QR debe decir `https://<dominio-prod>/controller/XXXXXX` — ni `localhost` ni una IP LAN. Confirmar en DevTools → Network → WS que el socket va a `wss://wee-golf.*.partykit.dev` (**`wss`**, no `ws`: una página HTTPS no puede abrir un WebSocket inseguro).

- [ ] **Step 4: Prueba de humo en producción con dos pestañas de escritorio** — igual que el Checkpoint A, pero contra el dominio real.

- [ ] **Step 5: 🛑 PARAR — reportar y esperar aprobación del Checkpoint B**

- [ ] **Step 6: Commit (solo tras aprobación)**

```bash
git add -A && git commit -m "chore(deploy): ship to Vercel and PartyKit, document production env"
```

---

# CHECKPOINT C — el iPhone envía aceleración al host

**Criterio de aceptación:** escaneas el QR con el iPhone, aparece el botón de permiso, lo tocas, aceptas, y **el host muestra números que cambian al mover el teléfono**.

---

### Task 10: `lib/sensors/` — rate limiter (TDD) + device motion

**Files:**
- Create: `lib/sensors/rate-limiter.ts`, `lib/sensors/rate-limiter.test.ts`, `lib/sensors/device-motion.ts`

**Interfaces:**
```ts
export function createRateLimiter(hz: number, now?: () => number): (t?: number) => boolean;

export type MotionPermission = "granted" | "denied" | "unsupported" | "not-required";
/** ⚠️ DEBE llamarse de forma síncrona dentro del handler del gesto (D6). */
export function requestMotionPermission(): Promise<MotionPermission>;
export function startMotionCapture(onSample: (s: Omit<TelemetrySample, "seq">) => void): () => void;
```

- [ ] **Step 1: Test que falla**

```ts
// lib/sensors/rate-limiter.test.ts
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limiter";

describe("createRateLimiter", () => {
  it("allows the first sample immediately", () => {
    expect(createRateLimiter(60)(0)).toBe(true);
  });

  it("rejects samples arriving faster than the target rate", () => {
    const limit = createRateLimiter(60);   // ~16.67ms
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
    limit(10);          // rechazada — no debe mover la referencia
    expect(limit(17)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npm test -- rate-limiter
```
Esperado: FAIL.

- [ ] **Step 3: Implementar**

```ts
/** No confiamos en el ritmo nativo de `devicemotion`: iOS ronda 60Hz pero
 *  Android puede disparar mucho más rápido. Se limita por reloj propio. */
export function createRateLimiter(hz: number, now: () => number = () => performance.now()) {
  const minInterval = 1000 / hz;
  let last = Number.NEGATIVE_INFINITY;
  return (t: number = now()): boolean => {
    if (t - last < minInterval) return false;
    last = t;
    return true;
  };
}
```

- [ ] **Step 4: Correr y ver que pasa**

```bash
npm test -- rate-limiter
```
Esperado: PASS, 4 tests.

- [ ] **Step 5: `device-motion.ts`**

```ts
type MotionEventCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof DeviceMotionEvent === "undefined") return "unsupported";
  const ctor = DeviceMotionEvent as MotionEventCtor;
  if (typeof ctor.requestPermission !== "function") return "not-required";  // Android / desktop
  try {
    return await ctor.requestPermission();
  } catch {
    return "denied";   // iOS lanza si no hay gesto de usuario o si no es contexto seguro
  }
}
```

`startMotionCapture(onSample)`: crea el rate limiter a `TELEMETRY_HZ`, engancha `window.addEventListener("devicemotion", handler)`, y por cada evento que pase el limiter llama `onSample` con `acc`/`accG`/`rot` como tuplas (o `null` si el campo viene nulo — **`event.acceleration` es null en varios dispositivos**) y `t: performance.now()`. Devuelve la función de cleanup que quita el listener.

- [ ] **Step 6: Commit**

```bash
git add lib/sensors && git commit -m "feat(sensors): clock-driven rate limiter and iOS-aware device motion capture"
```

---

### Task 11: Pantalla del celular — permiso, wake lock y envío

**Files:**
- Create: `components/controller/ControllerClient.tsx`, `components/controller/PermissionGate.tsx`, `components/controller/ConnectionBadge.tsx`
- Create: `app/controller/[roomId]/page.tsx`

- [ ] **Step 1: `app/controller/[roomId]/page.tsx`** — patrón de params asíncronos de Next 15 (D11)

```tsx
import { ControllerClient } from "@/components/controller/ControllerClient";
import { normalizeRoomId } from "@/lib/room/room-id";

export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <ControllerClient roomId={normalizeRoomId(roomId)} />;
}
```

- [ ] **Step 2: `ControllerClient.tsx`**

`"use client"`. Al montar: `connectRoom({ roomId, role: "controller", peerId: crypto.randomUUID() })`. Al recibir `welcome`, buscar el host en `peers` y llamar `createControllerPeer({ hostPeerId, ... }).start()`. Si no hay host en la sala, mostrar "Esperando a la pantalla host" y arrancar cuando llegue `peer-joined` con `role:"host"`.

- [ ] **Step 3: `PermissionGate.tsx` — el gesto único**

Un botón grande (mínimo 64px de alto, es un teléfono). Su `onClick` hace, **en este orden y sin `await` antes de la llamada de permiso**:

```tsx
function onTap() {
  unlockAudio();                    // síncrono — Task 13, debe ir en el mismo gesto (D10)
  const p = requestMotionPermission();   // ⚠️ llamada síncrona, se awaitea DESPUÉS
  navigator.wakeLock?.request("screen").catch(() => {});
  p.then((result) => { /* setState + startMotionCapture si "granted"/"not-required" */ });
}
```

Al conceder: `startMotionCapture` con un contador `seq` incremental → `peer.send(sample)`. **Si `send` devuelve `false`** (canal no abierto), mandar `{type:"telemetry-fallback", sample}` por el socket (D5) y marcar el transporte como `RELAY`.

Estados a mostrar: `unsupported` (no es un móvil), `denied` (con instrucción: Ajustes → Safari → Movimiento y orientación), `granted`, y un contador de muestras enviadas para que se vea que algo sale.

- [ ] **Step 4: `ConnectionBadge.tsx`** — señal / P2P / RELAY / desconectado, con `connectionState` de ICE y visibilidad de la página (`visibilitychange` — al pasar a background, iOS para los sensores).

- [ ] **Step 5: Commit y desplegar para probar en el teléfono**

```bash
git add -A && git commit -m "feat(controller): permission gate, wake lock and 60Hz telemetry transmission"
npx vercel --prod
```

---

### Task 12: Panel de debug del host

**Files:**
- Create: `components/host/TelemetryDebug.tsx`
- Modify: `components/host/HostClient.tsx`

- [ ] **Step 1: Implementar con `useRef` + `requestAnimationFrame`, nunca `setState` a 60Hz** (D8)

Por cada peer, un registro en un ref:

```ts
type PeerStats = {
  last: TelemetrySample | null;
  received: number;
  dropped: number;      // gaps en seq
  outOfOrder: number;   // seq menor que el máximo visto
  maxSeq: number;
  lastArrivalMs: number;
};
```

`onSample` actualiza el ref (sin re-render). Un loop rAF pinta:

- `acc x/y/z` y `accG x/y/z` con 2 decimales, en fuente monoespaciada y **ancho tabular** para que los números no bailen.
- `rot alpha/beta/gamma`.
- **packets/seg** (media móvil sobre 1s), **drops**, **out-of-order**, **edad de la última muestra en ms**.
- Tres barras horizontales para x/y/z con centro en cero (rápido de leer al agitar el teléfono).
- Badge de transporte `P2P` o `RELAY`.

Estos contadores no son adorno: son el instrumental que va a decir si la física de la Fase 2 falla por red o por matemática.

- [ ] **Step 2: Desplegar**

```bash
npx vercel --prod
```

- [ ] **Step 3: 🛑 PARAR — Checkpoint C: prueba en el iPhone**

Guion de prueba a pasarle al usuario:
1. Abrir la URL de producción en la pantalla grande.
2. Escanear el QR con la cámara del iPhone.
3. Debe aparecer el botón de permiso → tocarlo → iOS pregunta → Permitir.
4. Mover/agitar el teléfono.
5. **Esperado:** los números del host cambian en vivo, packets/seg ≈ 55–60, badge en `P2P`.

Si falla, en este orden: ¿badge en `RELAY`? → problema de NAT, y el fallback te salvó. ¿`denied`? → Ajustes → Safari → Movimiento y orientación. ¿No aparece el prompt? → verificar que la URL es `https://` (D6).

- [ ] **Step 4: Commit (solo tras aprobación)**

```bash
git add -A && git commit -m "feat(host): real-time telemetry debug panel with drop and rate diagnostics"
```

---

# CHECKPOINT D — pulso de audio perceptible

**Criterio de aceptación:** el botón de test produce un pulso que se siente/oye en el altavoz del iPhone.

---

### Task 13: `lib/audio/rumble.ts` + botón de test

**Files:**
- Create: `lib/audio/rumble.ts`, `components/controller/RumbleTester.tsx`
- Modify: `components/controller/PermissionGate.tsx` (llamar `unlockAudio()`)

**Interfaces:**
```ts
export function unlockAudio(): void;                                   // síncrono, dentro del gesto
export function isAudioUnlocked(): boolean;
export function playRumble(opts?: { hz?: number; ms?: number; gain?: number }): void;
```

- [ ] **Step 1: Implementar `rumble.ts`**

```ts
let ctx: AudioContext | null = null;

/** Debe correr dentro del handler del gesto del usuario. iOS crea el contexto
 *  en estado "suspended" hasta que un gesto lo reanuda. (Ver D10.) */
export function unlockAudio(): void {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

export function isAudioUnlocked(): boolean {
  return ctx?.state === "running";
}

/** Default del brief: 20Hz, 100ms, ganancia máxima.
 *  hz es ajustable porque el altavoz del iPhone no reproduce 20Hz — lo que se
 *  percibe es distorsión y excursión del cono, y 40–90Hz suele sentirse más.
 *  El Checkpoint D es el A/B que fija el valor definitivo. (Ver D9.) */
export function playRumble({ hz = 20, ms = 100, gain = 1.0 } = {}): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(hz, now);

  // Envolvente de 4ms para evitar un click de conmutación sucio.
  const attack = 0.004;
  const dur = ms / 1000;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.setValueAtTime(gain, now + dur - attack);
  g.gain.linearRampToValueAtTime(0, now + dur);

  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
}
```

- [ ] **Step 2: `RumbleTester.tsx`**

Botón "Probar vibración" (deshabilitado hasta `isAudioUnlocked()`) más dos selectores para el A/B: frecuencia `[20, 40, 60, 90]` Hz y duración `[100, 200, 400]` ms. Debajo, la advertencia visible:

> ⚠️ El interruptor de silencio del iPhone silencia el audio de Safari. Súbelo antes de probar.

- [ ] **Step 3: Desplegar**

```bash
npx vercel --prod
```

- [ ] **Step 4: 🛑 PARAR — Checkpoint D: prueba en el iPhone**

1. Switch de silencio **desactivado**, volumen al máximo.
2. Tocar el botón de permiso (desbloquea el audio).
3. Tocar "Probar vibración" a 20Hz.
4. Probar 40, 60 y 90Hz. **Decirme cuál se siente más** — ese pasa a ser el default.

- [ ] **Step 5: Fijar el default ganador y commit (solo tras aprobación)**

```bash
git add -A && git commit -m "feat(audio): low-frequency rumble pulse with tunable frequency for device A/B"
```

---

### Task 14: Cierre de fase — actualizar `CLAUDE.md`

- [ ] **Step 1:** Marcar Fase 0/1 como completa en `CLAUDE.md`, registrar la frecuencia de rumble ganadora, si el transporte final fue P2P o RELAY, y las URLs de producción (Vercel + PartyKit).
- [ ] **Step 2:** Anotar las preguntas abiertas que hereda la Fase 2 (¿TURN necesario? ¿payload binario? ¿calibración de orientación?).
- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md && git commit -m "docs: record phase 0 outcomes and open questions for phase 2"
```

---

## §5 — Riesgos y modos de fallo conocidos

| # | Riesgo | Impacto | Mitigación en el plan |
|---|---|---|---|
| R1 | `devicemotion` exige HTTPS en iOS | Sensores imposibles de probar en local | Checkpoint C ocurre después del deploy (D6). Documentado `--experimental-https` como alternativa |
| R2 | `requestPermission()` fuera del gesto síncrono | iOS deniega en silencio | Orden explícito del handler en Task 11, Step 3 |
| R3 | NAT simétrico sin TURN | No hay P2P | Fallback por WebSocket + badge de transporte (D5) — **pendiente de tu aprobación** |
| R4 | Candidatos ICE antes de la descripción remota | Conexión intermitente | `ice-buffer` testeado (D3) |
| R5 | Switch de silencio del iPhone | Checkpoint D parece roto sin estarlo | Advertencia en la UI + en el guion de prueba |
| R6 | 20Hz inaudible en un altavoz de teléfono | El "hack" no se percibe | Selector de frecuencia para A/B en dispositivo real (D9) |
| R7 | React 19 StrictMode monta dos veces en dev | Dos sockets, dos salas | Guardia de `useRef` en Task 8, Step 2 |
| R8 | `setState` a 60Hz | Host se traba | Ref + rAF (D8) |
| R9 | `create-next-app@15` podría resolver a 16 | Rompe la constraint del stack | Verificación explícita en Task 1, Step 2 |
| R10 | La pantalla del iPhone se apaga | Los sensores paran a mitad de prueba | Wake Lock en el mismo gesto (D6) |

---

## §6 — Decisiones que necesito de ti antes de empezar

1. **Ruta del proyecto:** ¿`~/Desktop/04_Projects/wee-golf` está bien, o lo quieres en otro sitio?
2. **Fallback WebSocket (D5):** ¿lo incluyo? Recomiendo que **sí** — es el seguro contra que el Checkpoint C se bloquee por NAT y son ~40 líneas.
3. **Vitest (D13):** ¿mantengo los tests de los 4 módulos puros, o cero tests en esta fase?
4. **Idioma de `CLAUDE.md`:** propuesto español (código en inglés). ¿Ok?
5. **Nombre de la app en PartyKit:** propuesto `wee-golf` → `wee-golf.<tu-usuario>.partykit.dev`. ¿Ok?

---

## §7 — Cobertura del brief (autorrevisión)

| Entrega del brief | Tarea |
|---|---|
| 1. `/CLAUDE.md` | Task 1 §6, actualizado en Task 14 |
| 2. Estructura base | Tasks 1, 4, 8, 11 (árbol completo en §3) |
| 3. Servidor PartyKit con roomId y presencia | Tasks 2 + 4 |
| 4. Host con QR a `/controller/[roomId]` | Task 8 (URL de producción en Task 9) |
| 5. Celular: misma sala, SDP, DC `ordered:false, maxRetransmits:0` | Tasks 6, 7, 11 (`DATA_CHANNEL_INIT` en §4) |
| 6. Botón de permiso + `devicemotion` a 60Hz por el canal | Tasks 10 + 11 |
| 7. Hack de vibración 20Hz / 100ms / ganancia máxima | Task 13 |
| 8. Debug de aceleración en vivo en el host | Task 12 |
| Checkpoint A | Task 8, Step 4 |
| Checkpoint B | Task 9 |
| Checkpoint C | Task 12, Step 3 |
| Checkpoint D | Task 13, Step 4 |
| Commit por checkpoint aprobado | Último step de las Tasks 8, 9, 12, 13 |
