# loglinealign

Merge multiple UTF-8 log files into one chronological timeline. A shared TypeScript engine powers a Node.js CLI and a standalone, completely offline browser page. Inputs may be unsorted; multiline entries, duplicates, and nanosecond precision are preserved.

## Build

Install Node.js 24 or newer, [pnpm](https://pnpm.io/installation) 12.8.1 (pinned in `package.json`), and Make, then run:

```sh
make install
make check
make
```

Dependencies are development-only and pinned in `pnpm-lock.yaml`: TypeScript 5.9.3, esbuild 0.25.10, and Node type definitions 24.7.0. `pnpm-workspace.yaml` permits esbuild's installation script to prepare its platform executable. No runtime dependency installation is needed to use the generated artifacts. The build follows the [esbuild local installation and bundling workflow](https://esbuild.github.io/getting-started/); `make check` separately checks types because bundling does not do type checking.

You can also run `pnpm check` for type checking and `pnpm build` to build both artifacts. Use pnpm for dependency changes and retain `pnpm-lock.yaml` as the project's only dependency lockfile.

| Target | Result |
| --- | --- |
| `make install` | Install dependencies with `pnpm install --frozen-lockfile` |
| `make` / `make all` | Both distributable artifacts |
| `make cli` | `dist/loglinealign.js` |
| `make web` | `dist/loglinealign.html`, with all assets embedded |
| `make check` | Strict TypeScript checking, without emitted files |
| `make clean` | Delete build output, installed dependencies, local pnpm store, TypeScript build caches, and pnpm debug logs with `rm -rf` |

`make clean` uses `rm -rf` and matches the generated-project rules at the top of `.gitignore`. It preserves source files, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, input/output logs, `.env` files, and pnpm stores outside this repository. After cleaning, run `make install` before building again. Running `make clean` again when these generated files are absent is harmless.

`make NODE=/path/to/node` selects a specific Node executable. `package.json` is the single source of version and repository metadata. Generated artifacts and `node_modules` are ignored by Git. The HTML can be copied anywhere without sibling files. The CLI `.js` artifact runs with Node 24+ without sibling files or a package.json, including inside projects configured for CommonJS or ES modules.

## CLI

```sh
node dist/loglinealign.js app.log database.log
node dist/loglinealign.js --timezone UTC -o merged.log app.log database.log
node dist/loglinealign.js -n -N app.log database.log
node dist/loglinealign.js -r -v app.log database.log
node dist/loglinealign.js --format legacy.log 'DD/MM/YYYY HH:mm:ss' --timezone +02:00 legacy.log service.log
node dist/loglinealign.js --format epoch.log epoch-ns epoch.log
node dist/loglinealign.js -- -filename-starting-with-a-hyphen.log
```

Options precede the final positional inputs. `--` ends option parsing; shell wildcard expansion happens before launch. At least one input is required, except with `--help` or `--version`. Short flags are separate arguments, not combined clusters.

| Option | Behavior |
| --- | --- |
| `-o PATH` | Write output atomically to PATH; default is STDOUT |
| `--timezone UTC\|±HH:MM` | Fallback timezone for timestamps without an offset |
| `--format FILE FORMAT` | Override one input's format; repeat for different inputs |
| `--color` | Force 256-color ANSI output, including pipes and `-o` |
| `-n`, `--no-color` | Disable generated ANSI colors |
| `-N`, `--no-filename` | Omit generated source labels |
| `-r`, `--reverse` | Newest first, retaining equal-time tie order and block line order |
| `-v`, `--verbose` | Processing diagnostics to STDERR |
| `--version` | Exact version output below |
| `--help` | Usage and supported format notation |

`--color` and `--no-color`/`-n` are mutually exclusive. Without either, color is enabled only when STDOUT is a terminal and `-o` is absent. Turning color off suppresses generated escape sequences; escape sequences already present in input text are preserved.

A format's FILE must exactly match the spelling of one positional input. Unknown targets, ambiguous repeated positional targets, and duplicate overrides are errors. Identical basenames receive labels such as `app.log [1]` and `app.log [2]`. Labels and color assignments follow original input order.

Errors and verbose diagnostics go to STDERR. Verbose output includes source names, byte sizes, detected/overridden formats, fallback timezone usage, entry and continuation counts, leading lines, ordering, and durations; it does not print log contents. Invalid arguments, parsing errors, and failed file operations exit nonzero. The complete merge is validated before any result is emitted.

`--version` prints exactly these two uncolored lines and a final newline:

```text
loglinealign v0.1.0
https://github.com/jftuga/loglinealign
```

### Input protection

Inputs are opened read-only. `-o` rejects an input's own path, equivalent paths, symlink aliases, and hard-link aliases by checking canonical paths and filesystem identities. Output is written to an exclusively created temporary file in the destination directory, synced, and renamed into place only after success. An existing non-input destination can be replaced; parse failures leave it intact. Replacement creates a new file with owner-only permissions, rather than preserving the previous destination's permissions. An existing non-input symlink is replaced itself, rather than writing through to its target.

Inputs must be regular files. Named pipes are rejected without waiting for a writer; directories and devices are also rejected.

Shell redirection runs before the application and can truncate inputs before protection is possible. **Never run `node dist/loglinealign.js app.log > app.log`.** Use `-o` for application-controlled output protection. Ordinary filesystem races and external processes changing inputs during a run are outside the guarantee.

## Timestamp rules

Automatic detection recognizes these full calendar families inside log lines, including bracketed or prefixed timestamps:

```text
2026-10-02T14:35:07Z
2026-10-02 14:35:07.123456789+02:00
2026/10/02 14:35:07,123-0400
[service] [2026-10-02T14:35:07Z] message
```

Dates and clocks have fixed widths: four-digit year, two-digit month/day/hour/minute/second. Hyphenated dates accept `T` or one space; slash-separated dates accept one space. Fractions use a dot or comma, with one to nine digits. Offsets are attached `Z`, `±HH:MM`, or `±HHMM`; offsets range through ±23:59. Timestamps without an offset use the fallback timezone. Explicit offsets always win over the fallback. Only UTC and numeric fixed offsets are supported; local machine timezone and daylight-saving rules are never inferred.

When no fallback is supplied and **every nonempty selected file contains at least one timestamp without a timezone**, the CLI warns once on STDERR and assumes UTC for those timestamps. The browser displays the same warning above the preview, without requiring verbose mode, and allows preview and download. Empty and BOM-only files do not affect this decision; an all-empty selection produces no warning. Each file is fully validated before this assumption is accepted, and explicit offsets within these files remain authoritative. Warnings never enter the merged output.

If some files need a fallback but others contain only explicit offsets or epochs, supply `--timezone UTC` (or `±HH:MM`) in the CLI, or set **Fallback timezone** in the browser. Those mixed selections still report missing-timezone errors. An explicitly supplied fallback suppresses the automatic-UTC warning. The browser leaves the timezone field blank when assuming UTC and reevaluates eligibility whenever the selected files change, including when it reuses cached parsing results.

Automatic detection prefers a complete date and time over date-only mentions elsewhere on the same line. Within each supported family, it consumes the full fractional field and offset when present before considering a shorter form. For example, `2026-09-10T11:55:07.155861+0300 ... --since 2026-09-08` has one timestamp; the date in the logged command is message text. A BIOS date such as `05/22/2023` alongside a complete timestamp is also message text. These lines need no format override in either interface: leave the browser format field blank or omit CLI `--format`.

Each file has one calendar family, date/time separator, and fractional separator. Fraction presence and precision may vary; explicit offsets may vary or be absent within the family. The selected timestamp is fully validated; invalid or incomplete date-and-time candidates are never ignored in favor of another timestamp. Two timestamps with clock fields remain ambiguous, even if one has more fractional digits or an offset. Calendar dates use the proleptic Gregorian calendar, years 0001–9999. Invalid days, clock fields, offsets, leap seconds, and fractions beyond nanosecond precision are rejected. Conversion is used only for sorting; original timestamp text is retained.

Kernel messages that include a full `setting system clock to ...` timestamp in addition to the record timestamp still require an override. For a record timestamp such as `2026-07-20T12:33:25.583969+0300`, use `YYYY-MM-DD[T]HH:mm:ss.SSSSSSZZ` to distinguish it from an embedded timestamp without that fractional field and compact offset. If two timestamps match the same override, add distinguishing literals.

In both the CLI and browser, automatic-detection ambiguity errors include **Possible candidates**: distinct format overrides inferred from valid supported timestamps on the failing line, in their order of appearance. Suggestions preserve separators, exact fractional precision, and offset style (`Z` for `Z`/colon offsets; `ZZ` for compact offsets). For example:

```text
Multiple timestamp candidates with clock fields on one line; use a format override with distinguishing literals. Possible candidates: "YYYY-MM-DD[T]HH:mm:ss.SSSSSSZZ", "YYYY-MM-DD HH:mm:ssZ".
```

Copy a candidate into **Format override (optional)** without the surrounding quotation marks, or pass it as the quoted FORMAT argument to CLI `--format`. Suggestions describe that line, not a guaranteed format for the entire file, and are never applied automatically. Identical formats appear once; add distinguishing literal text if a suggested format still matches multiple timestamps. Malformed, invalid, or unsupported candidates remain errors and are omitted from the suggestions. If none can be validated, the error says `Possible candidates: none (no valid supported timestamp candidates)`. This does not expand the supported automatic timestamp families or infer numeric day/month order.

Numeric record timestamps such as `02/10/2026 14:35:07` always need an override, even if sample values suggest a particular date order. This restriction does not apply to date-only mentions alongside a complete supported timestamp. Overrides contain these tokens:

| Token | Meaning |
| --- | --- |
| `YYYY`, `MM`, `DD` | Complete calendar date |
| `HH`, `mm`, `ss` | Complete 24-hour clock |
| `S` through `SSSSSSSSS` | Required fractional digits, exactly the specified width |
| `Z` | `Z` or an offset with a colon |
| `ZZ` | Signed offset without a colon |
| `[literal]` | Literal text, such as `[T]` |

Punctuation is literal. Include the decimal separator before an `S` field. Every date and time field is required once; arbitrary literal letters must be bracketed. Overrides match a substring, so text outside the timestamp is retained. A distinguishing literal can select a single timestamp when a line contains more than one. A calendar-looking line that fails its override is an error.

Leading and trailing spaces in a nonblank override are literal in both interfaces and can distinguish timestamps. The browser treats an entirely blank or whitespace-only override as automatic detection; it preserves spaces in an otherwise nonblank override.

An override may include a trailing literal separator before the message, such as `YYYY-MM-DD[T]HH:mm:ssZ[ | ]`. Text after that separator is message content. Overrides ending in a timestamp field still reject attached malformed fractions, offsets, and suffixes.

Explicit `epoch-s`, `epoch-ms`, `epoch-us`, and `epoch-ns` overrides parse standalone signed numeric tokens using integer arithmetic. `epoch-s` also permits a decimal-point fraction through nine digits; the other units require integers. Negative fractional seconds are supported. Epochs are absolute instants, require no timezone, and are never auto-detected. With an epoch override, a line containing multiple standalone numbers is ambiguous and fails; digits inside identifiers are ignored.

Attached signs are part of the numeric-token boundary: `123-456`, `123+456`, and calendar dates must not be interpreted as an epoch prefix. Recognizable calendar dates and leading clock-only records under an epoch override are errors, checked before their numeric fields can be mistaken for epoch values.

### Recognition limits

The parser recognizes year-first date starts (`YYYY-M` or `YYYY-M-D`, with hyphens or slashes) and day/month/year numeric dates anywhere outside an alphanumeric token. A following `T`, or spaces/tabs followed by digits and a colon, marks a date-and-time candidate, including malformed or incomplete clock fields. One such candidate takes precedence over date-only mentions before or after it; multiple such candidates require an override with distinguishing literals. A malformed second date-and-time candidate still causes an error. Different automatic families in one file are errors.

If a line contains recognizable dates but no complete timestamp, it still fails instead of treating those dates as continuation text. At the start of a line, optionally after whitespace and `[`, recognizable clock-only and month/day-plus-clock records are also rejected as incomplete. Automatic detection never falls back to date-only, time-only, or epoch parsing.

Attached malformed timestamp suffixes, common timezone abbreviations, and whitespace-separated numeric offsets are rejected. Detection cannot recognize every unsupported timestamp or distinguish a full timestamp quoted in prose from a record timestamp. For example, named-month dates can appear to be continuation text, while a calendar date on an otherwise untimestamped continuation line can cause a parsing error. Inspect detected formats and counts; use format overrides with distinguishing literals where appropriate. Incomplete dates, named timezones, compressed logs, and arbitrary date grammars are outside this release.

## Entry ordering and output

Every timestamp begins an entry block. Following untimestamped lines attach to the most recently encountered timestamp in that file, even when timestamps are out of order. Leading untimestamped lines attach before the first timestamped entry, inheriting that entry's key internally. Nonempty timestamp-free files fail; empty files and BOM-only files contribute no entries. Whitespace-only files are nonempty and fail without a timestamp.

Blocks sort globally by absolute timestamp, then original input-file order, then original timestamp line position. Reverse mode changes only the timestamp comparison; ties and all lines within a block retain their order. Duplicates are retained. Source clocks are assumed accurate; no clock-skew correction is applied.

Every physical line, including blank and continuation lines, gets `[filename] ` unless filename display is disabled. CRLF and CR normalize to LF, and nonempty output ends with a newline. A final input newline does not introduce an extra blank record. A leading UTF-8 BOM is accepted; malformed UTF-8 fails instead of inserting replacement characters. No headings or unplaced-lines section are added.

In both CLI and browser output, filenames are right-justified with spaces inside the brackets so closing brackets align. Width follows the longest selected source label, including duplicate-name suffixes and selected empty files. Browser filtering keeps that width; excluding or removing sources recalculates it. Preview and downloaded text use identical padding:

```text
[  vmstat.log] procs -
[vmstat_1.log] procs -
```

Use `-N` / `--no-filename`, or the browser's **No filename (--no-filename)** checkbox, to omit the entire prefix and its padding.

For example, a banner before a file's first `10:00:02` entry remains with that entry when a later `10:00:00` entry sorts ahead of it. Reversing chronology does not reverse a stack trace.

## Offline browser

Open `dist/loglinealign.html` directly from disk in a modern browser supporting BigInt, Blob workers, and local downloads. No server, CDN, network access, or sibling assets are required. The page embeds its usage help. A content security policy prohibits network connections; the GitHub link navigates only when explicitly clicked.

1. Drop files on the drop zone or use **Choose files**. Newly added files are selected and automatically merged.
2. Inspect each source's label, color, **Detected format**, counts, or error. Detected format is a separate read-only result of successful automatic parsing; it never fills the editable field. A dash appears for excluded files, empty files, parsing errors, pending settings, merges in progress, and files using an explicit override. Uncheck a file to exclude it while retaining its cache; use its remove button to remove it from the session. Disk files are never changed. Surviving labels and colors do not change on removal. Duplicate names remain distinct; adding a duplicate may first add numeric suffixes to existing labels.
3. Leave **Format override (optional)** blank for automatic detection. Enter a format there only when an override is needed; successful overrides are identified in the file's status text. If every nonempty selected file needs a timezone, a warning explains that UTC is assumed. Enter a fallback timezone to override this assumption or resolve mixed-selection timezone errors, then select **Remerge**. Changes are marked pending; an automatic merge from adding, including, excluding, or removing files also applies current settings. Your typed override is preserved after errors, so you can correct it.
4. Toggle reverse order to reorder cached entries immediately. Check **No filename (--no-filename)** to hide source prefixes in both preview and download; uncheck it to restore them. It is unchecked by default. Filename and color changes apply without reparsing. Processing details appear separately from the merged result and download. If parsing edits are pending, reversing continues to use the last applied parsing settings and downloading remains disabled.
5. Use the horizontal-arrow button to expand the result to the available page width, then use it again to restore sources and settings.
6. Use **Filter logs** above the preview to keep matching physical lines, or select **Invert match** to keep nonmatching lines (`grep -v`). The filter applies to both preview and download. Matching text is highlighted in the preview. Matching options have descriptions on hover or keyboard focus and remain available in expanded mode.
7. Download the complete current result as plain text, including all retained lines when a filter is active. The download honors filenames and ordering, and never inserts highlights or ANSI colors. Leave the filename field blank for `merge--YYYYmmdd.HHMMSS.log`, generated from the browser's local clock at download time. Enter a custom name to retain it across downloads.

No selection, all-empty selected files, selected-file errors, pending settings, an in-progress merge/filter, no matching lines, and an invalid or timed-out filter disable downloading. Excluded errors do not block valid selected sources. Superseded worker responses cannot replace the newest result or produce a download from an older filter.

Decoding, parsing, sorting, filtering, and download construction happen in an embedded worker. Each file caches decoded content and parsed entries for its format/timezone settings; selection changes reuse the cache. Filter edits reuse the merged entries without reparsing timestamps. Explicit-offset and epoch files avoid reparsing when only the fallback changes. Removing a source releases worker caches. The page renders a small window of output rows; downloads contain the entire current filtered result regardless of scroll position. For very large results, scrollbar height is bounded and maps proportionally to the full row range.

### Browser text filter

The filter searches original log text, including timestamps, but excludes generated filename prefixes. By default, it matches literal text without case sensitivity. Spaces in the query are significant. An empty query shows all lines, even with inversion enabled; **Clear** empties the query and retains the matching options, including inversion.

| Toggle | Behavior |
| --- | --- |
| `Aa` — Match case | Distinguish uppercase and lowercase letters |
| Underlined `ab` — Match whole word | Require boundaries around each match; Unicode letters, combining marks, numbers, and underscores are word characters |
| `.*` — Regular expression | Interpret the query as a JavaScript Unicode regex, such as `error\|warning` or `status=[45][0-9]{2}`, without surrounding `/` delimiters |
| Invert match | Keep only lines that do not match the query, like `grep -v`; combines with case, whole-word, and regex settings |

The options can be combined. Regex matching runs separately on each physical line, so `^` and `$` anchor that line; patterns do not span lines. Whole-word matching applies around the complete regex match. For example, a whole-word search for `error` includes `error-handler` but excludes `errors` and `_error`.

Only matching lines are retained by default; inversion retains only nonmatching lines. Each physical line is evaluated independently, so a timestamp line or stack-trace line can be omitted even when another line in the same entry is retained. Retained lines keep their original entry's chronological position, tie order, source label, and color. Filtered output can therefore contain continuation lines without their parent timestamp. Per-file parsing diagnostics continue to describe the original inputs; the result status reports filtered line/entry counts against the complete merge and identifies active inversion. Clear the filter to restore the complete result.

The preview highlights every nonoverlapping match using the same case, whole-word, and regex rules as filtering. Generated source labels are never highlighted. Highlighting preserves the original text and works with source colors enabled or disabled; downloads remain plain text. Empty filters and inverted results have no highlights. Zero-width regex matches can select lines but have no visible text to highlight. Match ranges are computed in the worker only for visible rows, keeping the preview virtualized.

Invalid regex syntax displays an inline error and clears the preview until corrected, including in inverted mode. Filtering or highlight matching that runs for about five seconds is stopped; simplify or clear the query to recover without reselecting files. After a timeout, the worker cache is rebuilt from the loaded files. Filtering is a browser feature; CLI options are unchanged.

## Scope and verification

The intended workload is a handful of roughly 10 MB text files. All entries and decoded text remain in memory; available browser/Node memory limits total size. There is no external sorting, live tailing, directory traversal, compressed-input support, server component, or sorted-input mode. Terminal colors repeat after eight sources; filenames remain available to distinguish them. Extremely long individual lines can still make browser rendering expensive.

No automated test framework is included. Use `make check`, `make`, and the acceptance checklist in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) when changing behavior. Verification performed for this implementation is recorded in [VERIFICATION.md](VERIFICATION.md).

## Foundation-first source study order

1. `src/core/types.ts` — shared source, timestamp, entry, and diagnostic shapes.
2. `src/core/timezone.ts` — fixed timezone validation and offsets.
3. `src/core/timestamp.ts` — automatic detection, explicit formats, epochs, and validation.
4. `src/core/entries.ts` and `src/core/fallback.ts` — UTF-8 decoding, physical lines, block construction, and selection-wide fallback policy.
5. `src/core/merge.ts` — deterministic ordering and reverse tie behavior.
6. `src/core/format.ts` and `src/core/colors.ts` — labels, physical-line formatting, and stable colors.
7. `src/cli/options.ts`, `src/cli/files.ts`, and `src/cli/main.ts` — arguments, filesystem protection, and orchestration.
8. `src/web/filter.ts`, `src/web/protocol.ts`, and `src/web/worker.ts` — line matching, worker messages, cache management, viewport lookup, and downloads.
9. `src/web/main.ts`, `src/web/index.html`, and `src/web/styles.css` — browser state, controls, and presentation.
10. `package.json`, `tsconfig.json`, `scripts/build.mjs`, and `Makefile` — version metadata, strict checking, bundling, and artifact assembly.

## License

[MIT](LICENSE).
