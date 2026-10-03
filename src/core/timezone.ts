/** Validate fixed UTC offsets independently of the host timezone. Offsets are minutes east of UTC. */
export const missingTimezoneMessage = 'Timestamp has no timezone; supply --timezone UTC or ±HH:MM (browser: Fallback timezone).';

export function parseTimezone(value: string): number {
  if (value === 'UTC' || value === 'Z') return 0;
  // Require a signed two-digit hour and minute, separated by a colon.
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Timezone must be UTC or a numeric offset such as +02:00.');
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) throw new Error('Timezone offset must be within ±23:59.');
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

export function fallbackTimezone(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'Z') throw new Error('Use UTC for the fallback timezone, or an offset such as +02:00.');
  return parseTimezone(value);
}
