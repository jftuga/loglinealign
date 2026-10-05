/** Parse and apply constant per-file time adjustments using whole minutes. Adjustments change merge keys without rewriting log text or modifying cached entries. */
import type { Entry } from './types';

export function parseTimeShift(value: string): bigint {
  // A mandatory sign, at least two hour digits, and exactly two minute digits.
  const match = /^([+-])(\d{2,}):([0-5]\d)$/.exec(value);
  if (!match) throw new Error('Time adjustment must be signed hours and minutes, such as +01:00 or -00:30.');
  const minutes = BigInt(match[2]!) * 60n + BigInt(match[3]!);
  return match[1] === '-' ? -minutes : minutes;
}

export function formatTimeShift(minutes: bigint): string {
  const magnitude = minutes < 0n ? -minutes : minutes;
  return `${minutes < 0n ? '-' : '+'}${String(magnitude / 60n).padStart(2, '0')}:${String(magnitude % 60n).padStart(2, '0')}`;
}

export function applyTimeShift(entries: Entry[], minutes: bigint): Entry[] {
  if (minutes === 0n) return entries;
  const nanoseconds = minutes * 60_000_000_000n;
  return entries.map(entry => ({ ...entry, key: entry.key + nanoseconds }));
}
