/** We don't trust devicemotion's native cadence: iOS hovers around 60Hz but
 *  Android can fire much faster. Sampling is gated by our own clock. */
export function createRateLimiter(hz: number, now: () => number = () => performance.now()) {
  const minInterval = 1000 / hz;
  let last = Number.NEGATIVE_INFINITY;
  return (t: number = now()): boolean => {
    if (t - last < minInterval) return false;
    last = t;
    return true;
  };
}
