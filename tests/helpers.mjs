import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const cli = join(root, 'dist/loglinealign.js');

// Every assertion exercises the shipped bundle in a real process. Pin the host
// timezone and capture both streams; a hanging CLI fails instead of hanging CI.
export function run(args, { cwd = root, script = cli, env = {} } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, env: { ...process.env, TZ: 'UTC', ...env }, encoding: 'utf8',
    timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'CLI must exit without a signal');
  return result;
}

export function success(result, expected) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  if (expected !== undefined) assert.equal(result.stdout, expected);
  return result.stdout;
}

export function failure(result, message) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '', 'Failures must not emit a partial merge');
  assert.match(result.stderr, /^loglinealign: /);
  assert.match(result.stderr, message);
}

export function workspace(t, files = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'loglinealign-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(cwd, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return { cwd };
}

export const lines = (...values) => values.join('\n') + '\n';
