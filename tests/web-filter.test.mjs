import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const bundle = async (path, format = 'esm') => (await build({ entryPoints: [path], bundle: true, platform: 'browser', format, write: false })).outputFiles[0].text;
const { compileFilters, filterEntries, highlightRanges, MAX_FILTERS, filterColor } = await import(`data:text/javascript;base64,${Buffer.from(await bundle('src/web/filter.ts')).toString('base64')}`);
const option = (text, extra = {}) => ({ text, matchCase: false, wholeWord: false, regex: false, invert: false, ...extra });
const entry = lines => ({ key: 0n, source: { id: 0, order: 0, name: 'test.log', label: 'test.log' }, line: 1, lines });
const apply = (entries, options) => filterEntries(entries, compileFilters(options));

test('filters cascade on the same physical line, preserving source and entry metadata', () => {
  const original = entry(['error api retry', 'error api done', 'error database retry', 'info api retry']);
  const split = entry(['error', 'api retry']);
  const options = [option('error'), option('api'), option('retry')];
  assert.deepEqual(apply([original, split], options), [{ ...original, lines: ['error api retry'] }]);
  assert.equal(original.lines.length, 4);
  assert.deepEqual(apply([original], options.slice(0, 2))[0].lines, ['error api retry', 'error api done']);
});

test('each filter independently applies case, word, regex, and inversion options', () => {
  const entries = [entry(['ERROR api code=500', 'error api code=500', 'ERROR apis code=500', 'ERROR api code=404', 'ERROR api code=503'])];
  assert.deepEqual(apply(entries, [option('ERROR', { matchCase: true }), option('api', { wholeWord: true }), option('code=50[03]', { regex: true, invert: true })])[0].lines, ['ERROR api code=404']);
  assert.equal(apply(entries, [option(''), option('', { invert: true })]), entries);
  assert.equal(apply(entries, []), entries);
  assert.equal(apply(entries, [option('[')]).length, 0);
});

test('invalid later regex is reported even when an earlier filter retains no lines', () => {
  assert.throws(() => apply([entry(['hello'])], [option('missing'), option('[', { regex: true })]), /Filter 2: Invalid regular expression/);
});

test('highlights split partially overlapping and identical matches without duplicating text', () => {
  const filters = compileFilters([option('abc'), option('bcd'), option('bc')]);
  assert.deepEqual(highlightRanges('abcde', filters), [
    { start: 0, end: 1, filters: [0] },
    { start: 1, end: 3, filters: [0, 1, 2] },
    { start: 3, end: 4, filters: [1] },
  ]);
  assert.deepEqual(highlightRanges('aa', compileFilters([option('a'), option('aa')])), [
    { start: 0, end: 1, filters: [0, 1] }, { start: 1, end: 2, filters: [0, 1] },
  ]);
});

test('highlights retain filter identity across blank, inverted, zero-width, and Unicode patterns', () => {
  assert.deepEqual(highlightRanges('😀é élan', compileFilters([option(''), option('missing', { invert: true }), option('é', { wholeWord: true })])), [{ start: 2, end: 3, filters: [2] }]);
  assert.deepEqual(highlightRanges('😀', compileFilters([option('(?=.)', { regex: true })])), []);
  assert.equal(new Set(Array.from({ length: MAX_FILTERS }, (_, index) => filterColor(index))).size, MAX_FILTERS);
  assert.ok(filterColor(MAX_FILTERS));
});

test('worker preview, copy, and download share cascaded results, including lines beyond the viewport', { timeout: 5000 }, async () => {
  const code = await bundle('src/web/worker.ts', 'iife');
  let receive;
  const self = { postMessage: message => receive(message) };
  runInNewContext(code, { self, Blob, TextDecoder, TextEncoder, performance });
  const send = request => new Promise(resolve => { receive = resolve; self.onmessage({ data: request }); });
  const lines = Array.from({ length: 80 }, (_, index) => `2026-01-01T00:00:00Z error api ${index % 2 ? 'retry' : 'done'} ${index}`);
  const file = new File([lines.join('\n')], 'error-api.log');
  const merged = await send({ type: 'merge', revision: 1, timezone: '', reverse: false, sources: [{ ...entry([]).source, label: file.name, file, included: true, format: '', timezone: '', timeShift: '+00:00' }] });
  assert.equal(merged.total, lines.length);
  assert.equal(merged.errors.length, 0);
  const base = { revision: 1, filterRevision: 1 };
  const filtered = await send({ type: 'filter', ...base, options: [option('error'), option('api'), option('done', { invert: true })] });
  assert.equal(filtered.total, 40);
  assert.equal(filtered.textBytes, Buffer.byteLength(lines.filter((_, index) => index % 2).join('\n') + '\n'));
  assert.equal(filtered.filenameBytes, Buffer.byteLength('[error-api.log] ') * 40);
  const view = await send({ type: 'view', ...base, request: 1, start: 0, count: 2, filename: true });
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].text, `[error-api.log] ${lines[1]}`);
  assert.equal(view.rows[0].matches.length, 2);
  assert.ok(view.rows[0].matches.every(match => match.start > '[error-api.log] '.length));
  const expected = lines.filter((_, index) => index % 2).join('\n') + '\n';
  for (const type of ['copy', 'download']) {
    const exported = await send({ type, ...base, request: 1, filename: false });
    assert.equal(await exported.blob.text(), expected);
  }
  const invalid = await send({ type: 'filter', revision: 1, filterRevision: 2, options: [option('error'), option('[', { regex: true })] });
  assert.match(invalid.error, /Filter 2/);
  const recovered = await send({ type: 'filter', revision: 1, filterRevision: 3, options: [option('')] });
  assert.equal(recovered.total, lines.length);
});

test('full-view batches cover retained Unicode output exactly, including the final partial batch', async () => {
  const code = await bundle('src/web/worker.ts', 'iife');
  let receive;
  const self = { postMessage: message => receive(message) };
  runInNewContext(code, { self, Blob, TextDecoder, TextEncoder, performance });
  const send = request => new Promise(resolve => { receive = resolve; self.onmessage({ data: request }); });
  const lines = Array.from({ length: 2406 }, (_, index) => `2026-01-01T00:00:00Z ${index % 2 ? 'keep é😀' : 'omit'} ${index}`);
  const file = new File([lines.join('\n')], '日志.log');
  await send({ type: 'merge', revision: 1, timezone: '', reverse: false, sources: [{ ...entry([]).source, label: file.name, file, included: true, format: '', timezone: '', timeShift: '+00:00' }] });
  const base = { revision: 1, filterRevision: 1 };
  const filtered = await send({ type: 'filter', ...base, options: [option('keep')] });
  assert.equal(filtered.total, 1203);
  const expected = lines.filter((_, index) => index % 2);
  assert.equal(filtered.textBytes, Buffer.byteLength(expected.join('\n') + '\n'));
  assert.equal(filtered.filenameBytes, Buffer.byteLength('[日志.log] ') * expected.length);
  for (const filename of [false, true]) {
    const actual = [];
    for (let start = 0; start < filtered.total; start += 500) {
      const view = await send({ type: 'view', ...base, request: start, start, count: 500, filename });
      assert.equal(view.start, start);
      assert.equal(view.rows.length, Math.min(500, expected.length - start));
      assert.ok(view.rows.every(row => row.matches.length === 1 && row.order === 0));
      actual.push(...view.rows.map(row => row.text));
    }
    assert.deepEqual(actual, expected.map(line => `${filename ? '[日志.log] ' : ''}${line}`));
  }
  const empty = await send({ type: 'filter', revision: 1, filterRevision: 2, options: [option('missing')] });
  assert.equal(empty.textBytes, 0);
  assert.equal(empty.filenameBytes, 0);
});
