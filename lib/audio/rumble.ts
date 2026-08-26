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

/** Default 60Hz: winner of the Checkpoint D A/B on the user's real iPhone
 *  (2026-08-26). The brief's original 20Hz is inaudible on a phone speaker —
 *  it can't reproduce it; what you feel is harmonic distortion and cone
 *  excursion, which is why the audible 40–90Hz band won (plan D9). */
export function playRumble({ hz = 60, ms = 100, gain = 1.0 } = {}): void {
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
