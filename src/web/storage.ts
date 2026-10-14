/** Namespaced JSON values in this browser's localStorage. Storage can be disabled, full, or private, so every access tolerates failure and reports it to callers that need to know. */
const prefix = 'loglinealign:';

export function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(prefix + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch { return undefined; }
}

export function writeStored(key: string, value: unknown): boolean {
  try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function removeStored(key: string): boolean {
  try { localStorage.removeItem(prefix + key); return true; }
  catch { return false; }
}

/** Remove only this application's keys: some browsers share one storage origin among all local file:// pages. */
export function clearStored(): boolean {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '').filter(key => key.startsWith(prefix));
    for (const key of keys) localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
