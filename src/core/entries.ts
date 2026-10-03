/** Decode UTF-8 and group physical lines into timestamped blocks. Leading and continuation lines retain their original positions inside a block. */
import { createTimestampParser } from './timestamp';
import { fallbackTimezone } from './timezone';
import type { Entry, ParsedSource, ParseOptions, Source } from './types';

export function decodeInput(bytes: Uint8Array, name: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`${name}: Invalid UTF-8 encoding; convert the file to UTF-8 before merging.`); }
}

export function parseEntries(text: string, source: Source, options: ParseOptions): ParsedSource {
  const start = performance.now();
  const fallback = fallbackTimezone(options.timezone);
  let parser;
  try { parser = createTimestampParser(options.format, fallback); }
  catch (error) { throw new Error(`${source.name}: ${error instanceof Error ? error.message : String(error)}`); }
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized === '' ? [] : normalized.split('\n');
  if (normalized.endsWith('\n')) lines.pop();
  const entries: Entry[] = [];
  const leading: string[] = [];
  let format: string | undefined;
  let separator: string | undefined;
  let usedFallback = false;
  let firstFallbackLine: number | undefined;
  let continuations = 0;
  for (const [index, line] of lines.entries()) {
    try {
      const stamp = parser.parse(line);
      if (stamp) {
        if (format && stamp.format !== format) throw new Error('Conflicting timestamp formats in one file; normalize the file before merging.');
        if (separator && stamp.fractionSeparator && separator !== stamp.fractionSeparator) throw new Error('Conflicting fractional separators in one file.');
        format = stamp.format;
        separator ??= stamp.fractionSeparator;
        usedFallback ||= stamp.usedFallback;
        if (stamp.usedFallback) firstFallbackLine ??= index + 1;
        entries.push({ key: stamp.key, source, line: index + 1, lines: entries.length ? [line] : [...leading, line] });
      } else {
        continuations++;
        const current = entries.at(-1);
        if (current) current.lines.push(line);
        else leading.push(line);
      }
    } catch (error) {
      throw new Error(`${source.name}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (lines.length && !entries.length) throw new Error(`${source.name}: No valid timestamps; supply a matching format override or exclude this file.`);
  return { entries, diagnostics: {
    format: format ? `${format}${!options.format ? ` (auto; fraction ${separator ?? 'optional'}, optional offset)` : ' (override)'}` : 'empty',
    entries: entries.length, continuations, leading: leading.length, lines: lines.length,
    usedFallback, firstFallbackLine, durationMs: performance.now() - start,
  } };
}
