let ctx: AudioContext | null = null;

/** Must run inside the user-gesture handler: iOS creates the context in
 *  "suspended" state until a gesture resumes it (plan D10). Shares the same
 *  tap as the motion-permission button. */
export function unlockAudio(): void {
  if (typeof AudioContext === "undefined") return;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

export function isAudioUnlocked(): boolean {
  return ctx?.state === "running";
}

/** Brief-spec default: 20Hz sine, 100ms, max gain. hz is tunable because a
 *  phone speaker cannot reproduce 20Hz — what you feel is harmonic distortion
 *  and cone excursion, and 40–90Hz usually reads stronger. Checkpoint D is the
 *  on-device A/B that picks the final value (plan D9). */
export function playRumble({ hz = 20, ms = 100, gain = 1.0 } = {}): void {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(hz, now);

  // ~4ms attack/release envelope to avoid a dirty switching click.
  const attack = 0.004;
  const dur = Math.max(ms / 1000, attack * 2);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attack);
  g.gain.setValueAtTime(gain, now + dur - attack);
  g.gain.linearRampToValueAtTime(0, now + dur);

  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}
