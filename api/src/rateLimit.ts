/** In-memory sliding-window per-IP rate limiter. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private limit = 6,
    private windowMs = 60_000,
  ) {}

  /** Returns true when the request is allowed. */
  allow(ip: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(ip) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.limit) {
      this.hits.set(ip, list);
      return false;
    }
    list.push(now);
    this.hits.set(ip, list);
    // opportunistic cleanup so the map cannot grow unboundedly
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => t <= cutoff)) this.hits.delete(k);
      }
    }
    return true;
  }
}
