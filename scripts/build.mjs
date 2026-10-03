/** Bundle the Node CLI or embed all browser assets into one HTML document. Version and repository metadata come exclusively from package.json. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const define = { __VERSION__: JSON.stringify(metadata.version), __REPOSITORY__: JSON.stringify(metadata.repository) };
const target = process.argv[2] ?? 'all';
if (!['cli', 'web', 'all'].includes(target)) throw new Error('Build target must be cli, web, or all.');
await mkdir('dist', { recursive: true });
if (target === 'cli' || target === 'all') {
  // Dynamic import works in both module modes. Only Node built-ins remain external, so require needs no project package context.
  await build({ entryPoints: ['src/cli/main.ts'], bundle: true, platform: 'node', target: 'node24', format: 'cjs', outfile: 'dist/loglinealign.js', define,
    banner: { js: '(async () => {\n"use strict";\nconst require = (await import("node:module")).createRequire(process.execPath);' },
    footer: { js: '})();' },
  });
}
if (target === 'web' || target === 'all') {
  const worker = await build({ entryPoints: ['src/web/worker.ts'], bundle: true, platform: 'browser', target: 'es2022', format: 'iife', write: false });
  const browser = await build({ entryPoints: ['src/web/main.ts'], bundle: true, platform: 'browser', target: 'es2022', format: 'iife', write: false, define: { ...define, __WORKER_CODE__: JSON.stringify(worker.outputFiles[0].text) } });
  const template = await readFile('src/web/index.html', 'utf8');
  const css = await readFile('src/web/styles.css', 'utf8');
  const script = browser.outputFiles[0].text.replaceAll('</script', '<\\/script');
  await writeFile('dist/loglinealign.html', template.replace('/* INLINE_STYLES */', () => css).replace('/* INLINE_SCRIPT */', () => script));
}
