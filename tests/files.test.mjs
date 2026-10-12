import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { cli, failure, lines, run, success, workspace } from './helpers.mjs';

const text = '2026-01-01T00:00:00Z original\n';

test('output creation and replacement preserve input bytes and leave no temporary files', t => {
  // Exceed the formatter chunk size to exercise multiple writes.
  const large = lines(...Array.from({ length: 1500 }, (_, i) => `2026-01-01T00:00:00Z record-${i} ${'x'.repeat(60)}`));
  const ctx = workspace(t, { 'input.log': large, 'old.log': 'previous output' });
  for (const output of ['new.log', 'old.log']) {
    success(run(['-N', '-o', output, 'input.log'], ctx), '');
    assert.equal(readFileSync(join(ctx.cwd, output), 'utf8'), large);
    if (process.platform !== 'win32') assert.equal(statSync(join(ctx.cwd, output)).mode & 0o777, 0o600);
  }
  assert.equal(readFileSync(join(ctx.cwd, 'input.log'), 'utf8'), large);
  assert.deepEqual(readdirSync(ctx.cwd).sort(), ['input.log', 'new.log', 'old.log']);
});

test('parse failures preserve an existing output and do not create a new one', t => {
  const ctx = workspace(t, { 'input.log': text, 'bad.log': 'no timestamps', 'old.log': 'keep me' });
  for (const output of ['new.log', 'old.log']) {
    failure(run(['-o', output, 'input.log', 'bad.log'], ctx), /No valid timestamps/);
    assert.equal(readFileSync(join(ctx.cwd, 'old.log'), 'utf8'), 'keep me');
    assert.deepEqual(readdirSync(ctx.cwd).sort(), ['bad.log', 'input.log', 'old.log']);
  }
});

for (const alias of ['same path', 'relative alias', 'absolute alias', 'hard link', 'symlink']) {
  test(`output protection: ${alias} cannot replace an input`, t => {
    const ctx = workspace(t, { 'input.log': text });
    let output = 'input.log';
    if (alias === 'relative alias') {
      mkdirSync(join(ctx.cwd, 'sub'));
      output = 'sub/../input.log';
    }
    if (alias === 'absolute alias') output = join(ctx.cwd, 'input.log');
    if (alias === 'hard link' || alias === 'symlink') {
      output = 'alias.log';
      try {
        (alias === 'hard link' ? linkSync : symlinkSync)(join(ctx.cwd, 'input.log'), join(ctx.cwd, output));
      } catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Creating file links requires Windows privileges');
        throw error;
      }
    }
    const before = readdirSync(ctx.cwd).sort();
    failure(run(['-o', output, 'input.log'], ctx), /Output refers to input/);
    assert.equal(readFileSync(join(ctx.cwd, 'input.log'), 'utf8'), text);
    assert.equal(readFileSync(resolve(ctx.cwd, output), 'utf8'), text);
    assert.deepEqual(readdirSync(ctx.cwd).sort(), before);
  });
}

test('a non-input output symlink is replaced without changing its target', t => {
  const ctx = workspace(t, { 'input.log': text, 'target.log': 'leave target alone' });
  try {
    symlinkSync(join(ctx.cwd, 'target.log'), join(ctx.cwd, 'output.log'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Creating symlinks requires Windows privileges');
    throw error;
  }
  success(run(['-N', '-o', 'output.log', 'input.log'], ctx), '');
  assert.equal(readFileSync(join(ctx.cwd, 'output.log'), 'utf8'), text);
  assert.equal(readFileSync(join(ctx.cwd, 'target.log'), 'utf8'), 'leave target alone');
  assert.equal(lstatSync(join(ctx.cwd, 'output.log')).isSymbolicLink(), false);
});

test('missing files, directory inputs, and invalid output destinations fail cleanly', t => {
  const ctx = workspace(t, { 'input.log': text });
  mkdirSync(join(ctx.cwd, 'directory'));
  failure(run(['missing.log'], ctx), /ENOENT/);
  failure(run(['directory'], ctx), /regular file|EISDIR/);
  failure(run(['-o', 'directory', 'input.log'], ctx), /Output must be a regular file/);
  failure(run(['-o', 'missing/output.log', 'input.log'], ctx), /ENOENT/);
  assert.equal(readFileSync(join(ctx.cwd, 'input.log'), 'utf8'), text);
  assert.deepEqual(readdirSync(ctx.cwd).sort(), ['directory', 'input.log']);
});

test('named pipes are rejected without waiting for a writer', { skip: process.platform === 'win32' }, t => {
  const ctx = workspace(t);
  const fifo = join(ctx.cwd, 'input.pipe');
  const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(created.error);
  assert.equal(created.status, 0, created.stderr);
  failure(run([fifo], ctx), /Input must be a regular file/);
});

test('filename templates expand UTC date fields and literal percent independently of parsing timezone', t => {
  const ctx = workspace(t, { 'input.log': text });
  const before = new Date();
  success(run(['-N', '--timezone', '+05:30', '-o', 'merged-%F-%z-100%%.log', 'input.log'], ctx), '');
  const after = new Date();
  const outputs = readdirSync(ctx.cwd).filter(name => name !== 'input.log');
  assert.equal(outputs.length, 1);
  // Accept either date if the subprocess straddles UTC midnight.
  assert.ok([before, after].some(date => outputs[0] === `merged-${date.toISOString().slice(0, 10)}-+0000-100%.log`));
  assert.equal(readFileSync(join(ctx.cwd, outputs[0]), 'utf8'), text);
});

test('input protection also applies after filename-template expansion', t => {
  const ctx = workspace(t, { '100%.log': text });
  failure(run(['-o', '100%%.log', '100%.log'], ctx), /Output refers to input/);
  assert.equal(readFileSync(join(ctx.cwd, '100%.log'), 'utf8'), text);
});

test('forced colors reach output files; default output files are plain', t => {
  const ctx = workspace(t, { 'input.log': text });
  success(run(['-N', '--color', '-o', 'color.log', 'input.log'], ctx), '');
  assert.match(readFileSync(join(ctx.cwd, 'color.log'), 'utf8'), /^\x1b\[38;5;\d+m/);
  success(run(['-N', '-o', 'plain.log', 'input.log'], ctx), '');
  assert.equal(readFileSync(join(ctx.cwd, 'plain.log'), 'utf8'), text);
});

for (const type of ['commonjs', 'module']) {
  test(`standalone bundle works when copied into a ${type} project`, t => {
    const ctx = workspace(t, { 'package.json': JSON.stringify({ type }), 'input.log': text });
    const script = join(ctx.cwd, 'loglinealign.js');
    copyFileSync(cli, script);
    success(run(['-N', 'input.log'], { ...ctx, script }), text);
  });
}
