import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { root, run, success } from './helpers.mjs';

const cwd = join(root, 'demo/fc-timeout/sample-logs');
const scenario = JSON.parse(readFileSync(join(cwd, 'scenario.json'), 'utf8'));
const files = scenario.sources.map(source => source.file);
const timezones = scenario.sources.flatMap(source => ['--file-timezone', source.file, source.offset]);

// A deliberately narrow fixture reader, independent of src/core: these logs
// have year-first timestamps at column zero and at most microsecond precision.
// Date.parse handles whole seconds with the scenario's documented UTC offset;
// BigInt retains the fractional part. Do not regenerate expected output via CLI.
function fixtureBlocks(offsetFor) {
  return scenario.sources.flatMap(source => {
    const text = readFileSync(join(cwd, source.file), 'utf8');
    assert.ok(text.endsWith('\n'));
    const blocks = [];
    for (const textLine of text.slice(0, -1).split('\n')) {
      const stamp = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})\.(\d{2,6})(?=\s)/.exec(textLine);
      if (stamp) {
        const seconds = Date.parse(`${stamp[1]}T${stamp[2]}${offsetFor(source)}`);
        const key = BigInt(seconds) * 1_000_000n + BigInt(stamp[3].padEnd(9, '0'));
        blocks.push({ key, source: source.file, lines: [textLine] });
      } else {
        assert.ok(blocks.length, 'Fixture must start with a timestamp');
        blocks.at(-1).lines.push(textLine);
      }
    }
    return blocks;
  });
}

function expectedOutput(offsetFor, reverse = false) {
  const blocks = fixtureBlocks(offsetFor);
  // Stable Array.sort preserves fixture file/line order for ties.
  blocks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) * (reverse ? -1 : 1));
  const width = Math.max(...files.map(file => file.length));
  return blocks.flatMap(block => block.lines.map(line => `[${block.source.padStart(width)}] ${line}\n`)).join('');
}

for (const reverse of [false, true]) {
  test(`sample incident: complete ${reverse ? 'descending' : 'ascending'} timeline with source offsets`, () => {
    const expected = expectedOutput(source => source.offset, reverse);
    const output = success(run([...timezones, ...(reverse ? ['-r'] : []), ...files], { cwd }), expected);
    assert.equal(output.split('\n').length - 1, 5175, 'Every sample line must survive');
  });
}

test('sample incident: global fallback plus Mumbai override equals all per-file offsets', () => {
  success(run(['--timezone', '+02:00', '--file-timezone', 'app-mumbai.log', '+05:30', ...files], { cwd }),
    expectedOutput(source => source.offset));
});

test('sample incident: unassigned offsets warn once and produce the naive UTC timeline', () => {
  const result = run(files, { cwd });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expectedOutput(() => '+00:00'));
  assert.equal(result.stderr.split('\n').filter(Boolean).length, 1);
  assert.match(result.stderr, /Warning: .*assuming UTC/);
  assert.notEqual(result.stdout, expectedOutput(source => source.offset));
});
