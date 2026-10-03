/** Compile browser filter text into a per-line matcher. Literal text is escaped, while regex mode uses JavaScript Unicode expressions. */
import type { Entry } from '../core/types';

export interface FilterOptions {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  invert: boolean;
}

export type MatchRange = [start: number, end: number];

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

export function filterEntries(entries: Entry[], options: FilterOptions): Entry[] {
  const matcher = createFilter(options);
  if (!matcher) return entries;
  const filtered: Entry[] = [];
  for (const entry of entries) {
    const lines = entry.lines.filter(line => matcher.test(line) !== options.invert);
    if (lines.length) filtered.push(lines.length === entry.lines.length ? entry : { ...entry, lines });
  }
  return filtered;
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
