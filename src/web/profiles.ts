/** Named snapshots of every interface setting, stored in browser storage. Log contents are never saved; per-file settings are keyed by filename so they can be applied to files loaded later. */
import { isFilterOptions } from './filter';
import type { FilterOptions } from './filter';
import { isRecord, readStored, writeStored } from './storage';

const key = 'profiles';
const version = 1;

export interface SavedSource {
  name: string;
  included: boolean;
  format: string;
  timezone: string;
  timeShift: string;
}

export interface Profile {
  version: number;
  savedAt: string;
  sources: SavedSource[];
  timezone: string;
  checks: Record<string, boolean>;
  filters: FilterOptions[];
  downloadName: string;
}

export type ProfileSettings = Omit<Profile, 'version' | 'savedAt'>;

function isSavedSource(value: unknown): value is SavedSource {
  return isRecord(value) && typeof value.included === 'boolean' && ['name', 'format', 'timezone', 'timeShift'].every(field => typeof value[field] === 'string');
}

/** Validate a stored profile; anything malformed or from another version is ignored rather than partially applied. */
export function parseProfile(value: unknown): Profile | undefined {
  if (!isRecord(value) || value.version !== version) return undefined;
  const { savedAt, sources, timezone, checks, filters, downloadName } = value;
  if (typeof savedAt !== 'string' || typeof timezone !== 'string' || typeof downloadName !== 'string') return undefined;
  if (!Array.isArray(sources) || !sources.every(isSavedSource)) return undefined;
  if (!Array.isArray(filters) || !filters.every(isFilterOptions)) return undefined;
  if (!isRecord(checks) || !Object.values(checks).every(state => typeof state === 'boolean')) return undefined;
  return { version, savedAt, sources, timezone, checks: checks as Record<string, boolean>, filters, downloadName };
}

/** Profiles sorted by name. Stored as an array, so names such as __proto__ stay ordinary data. */
export function readProfiles(): Map<string, Profile> {
  const stored = readStored(key);
  const profiles = new Map<string, Profile>();
  if (!Array.isArray(stored)) return profiles;
  for (const item of stored) {
    const profile = isRecord(item) && typeof item.name === 'string' ? parseProfile(item.profile) : undefined;
    if (profile) profiles.set(item.name as string, profile);
  }
  return new Map([...profiles].sort(([a], [b]) => a.localeCompare(b)));
}

function writeProfiles(profiles: Map<string, Profile>): boolean {
  return writeStored(key, [...profiles].map(([name, profile]) => ({ name, profile })));
}

export function saveProfile(name: string, profile: ProfileSettings): boolean {
  const profiles = readProfiles();
  profiles.set(name, { ...profile, version, savedAt: new Date().toISOString() });
  return writeProfiles(profiles);
}

export function deleteProfile(name: string): boolean {
  const profiles = readProfiles();
  profiles.delete(name);
  return writeProfiles(profiles);
}
