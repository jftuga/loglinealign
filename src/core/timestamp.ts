/** Parse explicit timestamp grammars into integer nanoseconds. Recognition is deliberately strict and never delegates to Date.parse. */
import type { Timestamp } from './types';
import { missingTimezoneMessage, parseTimezone } from './timezone';

interface CalendarFields {
  YYYY: string;
  MM: string;
  DD: string;
  HH: string;
  mm: string;
  ss: string;
  fraction?: string;
  zone?: string;
}

export interface TimestampParser {
  parse: (line: string) => Timestamp | undefined;
}

interface CompiledFormat {
  expression: RegExp;
  endsWithField: boolean;
}

// Recognize calendar-looking date starts, including short/incomplete dates, anywhere in a line.
const dateCandidate = /(?<![\dA-Za-z])(?:\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})(?!\d)/g;
// Full year-first date and complete clock. Greedy optional fields consume fractions and offsets before considering the shorter form.
const automatic = /^(\d{4})([-/])(\d{2})\2(\d{2})(T| )(\d{2}):(\d{2}):(\d{2})(?:([.,])(\d+))?(Z|[+-]\d{2}:?\d{2})?/;
// A date followed by T or a whitespace-separated clock is a timestamp candidate, even if malformed.
// Allow leftover date digits/separators here so a malformed date cannot hide beside a valid timestamp.
const clockAfterDate = /^[-/\d]*(?:T|[ \t]+\d+:)/;
// Clock-only or month/day records at a line boundary are recognizable incomplete timestamps.
const incomplete = /^\s*\[?(?:\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2})(?!\d)/;

function calendarKey(fields: CalendarFields, fallback: number | undefined): { key: bigint; usedFallback: boolean } {
  const year = Number(fields.YYYY);
  const month = Number(fields.MM);
  const day = Number(fields.DD);
  const hour = Number(fields.HH);
  const minute = Number(fields.mm);
  const second = Number(fields.ss);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new Error('Invalid calendar date; use a complete date in years 0001–9999.');
  }
  if (hour > 23 || minute > 59 || second > 59) throw new Error('Invalid clock time; leap seconds and 24:00 are unsupported.');
  if ((fields.fraction?.length ?? 0) > 9) throw new Error('Fractional seconds support at most nine digits.');
  let zone = fields.zone;
  if (zone && zone !== 'Z' && !zone.includes(':')) zone = zone.slice(0, 3) + ':' + zone.slice(3);
  const offset = zone ? parseTimezone(zone) : fallback;
  if (offset === undefined) throw new Error(missingTimezoneMessage);
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const key = BigInt(date.getTime() - offset * 60000) * 1000000n + BigInt((fields.fraction ?? '').padEnd(9, '0'));
  return { key, usedFallback: !zone };
}

function validateTail(tail: string): void {
  // Reject truncated clocks/fractions/offsets and attached suffixes, while permitting prose punctuation.
  if (/^[\dA-Za-z:+-]|^[.,]\d/.test(tail)) throw new Error('Malformed timestamp suffix or unsupported timezone.');
  if (/^\s+(?:Z|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|CET|CEST|[A-Za-z_]+\/[A-Za-z_]+)(?=$|[\s\]])/.test(tail)) throw new Error('Named or whitespace-separated timezones are unsupported; use an attached Z or numeric offset.');
  if (/^\s+[+-]\d{2}:?\d{2}/.test(tail)) throw new Error('Offset must be attached to the timestamp or included in an explicit format.');
}

function matchAutomatic(tail: string): RegExpExecArray {
  if (!/^\d{4}[-/]/.test(tail)) throw new Error('Numeric date order requires a format override such as DD/MM/YYYY HH:mm:ss.');
  const match = automatic.exec(tail);
  if (!match || (match[2] === '/' && match[5] !== ' ')) throw new Error('Unsupported or incomplete timestamp; use a full date and HH:mm:ss.');
  validateTail(tail.slice(match[0].length));
  return match;
}

function automaticFields(match: RegExpExecArray): CalendarFields {
  return { YYYY: match[1]!, MM: match[3]!, DD: match[4]!, HH: match[6]!, mm: match[7]!, ss: match[8]!, fraction: match[10], zone: match[11] };
}

function automaticFormat(match: RegExpExecArray): string {
  return `YYYY${match[2]}MM${match[2]}DD${match[5] === 'T' ? '[T]' : ' '}HH:mm:ss`;
}

function ambiguousTimestampMessage(line: string, candidates: RegExpMatchArray[]): string {
  const formats = new Set<string>();
  for (const candidate of candidates) {
    try {
      const match = matchAutomatic(line.slice(candidate.index));
      // Validate each suggestion independently; UTC here only permits timezone-free candidates.
      calendarKey(automaticFields(match), 0);
      const fraction = match[10] ? match[9]! + 'S'.repeat(match[10].length) : '';
      const zone = match[11] ? (match[11] === 'Z' || match[11].includes(':') ? 'Z' : 'ZZ') : '';
      formats.add(automaticFormat(match) + fraction + zone);
    } catch {
      // Malformed or unsupported candidates still cause ambiguity, but cannot supply a usable format.
    }
  }
  const suggestions = formats.size ? [...formats].map(format => `"${format}"`).join(', ') : 'none (no valid supported timestamp candidates)';
  return `Multiple timestamp candidates with clock fields on one line; use a format override with distinguishing literals. Possible candidates: ${suggestions}.`;
}

function parseAutomatic(line: string, fallback: number | undefined): Timestamp | undefined {
  const candidates = [...line.matchAll(dateCandidate)];
  const timestampCandidates = candidates.filter(candidate => clockAfterDate.test(line.slice(candidate.index + candidate[0].length)));
  if (timestampCandidates.length > 1) throw new Error(ambiguousTimestampMessage(line, timestampCandidates));
  // Prefer a full timestamp over dates mentioned anywhere else in the line. Without one, retain strict incomplete-date errors.
  const candidate = timestampCandidates[0] ?? candidates[0];
  if (!candidate) {
    if (incomplete.test(line)) throw new Error('Incomplete timestamp; a full calendar date and complete time are required.');
    return undefined;
  }
  const tail = line.slice(candidate.index);
  const match = matchAutomatic(tail);
  const result = calendarKey(automaticFields(match), fallback);
  return { ...result, format: automaticFormat(match), fractionSeparator: match[9] };
}

function escapeRegex(text: string): string {
  // Escape punctuation when turning the user's literal text into a regex.
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileFormat(format: string): CompiledFormat {
  const fields = new Set<string>();
  let pattern = '';
  let index = 0;
  let endsWithField = false;
  while (index < format.length) {
    if (format[index] === '[') {
      const end = format.indexOf(']', index + 1);
      if (end < 0) throw new Error('Format has an unclosed bracketed literal.');
      pattern += escapeRegex(format.slice(index + 1, end));
      if (end > index + 1) endsWithField = false;
      index = end + 1;
      continue;
    }
    const token = /^(YYYY|MM|DD|HH|mm|ss|S{1,9}|ZZ|Z)/.exec(format.slice(index))?.[0];
    if (token) {
      const field = token.startsWith('S') ? 'fraction' : token.startsWith('Z') ? 'zone' : token;
      if (fields.has(field)) throw new Error(`Repeated format field: ${field}.`);
      fields.add(field);
      const expression = token === 'Z' ? '(?:Z|[+-]\\d{2}:\\d{2})' : token === 'ZZ' ? '[+-]\\d{4}' : `\\d{${token.length}}`;
      pattern += `(?<${field}>${expression})`;
      endsWithField = true;
      index += token.length;
    } else {
      if (/[A-Za-z\[\]]/.test(format[index]!)) throw new Error('Unknown format token; enclose literal letters in brackets, for example [T].');
      pattern += escapeRegex(format[index]!);
      endsWithField = false;
      index++;
    }
  }
  for (const field of ['YYYY', 'MM', 'DD', 'HH', 'mm', 'ss']) {
    if (!fields.has(field)) throw new Error(`Incomplete format; ${field} is required.`);
  }
  // Field boundaries prevent truncated values; explicit trailing literals already delimit the timestamp.
  return { expression: new RegExp(`(?<![\\dA-Za-z])${pattern}${endsWithField ? '(?!\\d)' : ''}`, 'g'), endsWithField };
}

function parseOverride(line: string, format: string, compiled: CompiledFormat, fallback: number | undefined): Timestamp | undefined {
  const matches = [...line.matchAll(compiled.expression)];
  if (matches.length > 1) throw new Error('Multiple timestamps match the override on one line; add distinguishing literals.');
  const match = matches[0];
  if (!match) {
    if ([...line.matchAll(dateCandidate)].length || incomplete.test(line)) throw new Error('Recognizable timestamp does not match the selected format override.');
    return undefined;
  }
  if (compiled.endsWithField) validateTail(line.slice(match.index + match[0].length));
  return { ...calendarKey(match.groups as unknown as CalendarFields, fallback), format };
}

function parseEpoch(line: string, format: string): Timestamp | undefined {
  // Reject recognizable calendar/clock records before their year or minute fields can become epochs.
  if ([...line.matchAll(dateCandidate)].length || incomplete.test(line)) throw new Error('Calendar timestamp does not match the epoch override.');
  // Only standalone signed numeric tokens are epoch candidates; ignore digits embedded in identifiers.
  const matches = [...line.matchAll(/(?<![\w.+-])[+-]?\d+(?:[.,]\d+)?(?![\w.+-])/g)];
  if (matches.length > 1) throw new Error('Multiple numeric epoch candidates on one line; isolate the timestamp before merging.');
  const value = matches[0]?.[0];
  if (!value) return undefined;
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^[+-]/, '');
  const parts = unsigned.split('.');
  if (value.includes(',') || (parts.length > 1 && format !== 'epoch-s')) throw new Error('Only epoch-s accepts a decimal-point fractional field; other epoch formats require integers.');
  if ((parts[1]?.length ?? 0) > 9) throw new Error('Epoch seconds support at most nine fractional digits.');
  const scales: Record<string, bigint> = { 'epoch-s': 1000000000n, 'epoch-ms': 1000000n, 'epoch-us': 1000n, 'epoch-ns': 1n };
  const key = BigInt(parts[0]!) * scales[format]! + BigInt((parts[1] ?? '').padEnd(9, '0'));
  return { key: negative ? -key : key, format, usedFallback: false };
}

export function createTimestampParser(format: string | undefined, fallback: number | undefined): TimestampParser {
  if (!format) return { parse: line => parseAutomatic(line, fallback) };
  if (['epoch-s', 'epoch-ms', 'epoch-us', 'epoch-ns'].includes(format)) return { parse: line => parseEpoch(line, format) };
  const compiled = compileFormat(format);
  return { parse: line => parseOverride(line, format, compiled, fallback) };
}
