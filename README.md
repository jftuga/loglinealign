# loglinealign

Merge multiple UTF-8 log files into one chronological timeline. A shared TypeScript engine powers a Node.js CLI and a standalone, completely offline browser page. Inputs may be unsorted; multiline entries, duplicates, and nanosecond precision are preserved.

## Build

Install Node.js 24 or newer, [pnpm](https://pnpm.io/installation) 12.8.1 (pinned in `package.json`), and Make, then run:

```sh
make install
make check
make
```

Dependencies are development-only and pinned in `pnpm-lock.yaml`: TypeScript 5.9.3, esbuild 0.25.10, html-minifier-terser 7.2.0, and Node type definitions 24.7.0. `pnpm-workspace.yaml` permits esbuild's installation script to prepare its platform executable. No runtime dependency installation is needed to use the generated artifacts. The build follows the [esbuild local installation and bundling workflow](https://esbuild.github.io/getting-started/); `make check` separately checks types because bundling does not do type checking.

You can also run `pnpm check` for type checking and `pnpm build` to build both artifacts. Use pnpm for dependency changes and retain `pnpm-lock.yaml` as the project's only dependency lockfile.

| Target | Result |
| --- | --- |
| `make install` | Install dependencies with `pnpm install --frozen-lockfile` |
| `make` / `make all` | Both distributable artifacts |
| `make cli` | `dist/loglinealign.js` |
| `make web` | Minified `dist/loglinealign.html`, with all assets embedded |
| `make check` | Strict TypeScript checking, without emitted files |
| `make clean` | Delete build output, installed dependencies, local pnpm store, TypeScript build caches, and pnpm debug logs with `rm -rf` |

`make clean` uses `rm -rf` and matches the generated-project rules at the top of `.gitignore`. It preserves source files, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, input/output logs, `.env` files, and pnpm stores outside this repository. After cleaning, run `make install` before building again. Running `make clean` again when these generated files are absent is harmless.

`make NODE=/path/to/node` selects a specific Node executable. `package.json` is the single source of version and repository metadata. Generated artifacts and `node_modules` are ignored by Git. The HTML can be copied anywhere without sibling files. The CLI `.js` artifact runs with Node 24+ without sibling files or a package.json, including inside projects configured for CommonJS or ES modules.

The web build minifies its embedded application, worker, and CSS with esbuild, then collapses HTML whitespace and removes HTML comments with [html-minifier-terser](https://github.com/terser/html-minifier-terser). Minification applies only to `dist/loglinealign.html`; the CLI build (`dist/loglinealign.js`) remains unminified.

## CLI

```sh
node dist/loglinealign.js app.log database.log
node dist/loglinealign.js --timezone UTC -o merged.log app.log database.log
node dist/loglinealign.js -n -N app.log database.log
node dist/loglinealign.js -r -v app.log database.log
node dist/loglinealign.js --format legacy.log '%d/%m/%Y %H:%M:%S' --timezone +02:00 legacy.log service.log
node dist/loglinealign.js -o 'merge--%Y%m%d.%H%M%S.log' app.log database.log
node dist/loglinealign.js --format epoch.log epoch-ns epoch.log
node dist/loglinealign.js --file-timezone east.log +02:00 --file-timezone west.log -05:00 east.log west.log
node dist/loglinealign.js --time-shift slow.log +00:30 slow.log reference.log
node dist/loglinealign.js -- -filename-starting-with-a-hyphen.log
```

Options precede the final positional inputs. `--` ends option parsing; shell wildcard expansion happens before launch. At least one input is required, except with `--help` or `--version`. Short flags are separate arguments, not combined clusters.

| Option | Behavior |
| --- | --- |
| `-o PATH` | Write output atomically to PATH, expanding date specifiers throughout the path; default is STDOUT |
| `--timezone UTC\|±HH:MM` | Fallback timezone for timestamps without an offset |
| `--format FILE FORMAT` | Override one input's format; repeat for different inputs |
| `--file-timezone FILE TZ` | Per-file fallback timezone (`UTC` or `±HH:MM`); overrides the global fallback |
| `--time-shift FILE ±HH:MM` | Adjust one file's merge times; positive means later, negative means earlier |
| `--color` | Force 256-color ANSI output, including pipes and `-o` |
| `-n`, `--no-color` | Disable generated ANSI colors |
| `-N`, `--no-filename` | Omit generated source labels |
| `-r`, `--reverse` | Newest first, retaining equal-time tie order and block line order |
| `-v`, `--verbose` | Processing diagnostics to STDERR |
| `--version` | Exact version output below |
| `--help` | Usage and supported format notation |

`--color` and `--no-color`/`-n` are mutually exclusive. Without either, color is enabled only when STDOUT is a terminal and `-o` is absent. Turning color off suppresses generated escape sequences; escape sequences already present in input text are preserved.

Each per-file option's FILE must exactly match the spelling of one positional input. Unknown targets, ambiguous repeated positional targets, and duplicate assignments for the same option are errors. Different per-file options may target the same input. Identical basenames receive labels such as `app.log [1]` and `app.log [2]`. Labels and color assignments follow original input order.

Errors and verbose diagnostics go to STDERR. Verbose output includes source names, byte sizes, detected/overridden formats, effective timezone usage, per-file adjustments, entry and continuation counts, leading lines, ordering, and durations; it does not print log contents. Invalid arguments, parsing errors, and failed file operations exit nonzero. The complete merge is validated before any result is emitted.

`--version` prints exactly these two uncolored lines and a final newline:

```text
loglinealign v0.5.0
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

When no global fallback or per-file timezone for a nonempty selected file is supplied and **every nonempty selected file contains at least one timestamp without a timezone**, the CLI warns once on STDERR and assumes UTC for those timestamps. The browser displays the same warning above the preview, without requiring verbose mode, and allows preview and download. Empty and BOM-only files do not affect this decision; an all-empty selection produces no warning. Each file is fully validated before this assumption is accepted, and explicit offsets within these files remain authoritative. Warnings never enter the merged output.

If some files need a fallback but others contain only explicit offsets or epochs, supply a global fallback or assign a timezone to each unresolved file. Partial per-file assignments also require a fallback for remaining unresolved files; they do not silently receive UTC. The browser leaves timezone fields blank when assuming UTC and reevaluates eligibility whenever the selected files change, including when it reuses cached parsing results. Excluded and empty files do not create missing-timezone errors; malformed settings are still rejected for included files.

**Per-file timezone and time adjustment**

Timezone precedence is explicit timestamp offset or epoch, then **File timezone** / `--file-timezone`, then the global fallback, then the conditional UTC assumption described above. A file timezone only interprets timestamps without an offset. For example, assigning `+02:00` to `12:00` means `10:00 UTC`; explicit `12:00+02:00` needs no assignment. Timezones accept fixed offsets through ±23:59 with minute precision, including `+05:30` and `+05:45`. Named regions and daylight-saving rules are unsupported.

**Time adjustment** / `--time-shift` adds a constant duration after timezone interpretation, including for explicit-offset and epoch timestamps. `+00:30` moves entries 30 minutes later; `-01:00` moves them one hour earlier. Use a required sign, at least two hour digits, and exactly two minute digits from 00 through 59. Hours may exceed 23 (`+24:00` is one day); decimal hours and seconds are unsupported. Calculations preserve nanosecond precision and cross date boundaries without wrapping. Repeated merges never accumulate adjustments. Continuation blocks and stable tie ordering are preserved.

Original timestamp text remains unchanged in preview and download; adjustments affect ordering only. Displayed timestamps can therefore look out of order. Reprocessing a downloaded log will not reproduce manual adjustments unless equivalent settings are applied again to the corresponding source entries; a flattened download does not retain per-file adjustment metadata. Neither a fixed timezone nor a constant adjustment handles a timezone-less file spanning a daylight-saving transition or a clock whose error changes over time.

Each web source has independent timezone and adjustment fields, even with duplicate filenames. Blank File timezone inherits the global fallback; Time adjustment defaults to `+00:00` and must remain a valid signed duration. Choose a 30-minute or 1-hour step, use Earlier/Later, or type whole-minute adjustments; Reset sets `+00:00`. These edits stay pending until either **Remerge** button or the next automatic merge. Downloads remain disabled while settings are pending or invalid, and reversing uses the last applied settings. File reports and verbose processing details identify the effective timezone, unused fallbacks, and applied nonzero adjustments. CLI verbose output also shows zero adjustments.

Automatic detection prefers a complete date and time over date-only mentions elsewhere on the same line. Within each supported family, it consumes the full fractional field and offset when present before considering a shorter form. For example, `2026-09-10T11:55:07.155861+0300 ... --since 2026-09-08` has one timestamp; the date in the logged command is message text. A BIOS date such as `05/22/2023` alongside a complete timestamp is also message text. These lines need no format override in either interface: leave the browser format field blank or omit CLI `--format`.

Each file has one calendar family, date/time separator, and fractional separator. Fraction presence and precision may vary; explicit offsets may vary or be absent within the family. The selected timestamp is fully validated; invalid or incomplete date-and-time candidates are never ignored in favor of another timestamp. Two timestamps with clock fields remain ambiguous, even if one has more fractional digits or an offset. Calendar dates use the proleptic Gregorian calendar, years 0001–9999. Invalid days, clock fields, offsets, leap seconds, and fractions beyond nanosecond precision are rejected. Conversion is used only for sorting; original timestamp text is retained.

Kernel messages that include a full `setting system clock to ...` timestamp in addition to the record timestamp still require an override. For a record timestamp such as `2026-07-20T12:33:25.583969+0300`, use `%Y-%m-%dT%H:%M:%S.%6N%z` to distinguish it from an embedded timestamp without that fractional field and compact offset. If two timestamps match the same override, add distinguishing literals.

In both the CLI and browser, automatic-detection ambiguity errors include **Possible candidates**: distinct format overrides inferred from valid supported timestamps on the failing line, in their order of appearance. Suggestions preserve separators, exact fractional precision, and offset style (`%:z` for `Z`/colon offsets; `%z` for compact offsets). For example:

```text
Multiple timestamp candidates with clock fields on one line; use a format override with distinguishing literals. Possible candidates: "%Y-%m-%dT%H:%M:%S.%6N%z", "%Y-%m-%d %H:%M:%S%:z".
```

Copy a candidate into **Format override (optional)** without the surrounding quotation marks, or pass it as the quoted FORMAT argument to CLI `--format`. Suggestions describe that line, not a guaranteed format for the entire file, and are never applied automatically. Identical formats appear once; add distinguishing literal text if a suggested format still matches multiple timestamps. Malformed, invalid, or unsupported candidates remain errors and are omitted from the suggestions. If none can be validated, the error says `Possible candidates: none (no valid supported timestamp candidates)`. This does not expand the supported automatic timestamp families or infer numeric day/month order.

Numeric record timestamps such as `02/10/2026 14:35:07` always need an override, even if sample values suggest a particular date order. This restriction does not apply to date-only mentions alongside a complete supported timestamp. Overrides and filename templates share these case-sensitive `date`-style specifiers, with different supported subsets:

| Specifier | Meaning | Override | Filename | Source |
| --- | --- | --- | --- | --- |
| `%Y` | Four-digit year | Required, exactly four digits | Zero-padded to four digits | POSIX |
| `%m` | Month, 01–12 | Required, exactly two digits | Yes | POSIX |
| `%d` | Day, 01–31 | Required, exactly two digits | Yes | POSIX |
| `%H` | Hour, 00–23 | Required, exactly two digits | Yes | POSIX |
| `%M` | Minute, 00–59 | Required, exactly two digits | Yes | POSIX |
| `%S` | Second, 00–59 | Required, exactly two digits | Yes | POSIX |
| `%1N`–`%9N` | Exactly that many fractional digits | Yes | `%1N`–`%3N` only | GNU extension |
| `%N` | Same as `%9N` | Yes | No | GNU extension |
| `%z` | Offset `±HHMM` | Yes | Yes | POSIX |
| `%:z` | Offset `±HH:MM` | Also accepts `Z` (a deviation from `date`) | No | GNU extension |
| `%s` | Unix epoch seconds | No; use `epoch-s` | Yes | GNU/BSD |
| `%%` | Literal `%` | Yes | Yes | POSIX |
| `%F` | `%Y-%m-%d` | Yes | Yes | POSIX |
| `%T` | `%H:%M:%S` | Yes | No | POSIX |

Letters, digits, brackets, spaces, and punctuation are literal. Include a literal decimal separator before a fractional field, such as `.%3N` or `,%6N`. Every date and time field is required exactly once; fraction and zone fields may each appear at most once. Shorthands expand before repeated-field checks, so `%F %Y` repeats the year. `[%F %T]` matches a bracketed timestamp. Unsupported specifiers, including `%0N`, `%10N`, a trailing `%`, and those outside the selected feature's subset, are errors listing the valid specifiers. Old-style overrides are no longer accepted.

Overrides match a substring, so text outside the timestamp is retained. A distinguishing literal can select a single timestamp when a line contains more than one. A calendar-looking line that fails its override is an error.

Leading and trailing spaces in a nonblank override are literal in both interfaces and can distinguish timestamps. The browser treats an entirely blank or whitespace-only override as automatic detection; it preserves spaces in an otherwise nonblank override.

An override may include a trailing literal separator before the message, such as `%Y-%m-%dT%H:%M:%S%:z | `. Text after that separator is message content. Overrides ending in a timestamp field still reject attached malformed fractions, offsets, and suffixes.

Explicit `epoch-s`, `epoch-ms`, `epoch-us`, and `epoch-ns` overrides parse standalone signed numeric tokens using integer arithmetic. `epoch-s` also permits a decimal-point fraction through nine digits; the other units require integers. Negative fractional seconds are supported. Epochs are absolute instants, require no timezone, and are never auto-detected. With an epoch override, a line containing multiple standalone numbers is ambiguous and fails; digits inside identifiers are ignored.

Attached signs are part of the numeric-token boundary: `123-456`, `123+456`, and calendar dates must not be interpreted as an epoch prefix. Recognizable calendar dates and leading clock-only records under an epoch override are errors, checked before their numeric fields can be mistaken for epoch values.

### Recognition limits

The parser recognizes year-first date starts (a four-digit year followed by a one- or two-digit month and optional day, with hyphens or slashes) and day/month/year numeric dates anywhere outside an alphanumeric token. A following `T`, or spaces/tabs followed by digits and a colon, marks a date-and-time candidate, including malformed or incomplete clock fields. One such candidate takes precedence over date-only mentions before or after it; multiple such candidates require an override with distinguishing literals. A malformed second date-and-time candidate still causes an error. Different automatic families in one file are errors.

If a line contains recognizable dates but no complete timestamp, it still fails instead of treating those dates as continuation text. At the start of a line, optionally after whitespace and `[`, recognizable clock-only and month/day-plus-clock records are also rejected as incomplete. Automatic detection never falls back to date-only, time-only, or epoch parsing.

Attached malformed timestamp suffixes, common timezone abbreviations, and whitespace-separated numeric offsets are rejected. Detection cannot recognize every unsupported timestamp or distinguish a full timestamp quoted in prose from a record timestamp. For example, named-month dates can appear to be continuation text, while a calendar date on an otherwise untimestamped continuation line can cause a parsing error. Inspect detected formats and counts; use format overrides with distinguishing literals where appropriate. Incomplete dates, named timezones, compressed logs, and arbitrary date grammars are outside this release.

## Entry ordering and output

Every timestamp begins an entry block. Following untimestamped lines attach to the most recently encountered timestamp in that file, even when timestamps are out of order. Leading untimestamped lines attach before the first timestamped entry, inheriting that entry's key internally. Nonempty timestamp-free files fail; empty files and BOM-only files contribute no entries. Whitespace-only files are nonempty and fail without a timestamp.

Blocks sort globally by absolute timestamp plus any per-file time adjustment, then original input-file order, then original timestamp line position. Reverse mode changes only the timestamp comparison; ties and all lines within a block retain their order. Duplicates are retained. Clock errors are not detected automatically; use a per-file time adjustment to correct a known constant error without rewriting the log text.

Every physical line, including blank and continuation lines, gets `[filename] ` unless filename display is disabled. CRLF and CR normalize to LF, and nonempty output ends with a newline. A final input newline does not introduce an extra blank record. A leading UTF-8 BOM is accepted; malformed UTF-8 fails instead of inserting replacement characters. No headings or unplaced-lines section are added.

In both CLI and browser output, filenames are right-justified with spaces inside the brackets so closing brackets align. Width follows the longest selected source label, including duplicate-name suffixes and selected empty files. Browser filtering keeps that width; excluding or removing sources recalculates it. Preview and downloaded text use identical padding:

```text
[  vmstat.log] procs -
[vmstat_1.log] procs -
```

Use `-N` / `--no-filename`, or the browser's **No filename** checkbox, to omit the entire prefix and its padding.

For example, a banner before a file's first `10:00:02` entry remains with that entry when a later `10:00:00` entry sorts ahead of it. Reversing chronology does not reverse a stack trace.

## Offline browser

Open `dist/loglinealign.html` directly from disk in a modern browser supporting BigInt, Blob workers, and local downloads. No server, CDN, network access, or sibling assets are required. The page embeds its usage help. A content security policy prohibits network connections; the GitHub link navigates only when explicitly clicked.

The full-width interface has five tabs: **Sources** (selected initially), **Search / Filter**, **Merge Settings**, **Download**, and **Formats & usage**. Sources stays selected after the first files are added and shows the loaded-file count in its tab. Switching tabs preserves edits, filters, and the current result without triggering a merge. Use Left/Right arrows to cycle through focused tabs, or Home/End for the first/last tab. The tab strip scrolls horizontally on narrow screens. Per-file format, timezone, and adjustment controls appear side by side on wide screens and stack on small screens. Formats & usage contains the embedded help without an additional disclosure toggle. There is no sidebar or horizontal expansion button.

1. Drop files anywhere in the application or use **Choose files** in Sources. A temporary overlay identifies file drags; dragged text is ignored. Newly added files are selected and automatically merged. Drops reopen a collapsed Sources panel, retain other normal-view tabs, and exit vertical expansion to show Sources.
2. Inspect each source's label, color, **Detected format**, counts, or error. Detected format is a separate read-only result of successful automatic parsing; it never fills the editable field. A dash appears for excluded files, empty files, parsing errors, pending settings, merges in progress, and files using an explicit override. Uncheck a file to exclude it while retaining its cache; use its remove button to remove it from the session. Disk files are never changed. Surviving labels and colors do not change on removal. Duplicate names remain distinct; adding a duplicate may first add numeric suffixes to existing labels.
3. Leave **Format override (optional)** blank for automatic detection. Enter a format there only when an override is needed. When all overrides are blank, filling the first field and leaving it copies its value to the remaining fields once. Later edits affect only the edited field; clearing every override enables copying again. Successful overrides are identified in the file's status text. Assign per-file timezones and adjustments in Sources, or a global fallback in Merge Settings, then select either **Remerge** button. The conditional UTC assumption is described under Timestamp rules. Changes are marked pending; an automatic merge from adding, including, excluding, or removing files also applies current settings. Your typed override is preserved after errors, so you can correct it.
4. Toggle reverse order to reorder cached entries immediately. Check **No filename** to hide source prefixes in both preview and download; uncheck it to restore them. It is unchecked by default. Filename and color changes apply without reparsing. Processing details appear separately from the merged result and download. If format, timezone, or adjustment edits are pending, reversing continues to use the last applied settings and downloading remains disabled.
5. Use **Hide controls** / **Show controls**, immediately left of the vertical-arrow button, to collapse or reopen the tab content globally. Tabs remain visible; Sources and Merge Settings retain their Remerge button beside the tab strip. Pending-setting status, errors, warnings, and enabled processing details remain outside the collapsed content. Collapsing gives the preview extra height, preserving its scroll position where the resized viewport permits. Switching tabs or clicking the selected tab preserves the global collapsed/expanded state; use Show controls to reveal the selected panel. Expanded Sources and help content use normal page scrolling. The vertical-arrow button shows only the logs and that button; press it again to restore the prior tab and collapse state.
6. Use **Filter logs** in Search / Filter to keep matching physical lines, or select **Invert match** to keep nonmatching lines (`grep -v`). The filter applies to both preview and download, including while controls are hidden or the preview is vertically expanded. Matching text is highlighted in the preview. Matching options have descriptions on hover or keyboard focus; exit vertical expansion and show controls to edit them.
7. Download the complete current result as plain text, including all retained lines when a filter is active. The download honors filenames and ordering, and never inserts highlights or ANSI colors. Leave the filename field blank for the template `merge--%Y%m%d.%H%M%S.log`, generated from the browser's local clock when Download is clicked. Enter a custom name or template to retain it across downloads. The filename preview updates while typing and when opening the Download tab. Each click captures both the template and timestamp, so edits made while the download is being prepared affect only subsequent downloads.

No selection, all-empty selected files, selected-file errors, pending settings, an in-progress merge/filter, no matching lines, an invalid filename template, and an invalid or timed-out filter disable downloading. Excluded errors do not block valid selected sources. Superseded worker responses cannot replace the newest result or produce a download from an older filter.

Decoding, parsing, sorting, filtering, and download construction happen in an embedded worker. Each file caches decoded content and parsed entries for its format/timezone settings; selection changes reuse the cache. Filter edits reuse the merged entries without reparsing timestamps. Explicit-offset and epoch files avoid reparsing when only the fallback changes. Adjustment-only changes reuse parsing and redo ordering and filtering. Removing a source releases worker caches. The page renders a small window of output rows; downloads contain the entire current filtered result regardless of scroll position. For very large results, scrollbar height is bounded and maps proportionally to the full row range.

### Filename templates

The browser's Download filename and CLI `-o PATH` accept `%Y %m %d %H %M %S %F %1N %2N %3N %z %s %%`. Names without specifiers remain unchanged. Use `%%` for a literal percent sign: `report-100%%.log` saves as `report-100%.log`, while `100%.log` is invalid. Invalid templates fail during CLI argument parsing or display an inline browser error that disables Download.

Expansion uses one instant in local time, captured at CLI start or browser Download click, independently of the log-parsing timezone. `%z` is the local offset at that instant, including daylight-saving changes; `%s` is Unix epoch seconds rounded down. `%1N` and `%2N` truncate milliseconds without rounding. Greater precision and bare `%N` are rejected because the clock provides only milliseconds. `%:z` and `%T` are rejected because they produce colons; use `%z` and `%H%M%S` instead.

For example, `merge--%F_%H%M%S.%3N%z.log` can produce `merge--2026-10-04_150809.037-0400.log`. The CLI expands the whole path, including directories: `-o 'archive/%Y/%m/merge.log'`. Parent directories must already exist; they are never created. The resolved output path retains all input-overwrite protections.

For UTC names, set `TZ=UTC`, for example `TZ=UTC node dist/loglinealign.js -o 'merge--%Y%m%d.%H%M%S.log' app.log`. Put templates in single quotes in POSIX shells, which leave `%` unchanged. In Windows `cmd` batch files, double every `%` to pass it to the program (and use double quotes around paths); a literal percent in the resulting filename therefore needs `%%%%` in the batch file.

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

Invalid regex syntax displays an inline error and clears the preview until corrected, including in inverted mode. Filtering or highlight matching that runs for about five seconds is stopped; simplify or clear the query to recover without reselecting files. After a timeout, the worker cache is rebuilt from the loaded files. Filtering is a browser feature; the CLI does not expose filter options.

## Scope and verification

The intended workload is a handful of roughly 10 MB text files. All entries and decoded text remain in memory; available browser/Node memory limits total size. There is no external sorting, live tailing, directory traversal, compressed-input support, server component, or sorted-input mode. Terminal colors repeat after eight sources; filenames remain available to distinguish them. Extremely long individual lines can still make browser rendering expensive.

No automated test framework is included. Use `make check` and `make` when changing behavior. The original acceptance checklist and verification notes remain in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [VERIFICATION.md](VERIFICATION.md); those historical documents do not cover the v0.4.0 interface and per-file time settings. These changes were checked with CLI scenarios and browser checks covering timezone precedence, adjustments, pending settings, downloads, global control visibility, drag-and-drop, and responsive layouts.

## Foundation-first source study order

1. `src/core/types.ts` — shared source, timestamp, entry, and diagnostic shapes.
2. `src/core/timezone.ts` and `src/core/time_adjustment.ts` — fixed timezone validation, descriptions, and nonmutating time adjustments.
3. `src/core/date_format.ts` — shared specifier tokenizer, feature subsets, and shorthand expansion.
4. `src/core/timestamp.ts` — automatic detection, explicit formats, epochs, and validation.
5. `src/core/filename_template.ts` — local-time filename expansion and validation.
6. `src/core/entries.ts` and `src/core/fallback.ts` — UTF-8 decoding, physical lines, block construction, and selection-wide fallback policy.
7. `src/core/merge.ts` — deterministic ordering and reverse tie behavior.
8. `src/core/format.ts` and `src/core/colors.ts` — labels, physical-line formatting, and stable colors.
9. `src/cli/options.ts`, `src/cli/files.ts`, and `src/cli/main.ts` — arguments, filesystem protection, and orchestration.
10. `src/web/filter.ts`, `src/web/protocol.ts`, and `src/web/worker.ts` — line matching, worker messages, cache management, viewport lookup, and downloads.
11. `src/web/time_controls.ts`, `src/web/file_drop.ts`, `src/web/main.ts`, `src/web/index.html`, and `src/web/styles.css` — per-file time controls, application-wide file drops, browser state, and presentation.
12. `package.json`, `tsconfig.json`, `scripts/build.mjs`, and `Makefile` — version metadata, strict checking, bundling, and artifact assembly.

## License

[MIT](LICENSE).
