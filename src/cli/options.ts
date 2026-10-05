/** Parse the CLI contract and keep argument validation separate from file processing. Option parsing stops at the first positional input. */
import { fallbackTimezone } from '../core/timezone';
import { createTimestampParser } from '../core/timestamp';
import { parseTimeShift } from '../core/time_adjustment';

export interface CliOptions {
  files: string[];
  formats: Map<string, string>;
  timezones: Map<string, string>;
  timeShifts: Map<string, bigint>;
  output?: string;
  timezone?: string;
  color?: boolean;
  filename: boolean;
  reverse: boolean;
  verbose: boolean;
  action?: 'help' | 'version';
}

export const help = `Usage: node dist/loglinealign.js [options] FILE...

Globally sort UTF-8 log entry blocks, preserving continuation lines.
Options must precede inputs. Use -- for filenames beginning with a hyphen.

  -o PATH                Atomically write output; never replace an input
  --timezone UTC|±HH:MM   Fallback for timestamps without an explicit offset
  --format FILE FORMAT   Per-file format override (repeatable; exact input path)
  --file-timezone FILE TZ Per-file fallback, UTC or ±HH:MM (repeatable)
  --time-shift FILE ±HH:MM Per-file adjustment; positive=later (repeatable)
  --color                Force 256-color ANSI, including output files
  -n, --no-color         Disable generated colors (mutually exclusive with --color)
  -N, --no-filename      Omit source prefixes
  -r, --reverse          Newest first; preserve ties and multiline blocks
  -v, --verbose          Processing diagnostics on STDERR
  --version              Version and repository URL
  --help                 This help

Auto: YYYY-MM-DD[T]HH:mm:ss or YYYY-MM-DD HH:mm:ss or YYYY/MM/DD HH:mm:ss.
Optional . or , fractions (1–9 digits), and attached Z, ±HH:MM, or ±HHMM.
One format per file; fractions may vary in precision or be absent.
Auto consumes full fractions/offsets and prefers a complete timestamp over
date-only message text (for example, a BIOS date or --since 2026-09-08).
Multiple date-and-time candidates still require a distinguishing override;
the error lists possible formats from valid supported timestamps on that line.
Suggestions may need distinguishing literals and must fit the entire file.
Invalid/incomplete timestamps remain errors. Date-only records are unsupported.
Override tokens: YYYY MM DD HH mm ss, 1–9 S characters, Z (Z or ±HH:MM),
ZZ (±HHMM). Punctuation is literal; enclose literal letters in brackets.
Override fraction fields are required and match the specified digit count.
Leading/trailing spaces are literal. Trailing literal separators may precede message text.
Examples: 'DD/MM/YYYY HH:mm:ss' or 'YYYY-MM-DD[T]HH:mm:ss.SSSZ'.
Explicit epochs: epoch-s (optional decimal seconds), epoch-ms, epoch-us, epoch-ns.
Numeric month/day record timestamps require an override. Dates must be complete.

If every nonempty input needs a fallback timezone and none is supplied,
warn on STDERR and assume UTC. Empty files are ignored. Mixed selections
with explicit-offset-only or epoch-only files require --timezone or a
--file-timezone for each unresolved file. Partial per-file assignments also
require a fallback for remaining unresolved files. Empty files do not count.
Explicit offsets/epochs take precedence, then per-file timezone, then global.
Time shifts apply afterward to all entries, including explicit offsets/epochs.
Shifts accept whole minutes and hours beyond 23; original log text is unchanged.
Per-file options require exact input paths. Named regions/DST are unsupported.

Inputs must be regular files and are read-only; named pipes are rejected.
Shell redirection can truncate files before this program
starts: never use FILE > FILE. Use -o for application-controlled protection.
`;

export function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = { files: [], formats: new Map(), timezones: new Map(), timeShifts: new Map(), filename: true, reverse: false, verbose: false };
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (positional) { options.files.push(arg); continue; }
    if (arg === '--') { positional = true; continue; }
    if (!arg.startsWith('-')) { positional = true; options.files.push(arg); continue; }
    switch (arg) {
      case '--help': options.action = 'help'; break;
      case '--version': options.action = 'version'; break;
      case '-N': case '--no-filename': options.filename = false; break;
      case '-r': case '--reverse': options.reverse = true; break;
      case '-v': case '--verbose': options.verbose = true; break;
      case '--color':
        if (options.color === false) throw new Error('--color and --no-color/-n are mutually exclusive.');
        options.color = true; break;
      case '-n': case '--no-color':
        if (options.color === true) throw new Error('--color and --no-color/-n are mutually exclusive.');
        options.color = false; break;
      case '-o': case '--timezone': {
        const value = args[++index];
        if (!value) throw new Error(`${arg} requires a value.`);
        if (arg === '-o') options.output = value;
        else { fallbackTimezone(value); options.timezone = value; }
        break;
      }
      case '--format': {
        const file = args[++index];
        const format = args[++index];
        if (!file || !format) throw new Error('--format requires FILE and FORMAT.');
        if (options.formats.has(file)) throw new Error(`Duplicate format override for ${file}.`);
        createTimestampParser(format, undefined);
        options.formats.set(file, format);
        break;
      }
      case '--file-timezone': case '--time-shift': {
        const file = args[++index];
        const value = args[++index];
        if (!file || !value) throw new Error(`${arg} requires FILE and VALUE.`);
        const assignments = arg === '--file-timezone' ? options.timezones : options.timeShifts;
        if (assignments.has(file)) throw new Error(`Duplicate ${arg} assignment for ${file}.`);
        if (arg === '--file-timezone') {
          fallbackTimezone(value);
          options.timezones.set(file, value);
        } else options.timeShifts.set(file, parseTimeShift(value));
        break;
      }
      default: throw new Error(`Unknown option ${arg}; see --help.`);
    }
  }
  if (options.action) return options;
  if (!options.files.length) throw new Error('At least one input file is required; see --help.');
  for (const [option, assignments] of [['--format', options.formats], ['--file-timezone', options.timezones], ['--time-shift', options.timeShifts]] as const) {
    for (const file of assignments.keys()) {
      if (options.files.filter(path => path === file).length !== 1) throw new Error(`${option} target ${file} must identify exactly one positional input, using the same path spelling.`);
    }
  }
  return options;
}
