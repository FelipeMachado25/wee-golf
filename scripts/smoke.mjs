/**
 * Headless end-to-end smoke test: boots a host page and an emulated iPhone
 * controller in WebKit (Safari's engine — the browser this game actually
 * ships to), joins them, saves a profile, starts a round and reports any
 * uncaught exception plus a screenshot.
 *
 *   npm run build && npx next start -p 3210 &
 *   npx wrangler dev &
 *   node scripts/smoke.mjs [baseUrl]
 */
import { webkit, devices } from "playwright";

const B = process.argv[2] ?? "http://localhost:3210";
const browser = await webkit.launch();
const errs = [];

const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
host.on("pageerror", (e) => errs.push("HOST: " + e.message));
await host.goto(B + "/", { waitUntil: "domcontentloaded" });
await host.waitForTimeout(3500);
const room = (await host.textContent("body")).match(/controller\/([A-Z0-9]{6})/)?.[1];
console.log("room:", room);

const phone = await (await browser.newContext(devices["iPhone 14"])).newPage();
phone.on("pageerror", (e) => errs.push("PHONE: " + e.message));
await phone.goto(`${B}/controller/${room}`, { waitUntil: "domcontentloaded" });
await phone.waitForTimeout(4000);

await phone.fill("input[type=text],input:not([type])", "Felipe").catch(() => {});
await phone.getByRole("button", { name: /^Save$/ }).click().catch((e) => console.log("save:", e.message));
await phone.waitForTimeout(1200);

await host.getByRole("button", { name: /Start round/i }).click().catch((e) => console.log("start:", e.message));
await host.waitForTimeout(4000);

console.log("phone pad:", (await phone.textContent("body")).replace(/\s+/g, " ").slice(0, 220));
await host.screenshot({ path: "/tmp/wee-smoke.png" });
console.log("screenshot: /tmp/wee-smoke.png");
console.log("ERRORS:", errs.length ? errs : "none");
await browser.close();
process.exit(errs.length ? 1 : 0);
