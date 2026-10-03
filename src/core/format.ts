/** Assign unambiguous display labels and format every physical output line. Formatting never alters stored log text. */
import { sourceColor } from './colors';
import type { DisplayOptions, Entry, Source } from './types';

export function sourceLabels(names: readonly string[]): string[] {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1);
  const used = new Set<string>();
  return names.map(name => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    let label = totals.get(name)! > 1 ? `${name} [${count}]` : name;
    while (used.has(label) || (label !== name && totals.has(label))) label += ' [source]';
    used.add(label);
    return label;
  });
}

export function sourceLabelWidth(labels: readonly string[]): number {
  return labels.reduce((width, label) => Math.max(width, label.length), 0);
}

export function formatLine(text: string, source: Source, options: DisplayOptions): string {
  const line = `${options.filename ? `[${source.label.padStart(options.filenameWidth)}] ` : ''}${text}`;
  return options.color ? `\x1b[38;5;${sourceColor(source.order).ansi}m${line}\x1b[0m` : line;
}

export function* outputChunks(entries: readonly Entry[], options: DisplayOptions): Generator<string> {
  let chunk = '';
  for (const entry of entries) {
    for (const line of entry.lines) {
      chunk += formatLine(line, entry.source, options) + '\n';
      if (chunk.length >= 65536) { yield chunk; chunk = ''; }
    }
  }
  if (chunk) yield chunk;
}
