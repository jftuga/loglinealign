/** Compile browser filter text into a per-line matcher. Literal text is escaped, while regex mode uses JavaScript Unicode expressions. */
import type { Entry } from '../core/types';

export const MAX_FILTERS = 3;

/** Shared by field swatches and preview highlights; additional slots get distinct hues. */
export function filterColor(index: number): string {
  return ['#ffe08a', '#8ad8ff', '#f5a7d5'][index] ?? `hsl(${(index * 137.508) % 360} 80% 78%)`;
}

export interface FilterOptions {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  invert: boolean;
}

export type MatchRange = [start: number, end: number];

export interface HighlightRange {
  start: number;
  end: number;
  filters: number[];
}

export interface CompiledFilter {
  matcher: RegExp | undefined;
  invert: boolean;
}

export function compileFilters(options: FilterOptions[]): CompiledFilter[] {
  return options.map((option, index) => {
    try { return { matcher: createFilter(option), invert: option.invert }; }
    catch (error) { throw new Error(`Filter ${index + 1}: ${(error as Error).message}`); }
  });
}

export function createFilter(options: FilterOptions): RegExp | undefined {
  if (options.text === '') return undefined;
  // Escape regex punctuation so normal filter text is always interpreted literally.
  const pattern = options.regex ? options.text : options.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = options.matchCase ? 'u' : 'iu';
  try {
    // Validate before wrapping: added word-boundary brackets must not repair an invalid query.
    const matcher = new RegExp(pattern, flags);
    if (!options.wholeWord) return matcher;
    // Letters, combining marks, numbers, and underscores belong to a word in any script.
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}_])`, flags);
  }
  catch { throw new Error('Invalid regular expression. Check the pattern, or turn off Regular expression to match literal text.'); }
}

export function filterEntries(entries: Entry[], filters: CompiledFilter[]): Entry[] {
  if (filters.every(filter => !filter.matcher)) return entries;
  const filtered: Entry[] = [];
  for (const entry of entries) {
    // Short-circuit in field order: each filter only sees lines retained by earlier filters.
    const lines = entry.lines.filter(line => filters.every(({ matcher, invert }) => !matcher || matcher.test(line) !== invert));
    if (lines.length) filtered.push(lines.length === entry.lines.length ? entry : { ...entry, lines });
  }
  return filtered;
}

/** Split overlapping matches into disjoint spans, preserving every contributing filter. */
export function highlightRanges(text: string, filters: CompiledFilter[]): HighlightRange[] {
  const events: { position: number; filter: number; delta: number }[] = [];
  for (const [filter, { matcher, invert }] of filters.entries()) {
    if (invert) continue;
    for (const [start, end] of matchRanges(text, matcher)) {
      events.push({ position: start, filter, delta: 1 }, { position: end, filter, delta: -1 });
    }
  }
  events.sort((a, b) => a.position - b.position);
  const active = new Set<number>();
  const ranges: HighlightRange[] = [];
  let position = 0;
  for (let index = 0; index < events.length;) {
    const next = events[index]!.position;
    if (next > position && active.size) ranges.push({ start: position, end: next, filters: [...active].sort((a, b) => a - b) });
    while (index < events.length && events[index]!.position === next) {
      const event = events[index++]!;
      if (event.delta > 0) active.add(event.filter);
      else active.delete(event.filter);
    }
    position = next;
  }
  return ranges;
}

/** Find nonoverlapping visible matches using the same expression as line filtering. Unicode matchAll advances safely past zero-width matches, which have no text to highlight. */
export function matchRanges(text: string, matcher?: RegExp): MatchRange[] {
  if (!matcher) return [];
  const ranges: MatchRange[] = [];
  for (const match of text.matchAll(new RegExp(matcher.source, matcher.flags + 'g'))) {
    if (match[0].length) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}
