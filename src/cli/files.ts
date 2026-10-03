/** Read inputs with read-only handles and protect their identities during output. Successful output is renamed into place from an exclusively created temporary file. */
import { open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';

export interface InputIdentity {
  path: string;
  real: string;
  stats: BigIntStats;
}

export async function readInput(path: string): Promise<{ bytes: Uint8Array; identity: InputIdentity }> {
  // Nonblocking open allows fstat to reject a FIFO even when no writer has opened it.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) throw new Error(`${path}: Input must be a regular file.`);
    return { bytes: await handle.readFile(), identity: { path: resolve(path), real: await realpath(path), stats } };
  } finally { await handle.close(); }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function checkDestination(path: string, inputs: InputIdentity[]): Promise<void> {
  let destination: BigIntStats | undefined;
  let canonical: string;
  try {
    destination = await stat(path, { bigint: true });
    canonical = await realpath(path);
    if (!destination.isFile()) throw new Error(`${path}: Output must be a regular file.`);
  } catch (error) {
    if (!isMissing(error)) throw error;
    canonical = join(await realpath(dirname(path)), basename(path));
  }
  for (const input of inputs) {
    if (resolve(path) === input.path || canonical === input.real || (destination && destination.dev === input.stats.dev && destination.ino === input.stats.ino)) {
      throw new Error(`${path}: Output refers to input ${input.path}; choose a different destination.`);
    }
  }
}

export async function writeOutput(path: string, chunks: Iterable<string>, inputs: InputIdentity[]): Promise<void> {
  const destination = resolve(path);
  await checkDestination(destination, inputs);
  const temporary = join(dirname(destination), `.loglinealign-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  let replaced = false;
  try {
    for (const chunk of chunks) await handle.writeFile(chunk, 'utf8');
    await handle.sync();
    await handle.close();
    await checkDestination(destination, inputs);
    await rename(temporary, destination);
    replaced = true;
  } finally {
    await handle.close();
    if (!replaced) await unlink(temporary);
  }
}
