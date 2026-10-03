/** Keep decoding, parsing, sorting, filtering, and full downloads off the UI thread. Cache each source by parsing settings and discard superseded merge and filter results. */
import { decodeInput, parseEntries } from '../core/entries';
import { resolveFallback } from '../core/fallback';
import { mergeEntries } from '../core/merge';
import { formatLine, outputChunks, sourceLabelWidth } from '../core/format';
import { fallbackTimezone } from '../core/timezone';
import { createFilter, filterEntries, matchRanges } from './filter';
import type { Entry, ParsedSource, Source } from '../core/types';
import type { FileReport, PreviewRow, WorkerRequest, WorkerResponse } from './protocol';

interface CachedFile {
  file: File;
  text?: string;
  decodeError?: string;
  format?: string;
  timezone?: string;
  parsed?: ParsedSource;
  error?: string;
}

const cache = new Map<number, CachedFile>();
let entries: Entry[] = [];
let filteredEntries: Entry[] = [];
let highlightMatcher: RegExp | undefined;
let offsets: number[] = [];
let total = 0;
let filenameWidth = 0;
let latestRevision = 0;
let resultRevision = -1;
let latestFilterRevision = 0;
let resultFilterRevision = -1;
let queue = Promise.resolve();

function reply(message: WorkerResponse): void { self.postMessage(message); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function merge(request: Extract<WorkerRequest, { type: 'merge' }>): Promise<void> {
  const started = performance.now();
  const ids = new Set(request.sources.map(source => source.id));
  for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  entries = [];
  filteredEntries = [];
  highlightMatcher = undefined;
  offsets = [];
  total = 0;
  filenameWidth = sourceLabelWidth(request.sources.filter(source => source.included).map(source => source.label));
  resultRevision = -1;
  resultFilterRevision = -1;
  if (request.sources.some(source => source.included)) fallbackTimezone(request.timezone);
  const reports: FileReport[] = [];
  const errors: string[] = [];
  const inputs: { source: Source; parsed: ParsedSource }[] = [];
  const timezone = request.timezone || 'UTC';
  for (const source of request.sources) {
    if (request.revision !== latestRevision) return;
    let stored = cache.get(source.id);
    if (!stored) { stored = { file: source.file }; cache.set(source.id, stored); }
    if (!source.included) continue;
    const reusable = stored.format === source.format && (stored.timezone === timezone || (stored.parsed && !stored.parsed.diagnostics.usedFallback));
    if (!reusable || (!stored.parsed && !stored.error)) {
      stored.parsed = undefined;
      stored.error = undefined;
      try {
        if (stored.decodeError) throw new Error(stored.decodeError);
        if (stored.text === undefined) {
          const bytes = new Uint8Array(await stored.file.arrayBuffer());
          try { stored.text = decodeInput(bytes, source.name); }
          catch (error) { stored.decodeError = errorText(error); throw error; }
        }
        stored.parsed = parseEntries(stored.text, source, { format: source.format || undefined, timezone });
      } catch (error) { stored.error = errorText(error); }
      stored.format = source.format;
      stored.timezone = timezone;
    }
    if (stored.error) errors.push(stored.error);
    if (stored.parsed) {
      // Labels can change when another file with the same name is first added.
      for (const entry of stored.parsed.entries) entry.source = source;
      inputs.push({ source, parsed: stored.parsed });
    }
    reports.push({ id: source.id, size: source.file.size, diagnostics: stored.parsed?.diagnostics, error: stored.error, cached: Boolean(reusable) });
  }
  if (request.revision !== latestRevision) return;
  const resolution = resolveFallback(inputs, request.timezone, !errors.length);
  for (const report of reports) {
    const error = resolution.errors.get(report.id);
    if (error) { report.error = error; errors.push(error); }
  }
  if (!errors.length) {
    entries = mergeEntries(inputs.map(input => input.parsed.entries), request.reverse);
  }
  resultRevision = request.revision;
  const originalTotal = entries.reduce((sum, entry) => sum + entry.lines.length, 0);
  reply({ type: 'merged', revision: request.revision, total: originalTotal, entries: entries.length, reports, errors, warning: errors.length ? undefined : resolution.warning, durationMs: performance.now() - started });
}

function applyFilter(request: Extract<WorkerRequest, { type: 'filter' }>): void {
  if (request.revision !== resultRevision || request.filterRevision !== latestFilterRevision) return;
  const started = performance.now();
  filteredEntries = [];
  highlightMatcher = undefined;
  offsets = [];
  total = 0;
  resultFilterRevision = -1;
  try {
    filteredEntries = filterEntries(entries, request.options);
    if (!request.options.invert) highlightMatcher = createFilter(request.options);
    for (const entry of filteredEntries) { offsets.push(total); total += entry.lines.length; }
    resultFilterRevision = request.filterRevision;
    reply({ type: 'filtered', revision: request.revision, filterRevision: request.filterRevision, total, entries: filteredEntries.length, durationMs: performance.now() - started });
  } catch (error) {
    reply({ type: 'filtered', revision: request.revision, filterRevision: request.filterRevision, total: 0, entries: 0, durationMs: performance.now() - started, error: errorText(error) });
  }
}

function view(request: Extract<WorkerRequest, { type: 'view' }>): void {
  if (request.revision !== resultRevision || request.filterRevision !== resultFilterRevision) return;
  const start = Math.max(0, Math.min(request.start, total));
  const end = Math.min(total, start + Math.min(request.count, 500));
  // Binary search finds the entry containing the first requested physical line.
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle]! <= start) low = middle + 1;
    else high = middle;
  }
  const rows: PreviewRow[] = [];
  for (let index = Math.max(0, low - 1); index < filteredEntries.length && offsets[index]! < end; index++) {
    const entry = filteredEntries[index]!;
    const first = Math.max(0, start - offsets[index]!);
    const last = Math.min(entry.lines.length, end - offsets[index]!);
    for (let line = first; line < last; line++) {
      const original = entry.lines[line]!;
      const text = formatLine(original, entry.source, { filename: request.filename, filenameWidth, color: false });
      const prefixLength = text.length - original.length;
      // Only visible original log text is searched; generated labels cannot become matches.
      const matches = matchRanges(original, highlightMatcher).map(([start, end]): [number, number] => [start + prefixLength, end + prefixLength]);
      rows.push({ text, order: entry.source.order, matches });
    }
  }
  reply({ type: 'view', revision: request.revision, filterRevision: request.filterRevision, request: request.request, start, rows });
}

async function handle(request: WorkerRequest): Promise<void> {
  if (request.revision !== latestRevision) return;
  try {
    if (request.type === 'merge') await merge(request);
    else if (request.type === 'filter') applyFilter(request);
    else if (request.type === 'view') view(request);
    else if (request.revision === resultRevision && request.filterRevision === resultFilterRevision && total) {
      const blob = new Blob([...outputChunks(filteredEntries, { filename: request.filename, filenameWidth, color: false })], { type: 'text/plain;charset=utf-8' });
      reply({ type: 'download', revision: request.revision, filterRevision: request.filterRevision, blob });
    }
  } catch (error) { reply({ type: 'error', revision: request.revision, message: errorText(error) }); }
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  if (event.data.type === 'merge') latestRevision = event.data.revision;
  if (event.data.type === 'filter') latestFilterRevision = event.data.filterRevision;
  queue = queue.then(() => handle(event.data));
};
