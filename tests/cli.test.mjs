import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { failure, lines, root, run, success, workspace } from './helpers.mjs';

test('help and version succeed without inputs', () => {
  assert.match(success(run(['--help'])), /^Usage: .*\n/);
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  success(run(['--version']), `loglinealign v${metadata.version}\n${metadata.repository}\n`);
});

for (const [name, args, error] of [
  ['no inputs', [], /At least one input/],
  ['unknown option', ['--wat'], /Unknown option --wat/],
  ['missing output path', ['-o'], /requires a value/],
  ['missing timezone', ['--timezone'], /requires a value/],
  ['missing format', ['--format', 'a.log'], /requires FILE and FORMAT/],
  ['missing file timezone', ['--file-timezone', 'a.log'], /requires FILE and VALUE/],
  ['missing time shift', ['--time-shift', 'a.log'], /requires FILE and VALUE/],
  ['conflicting colors', ['--color', '-n', 'a.log'], /mutually exclusive/],
  ['conflicting colors reversed', ['--no-color', '--color', 'a.log'], /mutually exclusive/],
  ['named timezone', ['--timezone', 'Europe/Berlin', 'a.log'], /Timezone must be UTC/],
  ['out-of-range timezone', ['--timezone', '+24:00', 'a.log'], /within ±23:59/],
  ['unsigned adjustment', ['--time-shift', 'a.log', '01:00', 'a.log'], /must be signed/],
  ['invalid adjustment minutes', ['--time-shift', 'a.log', '+00:60', 'a.log'], /must be signed/],
  ['incomplete format', ['--format', 'a.log', '%Y', 'a.log'], /Incomplete format/],
  ['unsupported filename specifier', ['-o', '%T.log', 'a.log'], /[Uu]nsupported/],
]) {
  test(`arguments: ${name}`, () => failure(run(args), error));
}

for (const [option, value] of [['--format', '%F %T'], ['--file-timezone', 'UTC'], ['--time-shift', '+00:30']]) {
  test(`${option}: target must occur exactly once with identical path spelling`, () => {
    for (const inputs of [['b.log'], ['./a.log'], ['a.log', 'a.log']]) {
      failure(run([option, 'a.log', value, ...inputs]), /must identify exactly one positional input/);
    }
    failure(run([option, 'a.log', value, option, 'a.log', value, 'a.log']), /Duplicate/);
  });
}

test('unsorted entries retain duplicate ties, leading text, blank lines, and multiline blocks in either direction', t => {
  const late = lines('banner', '2026-01-01T00:00:02Z late', '  trace', '');
  const first = lines('2026-01-01T00:00:00Z duplicate', '  first trace');
  const duplicate = lines('2026-01-01T00:00:00Z duplicate');
  const other = lines('2026-01-01T00:00:00Z second file', '  other trace');
  const middle = lines('2026-01-01T00:00:01Z middle');
  const ctx = workspace(t, { 'a.log': late + first + duplicate, 'b.log': other + middle });
  success(run(['-N', 'a.log', 'b.log'], ctx), first + duplicate + other + middle + late);
  success(run(['--no-filename', '--reverse', 'a.log', 'b.log'], ctx), late + middle + first + duplicate + other);
});

test('nanosecond differences determine order across variable fractional precision and offsets', t => {
  const early = '2026-01-01T00:00:00.000000001Z early';
  const late = '2026-01-01T00:00:00.000000002Z late';
  const exact = '2026-01-01T00:00:00Z exact';
  const tenth = '2026-01-01T01:00:00.1+01:00 tenth';
  const ctx = workspace(t, { 'a.log': lines(late, tenth, exact), 'b.log': lines(early) });
  success(run(['-N', 'a.log', 'b.log'], ctx), lines(exact, early, late, tenth));
});

test('explicit offsets override per-file timezone, which overrides the global fallback', t => {
  const explicit = '2026-01-01T10:00:00+03:00 explicit';
  const perFile = '2026-01-01T09:30:00 per-file';
  const global = '2026-01-01T08:00:00 global';
  const ctx = workspace(t, { 'a.log': lines(perFile, explicit), 'b.log': lines(global) });
  success(run(['-N', '--timezone', '-01:00', '--file-timezone', 'a.log', '+02:00', 'a.log', 'b.log'], ctx),
    lines(explicit, perFile, global));
});

test('missing timezone in mixed or partially assigned selections fails until a fallback is supplied', t => {
  const bare = '2026-01-01T01:00:00 bare';
  const zoned = '2026-01-01T00:00:00Z zoned';
  const ctx = workspace(t, { 'a.log': lines(bare), 'b.log': lines(zoned), 'c.log': lines(bare) });
  failure(run(['a.log', 'b.log'], ctx), /a\.log:1: Timestamp has no timezone/);
  failure(run(['--file-timezone', 'a.log', 'UTC', 'a.log', 'c.log'], ctx), /c\.log:1: Timestamp has no timezone/);
  success(run(['-N', '--timezone', 'UTC', 'a.log', 'b.log'], ctx), lines(zoned, bare));
  success(run(['-N', '--file-timezone', 'a.log', 'UTC', 'a.log', 'b.log'], ctx), lines(zoned, bare));
});

test('empty and BOM-only inputs do not affect fallback policy; line endings normalize to LF', t => {
  const ctx = workspace(t, {
    'empty.log': '', 'bom.log': '\uFEFF',
    'a.log': '\uFEFF2026-01-01T00:00:00 hello\r\n  trace\r\r\nlast',
  });
  success(run(['empty.log', 'bom.log'], ctx), '');
  const result = run(['-N', 'empty.log', 'a.log', 'bom.log'], ctx);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /assuming UTC/);
  assert.equal(result.stdout, lines('2026-01-01T00:00:00 hello', '  trace', '', 'last'));
});

test('time shifts apply after offsets and epochs, cross dates, and preserve original text', t => {
  const a = '2026-01-01T23:45:00.000000001Z shifted';
  const b = '2026-01-02T00:00:00Z reference';
  const ctx = workspace(t, { 'a.log': lines(a), 'b.log': lines(b), 'epoch.log': '0 epoch\n' });
  success(run(['-N', 'a.log', 'b.log'], ctx), lines(a, b));
  success(run(['-N', '--time-shift', 'a.log', '+00:30', 'a.log', 'b.log'], ctx), lines(b, a));
  success(run(['-N', '--time-shift', 'b.log', '-25:00', 'a.log', 'b.log'], ctx), lines(b, a));
  success(run(['-N', '--format', 'epoch.log', 'epoch-s', '--time-shift', 'epoch.log', '+999999:00', 'epoch.log', 'a.log'], ctx), lines(a, '0 epoch'));
});

test('calendar overrides accept day-first dates and distinguish timestamps in message text', t => {
  const legacy = '31/12/2025 23:00:00 legacy';
  const dual = 'record=[2026-01-01T00:00:00Z] copied=2025-01-01T00:00:00Z';
  const ctx = workspace(t, { 'legacy.log': lines(legacy), 'dual.log': lines(dual) });
  failure(run(['legacy.log'], ctx), /requires a format override/);
  failure(run(['dual.log'], ctx), /Multiple timestamp candidates.*Possible candidates/);
  success(run(['-N', '--timezone', 'UTC', '--format', 'legacy.log', '%d/%m/%Y %H:%M:%S',
    '--format', 'dual.log', 'record=[%FT%T%:z]', 'dual.log', 'legacy.log'], ctx), lines(legacy, dual));
});

for (const [format, before, after] of [
  ['epoch-s', '-1.000000001', '1.000000001'],
  ['epoch-ms', '-1001', '1001'], ['epoch-us', '-1000001', '1000001'], ['epoch-ns', '-1000000001', '1000000001'],
]) {
  test(`${format}: signed epochs use the correct scale and preserve subsecond precision`, t => {
    const lower = '1969-12-31T23:59:58Z lower-bound';
    const negative = '1969-12-31T23:59:59Z negative-second';
    const positive = '1970-01-01T00:00:01Z positive-second';
    const upper = '1970-01-01T00:00:02Z upper-bound';
    const ctx = workspace(t, { 'epoch.log': lines(`${after} after`, `${before} before`), 'calendar.log': lines(upper, positive, negative, lower) });
    success(run(['-N', '--format', 'epoch.log', format, 'calendar.log', 'epoch.log'], ctx),
      lines(lower, `${before} before`, negative, positive, `${after} after`, upper));
  });
}

test('auto detection accepts slash dates, comma fractions, prefixes, and compact offsets alongside date-only mentions', t => {
  const a = '[service] 2026/01/01 02:00:00,000002+0200 BIOS 05/22/2023';
  const b = '2026-01-01T00:00:00.000001Z --since 2025-12-31';
  const ctx = workspace(t, { 'a.log': lines(a), 'b.log': lines(b) });
  success(run(['-N', 'a.log', 'b.log'], ctx), lines(b, a));
});

for (const [name, contents, message] of [
  ['invalid UTF-8', Buffer.from([0xc3, 0x28]), /Invalid UTF-8/],
  ['no timestamps', 'plain text\n', /No valid timestamps/],
  ['whitespace only', ' \n', /No valid timestamps/],
  ['invalid date', '2026-02-29T00:00:00Z bad\n', /bad\.log:1: Invalid calendar date/],
  ['invalid time', '2026-01-01T24:00:00Z bad\n', /bad\.log:1: Invalid clock time/],
  ['leap second', '2026-01-01T00:00:60Z bad\n', /Invalid clock time/],
  ['incomplete timestamp', '2026-01-01T00:00 bad\n', /[Ii]ncomplete timestamp/],
  ['too many fractional digits', '2026-01-01T00:00:00.1234567890Z bad\n', /at most nine digits/],
  ['invalid offset', '2026-01-01T00:00:00+24:00 bad\n', /within ±23:59/],
  ['named zone', '2026-01-01T00:00:00 EST bad\n', /timezones are unsupported/],
  ['detached offset', '2026-01-01T00:00:00 +02:00 bad\n', /Offset must be attached/],
  ['mixed formats', '2026-01-01T00:00:00Z first\n2026/01/01 00:00:01Z bad\n', /bad\.log:2: Conflicting timestamp formats/],
  ['mixed fraction separators', '2026-01-01T00:00:00.1Z first\n2026-01-01T00:00:01,1Z bad\n', /Conflicting fractional separators/],
]) {
  test(`invalid input: ${name} produces no partial output`, t => {
    const ctx = workspace(t, { 'good.log': '2026-01-01T00:00:00Z valid\n', 'bad.log': contents });
    failure(run(['good.log', 'bad.log'], ctx), message);
  });
}

test('duplicate basenames are labeled distinctly and every physical line is prefixed', t => {
  const ctx = workspace(t, {
    'one/app.log': '2026-01-01T00:00:00Z first\n  trace\n\n',
    'two/app.log': '2026-01-01T00:00:00Z second\n',
    'long-empty-file.log': '',
  });
  const prefix = label => `[${label.padStart('long-empty-file.log'.length)}] `;
  success(run(['one/app.log', 'two/app.log', 'long-empty-file.log'], ctx),
    lines(...['2026-01-01T00:00:00Z first', '  trace', ''].map(line => prefix('app.log [1]') + line),
      prefix('app.log [2]') + '2026-01-01T00:00:00Z second'));
});

test('colors can be forced or suppressed without removing ANSI already in input', t => {
  const text = '2026-01-01T00:00:00Z \x1b[1moriginal\x1b[0m\n';
  const ctx = workspace(t, { 'a.log': text });
  for (const flags of [[], ['-n'], ['--no-color']]) success(run(['-N', ...flags, 'a.log'], ctx), text);
  const colored = success(run(['-N', '--color', 'a.log'], ctx));
  assert.match(colored, /^\x1b\[38;5;\d+m/);
  assert.ok(colored.endsWith('\x1b[0m\n'));
  assert.equal(colored.replace(/^\x1b\[38;5;\d+m/, '').replace(/\x1b\[0m\n$/, '\n'), text);
});

test('verbose diagnostics stay on stderr and do not expose log message contents', t => {
  const text = '2026-01-01T00:00:00Z private-message\n  private-trace\n';
  const ctx = workspace(t, { 'a.log': text });
  const result = run(['-N', '-v', 'a.log'], ctx);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, text);
  assert.match(result.stderr, /1 entries, 1 continuation lines/);
  assert.match(result.stderr, /Merged 1 files, 1 entries; ascending; plain/);
  assert.doesNotMatch(result.stderr, /private-message|private-trace/);
});

test('-- handles leading-hyphen paths and option parsing stops at the first input', t => {
  const text = '2026-01-01T00:00:00Z hyphen\n';
  const ctx = workspace(t, { '-input.log': text, '--reverse': text, 'a.log': text });
  success(run(['-N', '--', '-input.log'], ctx), text);
  success(run(['-N', 'a.log', '--reverse'], ctx), text + text);
});
