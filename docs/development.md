# Development and verification

[README](../README.md) · [CLI](cli.md) · [Browser](browser.md) · [Formats](formats.md) · [Development](development.md)

## Build

Install Node.js 24+, Make, and the [pnpm](https://pnpm.io/installation) version pinned in [package.json](../package.json). From the repository root:

```sh
make setup
make check
make test
make
```

| Target | Result |
| --- | --- |
| `make setup` | Install dependencies with `pnpm install --frozen-lockfile` |
| `make` / `make all` | Both distributable artifacts |
| `make cli` | `dist/loglinealign.js` |
| `make web` | Minified `dist/loglinealign.html`, with all assets embedded |
| `make check` | Strict TypeScript checking, without emitted files |
| `make test` | Rebuild the CLI and run automated regression tests with Node's built-in test runner |
| `make clean` | Delete build output, installed dependencies, local pnpm store, TypeScript build caches, and pnpm debug logs with `rm -rf` |

`pnpm check`, `pnpm test`, and `pnpm build` are alternatives. `make NODE=/path/to/node` selects a Node executable. After `make clean`, run `make setup` again. Cleanup follows `.gitignore`'s generated-project rules, preserving source, lockfiles, input/output logs, `.env` files, and external pnpm stores.

### Build details

[package.json](../package.json) defines version/repository metadata and development dependencies; `pnpm-lock.yaml` pins resolved versions. Use pnpm for dependency changes and retain it as the only dependency lockfile. `pnpm-workspace.yaml` allows esbuild's installation script.

[scripts/build.mjs](../scripts/build.mjs) bundles both artifacts without runtime dependencies. The CLI runs with Node 24+ in CommonJS or ES module projects without sibling files. The HTML embeds its application, worker, and styles; esbuild minifies the assets and html-minifier-terser minimizes HTML. The CLI remains unminified. Bundling does not type-check, so run `make check` separately.

### Releases

Pushing a `v*` tag runs [.github/workflows/release.yml](../.github/workflows/release.yml), which runs `make setup`, `make check`, `make test`, and `make`, then creates a GitHub release with generated notes. The tag must equal `v` plus the `package.json` version, and no release may already exist for it. Bump the version, merge, then tag `main`:

```sh
git tag v0.6.2
git push origin v0.6.2
```

The release contains both distributables, `loglinealign-VERSION.tar.xz` and `loglinealign-VERSION.zip` (each with a top-level `loglinealign-VERSION/` folder holding `README.md`, `LICENSE`, `docs/`, and both distributables, compressed at maximum level), and a `SHA256SUMS` file covering the other four assets.

## Scope

Designed for a handful of roughly 10 MB text files, with all decoded text and entries held in memory. There is no external sorting, live tailing, directory traversal, compressed-input support, server component, or sorted-input mode. Extremely long lines can slow browser rendering. Source colors repeat after eight files.

## Verification

Run `make test` or `pnpm test` after installing dependencies. Both rebuild the CLI before running `tests/*.test.mjs` with Node's built-in test runner; no additional test dependencies are required. Each test invokes the distributable in a separate process and checks output, diagnostics, exit status, or filesystem effects. Temporary fixtures are removed after each test, subprocesses have timeouts, and the subprocess timezone is pinned to UTC.

The suite covers:

- All 5,175 lines in the [demo sample logs](../demo/fc-timeout/sample-logs), with timezone-aligned ascending/reverse output and the naive UTC warning. Expected timelines come from a narrow, independent fixture reader using `scenario.json` offsets, not from the production parser or recorded CLI output.
- Unsorted and duplicate entries, stable ties, multiline blocks, nanosecond precision, timezone precedence, clock adjustments, calendar and epoch overrides, encoding, and malformed timestamps.
- CLI argument validation, help/version, labels, colors, diagnostics, and standalone use in CommonJS and ES module projects.
- Output creation/replacement, input protection through equivalent paths and links, parse-failure preservation, filename templates, and nonregular-file rejection. Named-pipe checks are skipped on Windows; link checks skip there only when Windows denies link creation.

[Linux CI](../.github/workflows/test.yml) runs on branch pushes and pull requests with Node 24, checking types, running tests, and building the browser artifact. Release builds also require the CLI suite to pass. `make check` and builds alone do not verify runtime behavior.

The CLI exercises the engine shared with the browser, but does not test browser interaction or worker integration. Automated browser tests are deferred. For browser changes, manually open the built HTML, load the sample logs, assign offsets, and check remerge, pending-settings export blocking, reverse order, filtering, copy/download contents, drag-and-drop, and responsive layouts. In particular, confirm exports include matching lines beyond the visible preview. A future browser smoke suite would automate these steps against the built standalone HTML using a browser automation runner and an installed browser.

The [demo pipeline](../demo/fc-timeout/README.md) checks aligned CLI chronology, browser source colors, reverse order, and downloaded filtered text while generating the demo. It is not a general regression suite.

## Foundation-first source study order

1. [src/core/types.ts](../src/core/types.ts) — shared source, timestamp, entry, and diagnostic shapes.
2. [src/core/timezone.ts](../src/core/timezone.ts) and [src/core/time_adjustment.ts](../src/core/time_adjustment.ts) — fixed timezone validation, descriptions, and nonmutating time adjustments.
3. [src/core/date_format.ts](../src/core/date_format.ts) — shared specifier tokenizer, feature subsets, and shorthand expansion.
4. [src/core/timestamp.ts](../src/core/timestamp.ts) — automatic detection, explicit formats, epochs, and validation.
5. [src/core/filename_template.ts](../src/core/filename_template.ts) — local-time filename expansion and validation.
6. [src/core/entries.ts](../src/core/entries.ts) and [src/core/fallback.ts](../src/core/fallback.ts) — UTF-8 decoding, physical lines, block construction, and selection-wide fallback policy.
7. [src/core/merge.ts](../src/core/merge.ts) — deterministic ordering and reverse tie behavior.
8. [src/core/format.ts](../src/core/format.ts) and [src/core/colors.ts](../src/core/colors.ts) — labels, physical-line formatting, and stable colors.
9. [src/cli/options.ts](../src/cli/options.ts), [src/cli/files.ts](../src/cli/files.ts), and [src/cli/main.ts](../src/cli/main.ts) — arguments, filesystem protection, and orchestration.
10. [src/web/filter.ts](../src/web/filter.ts), [src/web/protocol.ts](../src/web/protocol.ts), and [src/web/worker.ts](../src/web/worker.ts) — line matching, worker messages, cache management, viewport lookup, and downloads.
11. [src/web/time_controls.ts](../src/web/time_controls.ts), [src/web/file_drop.ts](../src/web/file_drop.ts), [src/web/main.ts](../src/web/main.ts), [src/web/index.html](../src/web/index.html), and [src/web/styles.css](../src/web/styles.css) — per-file time controls, application-wide file drops, browser state, and presentation.
12. [package.json](../package.json), [tsconfig.json](../tsconfig.json), [scripts/build.mjs](../scripts/build.mjs), and [Makefile](../Makefile) — version metadata, strict checking, bundling, and artifact assembly.
