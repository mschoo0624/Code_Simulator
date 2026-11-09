import { createHash } from "node:crypto";

/** Simple bounded in-memory cache with FIFO eviction. */
export class BoundedCache<T> {
  private map = new Map<string, T>();

  constructor(private maxEntries = 100) {}

  get(key: string): T | undefined {
    return this.map.get(key);
  }

  set(key: string, value: T): void {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

export function requestKey(language: string, solution: string, driver: string): string {
  return createHash("sha256")
    .update(language)
    .update("\u0000")
    .update(solution)
    .update("\u0000")
    .update(driver)
    .digest("hex");
}
