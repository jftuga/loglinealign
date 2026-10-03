/** Launch the Node CLI and report operational failures without partial parse output. Shared engine modules contain all log interpretation and ordering. */
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseOptions, help } from './options';
import { readInput, writeOutput } from './files';
import type { InputIdentity } from './files';
import { decodeInput, parseEntries } from '../core/entries';
import { resolveFallback } from '../core/fallback';
import { mergeEntries } from '../core/merge';
import { outputChunks, sourceLabels, sourceLabelWidth } from '../core/format';
import type { ParsedSource, Source } from '../core/types';

declare const __VERSION__: string;
declare const __REPOSITORY__: string;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === 'version') { process.stdout.write(`loglinealign v${__VERSION__}\n${__REPOSITORY__}\n`); return; }
  if (options.action === 'help') { process.stdout.write(help); return; }
  const start = performance.now();
  const labels = sourceLabels(options.files.map(path => basename(path)));
  const inputs: { source: Source; parsed: ParsedSource; size: number }[] = [];
  const identities: InputIdentity[] = [];
  for (const [order, path] of options.files.entries()) {
    const { bytes, identity } = await readInput(path);
    identities.push(identity);
    const source = { id: order, order, name: path, label: labels[order]! };
    const parsed = parseEntries(decodeInput(bytes, path), source, { format: options.formats.get(path), timezone: options.timezone ?? 'UTC' });
    inputs.push({ source, parsed, size: bytes.byteLength });
  }
  const resolution = resolveFallback(inputs, options.timezone);
  if (resolution.errors.size) throw new Error([...resolution.errors.values()].join('\n'));
  if (resolution.warning) process.stderr.write(`loglinealign: Warning: ${resolution.warning}\n`);
  for (const { source, parsed, size } of inputs) {
    if (options.verbose) {
      const d = parsed.diagnostics;
      process.stderr.write(`${source.name}: ${size} bytes; ${d.format}; ${d.entries} entries, ${d.continuations} continuation lines (${d.leading} leading); timezone ${d.usedFallback ? `fallback ${options.timezone ?? 'UTC (assumed)'}` : 'explicit/epoch or empty'}; parsed in ${d.durationMs.toFixed(1)} ms\n`);
    }
  }
  const merged = mergeEntries(inputs.map(input => input.parsed.entries), options.reverse);
  const color = options.color ?? (!options.output && Boolean(process.stdout.isTTY));
  const chunks = outputChunks(merged, { filename: options.filename, filenameWidth: sourceLabelWidth(labels), color });
  if (options.output) await writeOutput(options.output, chunks, identities);
  else await pipeline(Readable.from(chunks), process.stdout);
  if (options.verbose) process.stderr.write(`Merged ${options.files.length} files, ${merged.length} entries; ${options.reverse ? 'descending' : 'ascending'}; ${color ? 'color' : 'plain'}; total ${(performance.now() - start).toFixed(1)} ms\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`loglinealign: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
