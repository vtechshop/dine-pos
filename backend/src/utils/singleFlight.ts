// ─── Single-flight (in-flight request coalescing) ────────────────────────────
// When multiple concurrent requests miss the Redis cache for the same key,
// this utility ensures only one build fn fires; all other callers await that
// same Promise. Once resolved, each caller gets the same result and stores
// it in its own cache write — the store is NOT deduplicated.
//
// This is a process-level guard (not distributed). In a multi-instance
// deployment, each instance independently fires one build per TTL window,
// which is the correct trade-off (Redis cache handles cross-instance sharing).

const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
