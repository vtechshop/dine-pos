// After a deploy, tabs still running the old build request lazy-loaded chunks
// whose hashed filenames no longer exist. A single reload picks up the new build.

const KEY       = 'dinepos:chunk-reload-at';
const WINDOW_MS = 30_000;

/** True if the error is a failed lazy-chunk load (Chrome, Firefox, Safari wording). */
export function isStaleChunkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i
    .test(msg);
}

/**
 * Reload the page once to pick up the new build. Returns false — and does not
 * reload — if we already tried within the last 30s (chunk genuinely missing)
 * or sessionStorage is unavailable (no way to guard against a reload loop).
 */
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
