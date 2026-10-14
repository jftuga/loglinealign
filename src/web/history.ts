/** Most-recently-used values per field type, kept in browser storage. Entries are compared by their JSON form, so a filter bundle differs from the same text with other options. */
import { readStored, removeStored, writeStored } from './storage';

export const HISTORY_LIMIT = 5;

export type EntryGuard<T> = (value: unknown) => value is T;

export const isString: EntryGuard<string> = (value): value is string => typeof value === 'string';

/** Move an entry to the front without duplicates, keeping at most the limit. */
export function pushRecent<T>(entries: readonly T[], entry: T, limit = HISTORY_LIMIT): T[] {
  const key = JSON.stringify(entry);
  return [entry, ...entries.filter(item => JSON.stringify(item) !== key)].slice(0, limit);
}

export function readHistory<T>(field: string, isEntry: EntryGuard<T>): T[] {
  const stored = readStored(`history:${field}`);
  return Array.isArray(stored) ? stored.filter(isEntry).slice(0, HISTORY_LIMIT) : [];
}

export function recordHistory<T>(field: string, entry: T, isEntry: EntryGuard<T>): void {
  writeStored(`history:${field}`, pushRecent(readHistory(field, isEntry), entry));
}

export function clearHistory(field: string): void {
  removeStored(`history:${field}`);
}
