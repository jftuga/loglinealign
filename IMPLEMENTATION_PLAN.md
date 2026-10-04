# loglinealign v0.3.0 implementation plan

This document is the self-contained implementation handoff for loglinealign v0.3.0. It incorporates the final decisions from the project discussion; the earlier PROJECT*.md discussion files and chat history are not needed. No application code has been written.

## Instructions for a fresh implementation session

Read this document and the repository's AGENTS.md before implementing. The product decisions below are settled. Details explicitly described as proposed are the recommended implementation defaults, not unanswered product questions. Choose and document routine tooling and internal design details; ask about genuine unresolved requirements before writing affected code, as required by AGENTS.md.

Implement both interfaces in this repository using the shared TypeScript engine and Makefile build described here. Deliver local build artifacts; deployment, hosting, and publishing are not part of this task. Do not add an automated testing framework unless the user requests one. Use type checking, builds, and the documented manual acceptance checks to verify the work. Do not commit or push unless requested.

Preserve the repository's existing instructions and license. Update README.md with setup, Make targets, CLI options and examples, timestamp rules, offline browser usage, limitations, and the foundation-first source study order. The next session should implement this plan rather than repeat the requirements discussion.

## Goal and scope

Merge multiple text log files into one chronological result through a Node.js CLI and a completely offline browser interface. Use TypeScript for both interfaces and share the timestamp parsing, entry construction, ordering, and text formatting logic.

Target a handful of roughly 10 MB files. Collect complete entry blocks and globally sort them in memory, including when timestamps are out of order within an input file. Do not require sorted inputs, add a sorted-input mode, or implement a separate order-validation pass. External sorting, compressed inputs, directory traversal, live tailing, and server components are outside the initial scope.

## Final ordering and missing-timestamp decisions

- Input ordering: globally sort entry blocks; unsorted inputs are supported.
- Leading untimestamped lines: attach them before the first timestamped entry in their own file, inheriting that entry's timestamp internally. Keep these leading lines and the timestamped entry in one block even in reverse output.
- Nonempty files with no valid timestamps: fail with an actionable error because there is no timestamp to inherit. Empty files contribute no entries. A file containing only a UTF-8 BOM is empty after decoding; whitespace-only content is nonempty and therefore needs a timestamp.

There is no separate unplaced-lines section. Never borrow a timestamp from a different input file. These decisions are confirmed and do not require further approval.

## Confirmed behavior

- Each file uses one timestamp format, but formats can differ between files.
- Detect supported timestamp formats automatically, with a per-file override available.
- Accept UTC and numeric offsets, with one fallback timezone shared by all inputs. If no fallback is supplied and every nonempty selected file needs one, warn and assume UTC. Mixed selections containing explicit-offset-only or epoch-only files still require a supplied fallback for missing offsets. Empty files do not affect eligibility, and all-empty selections produce no warning. Explicit offsets always take precedence.
- Do not support incomplete dates. Ambiguous numeric dates require a format override.
- Attach lines without timestamps to the preceding timestamped entry and move that block together.
- Untimestamped continuation lines inherit the last timestamp encountered in their own file, not the greatest timestamp encountered. Leading lines attach before their file's first timestamped entry. Nonempty timestamp-free files are errors; empty files are ignored. No separate unplaced-lines section is generated.
- Identify the source filename on every physical output line by default.
- Support `-N` and `--no-filename` to suppress source prefixes.
- Support `-r` and `--reverse` for reverse chronological output in both interfaces.
- Use a distinct source color where practical, with stable assignments within a run or browser session.
- Enable CLI color automatically for terminal output; disable it by default for pipes, redirection, and output files.
- Support `--color` to force color and both `-n` and `--no-color` to disable it.
- Produce one standalone HTML file with embedded assets, no CDN dependencies, and no server calls. It must work when opened directly from disk. Maintain multiple source files and use a Makefile to orchestrate the build into this single HTML artifact.
- Automatically merge when files are added or their inclusion checkboxes change.
- Provide browser controls corresponding to CLI options, a Remerge button, and a plain-text download.
- Allow the browser result panel to expand to the full available page width and collapse back.
- Allow an independent vertical expansion to fill the browser window height and collapse back.
- Provide a remove button beside each browser input to remove it from the loaded files and merged result.
- Default browser downloads to `merge--YYYYmmdd.HHMMSS.log`, replacing the pattern with the current date and time.
- Support launching the compiled CLI with `node`.
- Never open input files for writing or overwrite them through application-controlled output operations.

## CLI contract

Proposed invocation:

```text
node dist/loglinealign.js [options] FILE...
node dist/loglinealign.js --timezone UTC -o merged.log app.log database.log
node dist/loglinealign.js -n -N app.log database.log
node dist/loglinealign.js -r -v app.log database.log
node dist/loglinealign.js --format legacy.log 'DD/MM/YYYY HH:mm:ss' --timezone +02:00 legacy.log service.log
```

Input files are the final positional arguments. At least one input is required. `--` terminates option parsing for positional filenames beginning with a hyphen. Shell wildcard expansion remains the shell's responsibility.

| Option | Behavior |
| --- | --- |
| `-o PATH` | Write merged output to PATH; otherwise use STDOUT |
| `--timezone UTC\|±HH:MM` | Supply the fallback timezone for timestamps lacking an explicit offset |
| `--format FILE FORMAT` | Override one input file's timestamp format; repeat for different files |
| `--color` | Force 256-color ANSI output, including when output is redirected or written with `-o` |
| `-n`, `--no-color` | Disable generated ANSI color sequences |
| `-N`, `--no-filename` | Suppress source prefixes |
| `-r`, `--reverse` | Order timestamped entry blocks newest first, preserving line order within each block |
| `-v`, `--verbose` | Emit processing diagnostics to STDERR; proposed diagnostic option |
| `--version` | Print the exact version output below and exit successfully |
| `--help` | Print usage and supported format notation |

`--color` and either spelling of `--no-color` are mutually exclusive. A format override must identify exactly one supplied input; unknown targets or duplicate overrides are errors. The FILE value is the same path spelling used in the positional arguments.

`--version` emits these two uncolored lines, followed by a newline:

```text
loglinealign v0.3.0
https://github.com/jftuga/loglinealign
```

Diagnostics go to STDERR. Parsing errors identify the source filename, one-based line number when applicable, and reason, with a corrective hint where useful. Validate and construct the complete merge before emitting output, so parsing failures do not leave a partial result. Use a nonzero exit status for invalid arguments, parsing failures, or failed file operations.

Choose `-v` / `--verbose` rather than a debug flag. Include source names and sizes, detected or overridden formats, timezone assumptions, timestamped-entry and continuation-line counts, chosen order, processing durations, and a final summary. Do not echo log contents or mix diagnostics into the merged output. Normal errors remain visible without verbose mode. Reserve `--version` for the exact version output above; `-v` does not mean version.

Open all inputs read-only. For `-o`, reject an output path that refers to an input file, including equivalent paths, symbolic links, or hard links. Perform identity checks before creating output. Write through a temporary file in the output directory and replace the destination only after successful completion. An existing non-input destination may be replaced; failed merges leave it intact. Temporary-output cleanup must never remove input files.

Require regular-file inputs and reject named pipes without blocking for a writer. Keep input handles read-only and validate their actual file type after opening.

The program cannot prevent a shell from truncating an input before launch through a command such as `node dist/loglinealign.js app.log > app.log`. Document this shell-redirection limitation alongside the input-protection guarantee for application-controlled writes.

## Timestamp detection and parsing

Use explicit parsers rather than permissive, environment-dependent date parsing. Validate calendar dates, clock fields, and offsets. Preserve up to nine fractional-second digits using an integer comparison key; do not round timestamps to JavaScript Date's millisecond precision.

Initial automatic detection should cover these unambiguous families:

- Full year-first calendar dates with hyphens, followed by `T` or a space and a complete time, with optional fractional seconds and an optional explicit offset.
- Full year-first calendar dates with slashes, followed by a space and a complete time, with optional fractional seconds and an optional explicit offset.

Support decimal-point and comma fractional separators where the detected format specifies them. Locate timestamps inside prefixed or bracketed log lines, not only at column zero. A format remains fixed within each input; fractional precision and presence of a fraction can vary within a supported family.

Automatic detection establishes an unambiguous format from timestamp-bearing content, then validates the entire file against that choice. Consume the complete optional fractional field and offset within each supported family before considering shorter forms. Prefer one complete timestamp over date-only mentions elsewhere on the line, such as a BIOS date or a logged `--since 2026-09-08` argument; such lines must work without overrides in both interfaces. Two date-and-time candidates remain ambiguous regardless of their relative precision or timezone information. Recognizable malformed or incomplete date-and-time candidates still cause errors, including when another valid timestamp exists on the same line. If there is no complete timestamp, recognizable date-only records remain errors. Conflicting formats within one file also remain errors. Do not treat every long number as a Unix timestamp.

Append `Possible candidates:` to the automatic multiple-timestamp error in both interfaces. Derive quoted, distinct override formats from valid supported timestamps on the failing line, preserving first appearance, date/time separators, exact fraction widths/separators, and offset token style (`Z` or `ZZ`). Reuse the normal syntax/calendar validation; absent timezones must not prevent format suggestions. Omit malformed or unsupported candidates from the list without relaxing the ambiguity error; if none are valid, say `none (no valid supported timestamp candidates)`. Suggestions are diagnostic only and never populate/apply overrides automatically. A candidate may still need distinguishing literals and must validate across the whole file. Do not infer ambiguous day/month order or add new automatic families.

Proposed override notation uses `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, one to nine `S` characters for a fractional field, `Z` for `Z` or an offset containing a colon, and `ZZ` for an offset without a colon. Punctuation is literal; bracketed literals allow text such as `[T]`. Date and time fields must be complete. An override matches the timestamp substring within a line, allowing surrounding log text.

Also support explicit `epoch-s`, `epoch-ms`, `epoch-us`, and `epoch-ns` formats. Parse epoch values with integer arithmetic rather than floating-point conversion. Epoch values are absolute instants and do not require a fallback timezone.

Formats such as `DD/MM/YYYY HH:mm:ss` and `MM/DD/YYYY HH:mm:ss` require an override even if particular sample dates happen to disambiguate their field order. Missing years, time-only records, named timezones, and unsupported timestamp forms are outside initial support.

Explicit offsets take precedence over the supplied fallback timezone. Convert timestamps only for sorting; preserve their original text in output.

Preserve literal leading/trailing spaces in nonblank format overrides in both interfaces; only a whitespace-only browser field means automatic detection. Explicit trailing literals delimit the timestamp from message text; apply trailing field/suffix checks only when the format ends in a timestamp field. Epoch candidates must be standalone complete numeric tokens on both sides, including sign boundaries. Reject recognizable calendar dates and leading clock-only records before numeric extraction so their year or minute fields cannot become epoch values.

## Entry construction and ordering

Represent each timestamped entry with its comparison key, source identity, original line position, and original text block. Source identity is distinct from its display filename.

A line without a timestamp inherits the most recently encountered timestamp in the same file and stays attached to that timestamped entry. This is internal metadata; do not insert or rewrite timestamps in the original text. Do not inherit a timestamp from another file or use the maximum timestamp seen. Attach leading lines before their file's first timestamped entry as part of the same block. A nonempty file without any valid timestamps is an error; an empty file contributes nothing.

A recognizable timestamp candidate that is invalid, incomplete, or ambiguous is a parsing error, not a continuation line. Date-only mentions alongside a single complete timestamp are ordinary message text. Date-only content on a line without a complete timestamp is still an error. Detection cannot distinguish every unsupported timestamp from arbitrary message text; document the supported recognition rules and expose per-file detected format and counts in the browser to make results inspectable.

Globally sort complete entries by:

1. Absolute timestamp, ascending.
2. Input-file order for identical timestamps.
3. Original line position within that file.

Retain duplicates. Never sort individual continuation lines independently. Source clocks are assumed to be accurate; clock-skew correction is outside scope.

With `-r` / `--reverse`, reverse only the timestamp comparison. Preserve input-file order and original line position as tie-breakers, and always preserve the original line order inside each entry block. Do not reverse the finished text or reverse stack traces.

## Output representation

Prefix every physical line with `[filename] ` by default, including blank lines and continuation lines. For identical basenames, use stable labels such as `app.log [1]` and `app.log [2]`, assigned in input order.

Right-justify source labels with leading spaces inside the brackets, leaving the last label character adjacent to `]`. Calculate width once per selection from the longest selected label, including duplicate suffixes and empty files. Apply it through the shared formatter to CLI terminal/file output and browser preview/downloads. Keep stored labels unchanged. Browser filters and viewport changes retain the selection's width; source inclusion/removal recalculates it. Filename suppression removes the entire prefix, including padding, while color remains independent.

Do not generate an unplaced-lines section or other grouping headings. Untimestamped continuation lines remain inside their entry blocks and receive the same filename and color treatment. With `-N` / `--no-filename`, omit all generated source labels.

Normalize line endings to LF and terminate nonempty output with a newline. Preserve original line content otherwise. A terminal newline is a line terminator, not an additional blank log record. Initially read UTF-8, accept a leading UTF-8 BOM, and report invalid input encoding rather than silently replacing characters.

Color is a presentation layer over the same merged result. Use a curated 256-color terminal palette and corresponding browser colors. Assign colors using original source order, not the currently selected subset. For counts beyond the palette, colors may repeat; filenames remain available by default.

## Standalone browser behavior

The page contains a drop zone with an equivalent file picker, a file list, merge settings, status and error information, a scrollable result panel, and download controls. Render log content as text, never as HTML.

Provide an expand/collapse button with horizontal arrows, an accessible label, and an expanded-state indication. Expanded mode gives the results the full available page width by collapsing the adjacent controls; the same button restores the normal layout. This is an in-page layout change, not browser fullscreen. Keep the button reachable in both states.

Place a matching up/down-arrow button immediately to the right of the horizontal control. It independently expands the results panel to the browser window height, hiding the page header and footer and letting the log preview fill the remaining panel space. A second activation restores normal height and the header/footer. Preserve the current horizontal expansion state when toggling vertically and vice versa. Keep filters, status/warnings, download controls, and both expansion buttons available; bound the diagnostics panel's height and allow scrolling when the window is too short to fit all controls. Scroll the results panel into view on toggles and refresh the virtualized preview without reparsing logs. Give the button an accessible action label, tooltip, and accurate `aria-expanded` state.

Each newly added file starts checked. Each row shows its filename, source color, an editable field labeled "Format override (optional)", a separate read-only "Detected format" value, status or error, inclusion checkbox, and remove button. Automatic detection never populates the override field. Display the detected value only after successful automatic parsing of a selected nonempty file; show a dash for errors, pending/in-progress merges, excluded/empty files, and explicit overrides. Identify successful overrides in the status text, and preserve user-entered overrides after errors. Files with identical names remain distinct inputs. Removing a file releases its cached content and immediately recomputes the merge; unchecking a file keeps it loaded for later inclusion. Removal affects only browser state and never deletes or changes a file on disk. Remaining files retain their existing colors and source labels.

When all Format override fields are blank, entering a nonblank override in the first file's field and leaving it copies the complete value to every remaining loaded file's field once. Wait for focus to leave the field rather than copying while typing. Preserve literal leading and trailing spaces; whitespace-only values count as blank. Do not copy if a remaining field already has a nonblank override. Subsequent edits to any field affect only that field; clearing every override enables copying again. Newly added files retain blank overrides, and removing the first file makes the next displayed file eligible under the same blank-field rule. Copied settings are marked pending and apply through Remerge or the next automatic merge.

Adding files or changing inclusion checkboxes automatically merges the current selection. Changes to parsing settings are marked pending and can be applied with Remerge; an automatic merge also uses the current settings. Color and filename-display changes can update presentation immediately without reparsing timestamps.

Expose a Reverse chronological order checkbox corresponding to `-r` / `--reverse`; changing it immediately recomputes the order from cached entries. Include a Show processing details checkbox corresponding to `-v` / `--verbose`, with diagnostics in a separate panel rather than the merged result or download. Timezone, per-file formats, filename visibility, color, and download filename also have browser controls.

Use an unchecked-by-default **No filename** checkbox for filename visibility. Checking it immediately hides generated prefixes in preview and download; unchecking restores aligned prefixes without reparsing. Highlight offsets account for the padded prefix, and pending downloads retain the filename-setting consistency check.

When no files are selected, show an empty state and disable downloading. Selected empty files contribute no entries; if the entire selected set is empty, show an empty result and disable downloading. If all nonempty selected files need a fallback timezone and none is supplied, validate all files, then assume UTC and display a warning outside the preview/download text, independently of verbose mode. Leave the timezone input blank and identify UTC as assumed in source diagnostics. Reevaluate eligibility on every selection change, including cache reuse. CLI warnings go to STDERR. Other parsing errors and mixed-selection missing-timezone errors block downloading. An excluded file's errors do not block the selected files. Also disable downloading while parsing settings are pending or the newest merge is in progress, so an obsolete result cannot be downloaded as if it reflected the current settings.

Give every message in the browser warning banner a right-aligned `X` button with an accessible "Dismiss warning" label. Clicking it or activating it with the keyboard hides the entire banner and moves focus to the log preview. Apply dismissal to any warning text, not only the automatic UTC warning. Dismissal affects the current banner only: filtering and presentation changes keep it hidden, while a later merge may display a warning again. Keep warning text separate from the button so message updates preserve the dismissal control.

Cache parsed entries per file and its parsing settings. Changing selection only rebuilds the merge. Changing an override reparses the affected file; changing the fallback timezone invalidates affected cached entries.

Keep large parsing and sorting operations off the UI thread using an embedded worker created locally from bundled code. Render only the visible portion of the output rather than adding every log line to the DOM. Discard obsolete results when settings or selection change during processing, so an older merge cannot replace a newer one.

Provide a browser text filter above the preview, available in both normal and expanded layouts. Include VS Code-style `Aa` (Match case), underlined `ab` (Match whole word), and `.*` (Regular expression) toggle buttons with hover and keyboard-focus descriptions and accessible pressed states. Add an unchecked-by-default **Invert match** checkbox that keeps only nonmatching lines, like `grep -v`. Default to case-insensitive literal matching; all options can be combined. Search original physical lines, excluding generated source labels. Whole-word matching uses Unicode letters, combining marks, numbers, and underscores as word characters. Regex mode uses JavaScript Unicode expressions applied per physical line. Empty text disables filtering even with inversion enabled; Clear empties the query while preserving every option.

The user selected filtering both preview and download, keeping matching physical lines by default and nonmatching physical lines with inversion enabled, rather than complete entry blocks. Preserve each retained line's original position within its entry and that entry's global order. Show filtered/total counts, active inversion, an appropriate empty-result state, and inline regex errors. Reuse cached merged entries for filtering; keep matching off the UI thread, discard obsolete results/downloads, and stop long-running filtering or highlight matching after about five seconds with a recoverable error. A timeout may rebuild worker caches but must retain the loaded files and controls. Disable downloading while filtering, on filter errors/timeouts, and when no lines remain. Filtering does not add CLI options or suppress input parsing errors.

Highlight all nonoverlapping matches in preview rows using the same expression as filtering. Search only original log text and adjust match positions for displayed source labels; labels themselves are never highlighted. Compute ranges only for visible rows in the worker. Render highlights with text nodes and styled `mark` elements, preserving text safely and supporting both colored and uncolored sources. Empty filters and inversion produce no highlights. Zero-width regex matches affect line selection but produce no visible highlight. Scrolling, filename toggles, and newer filter results must preserve correct highlighting.

The download contains all retained plain-text lines when filtering is active (matching or nonmatching, according to inversion) and the complete merge otherwise, regardless of which rows are visible. It honors filename-display and reverse-order settings. Browser highlights and colors never become markup or ANSI escape codes in the downloaded file. Default the download filename to `merge--YYYYmmdd.HHMMSS.log`, for example `merge--20261002.143507.log`, and allow editing it. Proposed date policy: generate the automatic name using the browser's local clock at download time, zero-pad every field, and use a 24-hour clock. The filename clock is independent of the log-parsing fallback timezone. Preserve a user-supplied custom filename instead of regenerating it.

Expose the exact application version and repository link in the page. Opening that link is an explicit user action; the application itself makes no network requests. Embed usage help and all runtime assets in the generated HTML.

## Proposed module responsibilities and study order

Keep filesystem, terminal, and DOM dependencies out of the shared engine. Prefer functions and simple data structures; do not introduce a class hierarchy.

Read the eventual implementation in this foundation-first order:

1. `src/core/types.ts`: source, timestamp, entry, options, and diagnostic data shapes.
2. `src/core/timezone.ts`: fallback timezone validation and offset arithmetic.
3. `src/core/timestamp.ts`: supported format definitions, detection, overrides, and timestamp validation.
4. `src/core/entries.ts` and `src/core/fallback.ts`: line splitting, inherited timestamps, continuation grouping, and selection-wide fallback policy.
5. `src/core/merge.ts`: deterministic ascending or descending ordering and merged-result construction.
6. `src/core/format.ts`: source labels and text output.
7. `src/core/colors.ts`: stable source-to-color assignments for both interfaces.
8. `src/cli/options.ts` and `src/cli/main.ts`: argument handling, filesystem boundaries, terminal presentation, and exit behavior.
9. `src/web/filter.ts`, `src/web/protocol.ts`, and `src/web/worker.ts`: line matching, worker messages, background parsing, cache management, filtering, and merge requests.
10. `src/web/main.ts`, `src/web/index.html`, and `src/web/styles.css`: file selection, controls, result display, and download behavior.
11. `Makefile` and build configuration: compile the CLI and embed the browser bundle, worker, and styles into one distributable HTML file.

Keep version information in one authoritative location and inject it into both interfaces during the build. Use Make as the documented build entry point, delegating compilation and bundling to project-local tools. Targets include `make install` for frozen-lockfile dependency installation, `make` / `make all` for both artifacts, `make cli`, `make web`, and `make check` for type checking. The CLI artifact is `dist/loglinealign.js`; the standalone browser artifact is `dist/loglinealign.html`. The latter must require no sibling assets or source files at runtime. Exact compiler/bundler versions and supported Node.js versions will be selected and verified before implementation. No Makefile or build code is created during planning.

The CLI `.js` artifact must also run with no sibling dependencies under either CommonJS or ES-module package settings. Bundle its implementation into a scope with a dynamically imported Node built-in require function, avoiding a dependency on the surrounding package's module mode. Verify copies outside the repository in both package modes and with no package.json.

Use pnpm for dependency installation and updates. Pin pnpm 12.8.1 in the `packageManager` field of `package.json`, preserve the existing exact development dependency versions, and use `pnpm-lock.yaml` as the sole dependency lockfile. Provide a phony `make install` target that runs `pnpm install --frozen-lockfile`. Run it before the first build and after cleaning; keep `all` as the default target. Configure `allowBuilds` for esbuild in `pnpm-workspace.yaml` so its platform executable is prepared during installation. Retain the Make targets and the equivalent `pnpm check` / `pnpm build` scripts.

Provide a `make clean` target using `rm -rf` that removes only the generated-project paths listed together at the top of `.gitignore`: root `dist/`, `node_modules/`, `.pnpm-store/`, `*.tsbuildinfo`, `pnpm-debug.log*`, and `.pnpm-debug.log*`. Use `-f` so absent paths are harmless and repeated cleaning succeeds, and handle matching symbolic links without traversing their targets. Preserve sources, both pnpm YAML files, user log data, environment files, and external pnpm stores. Document that rebuilding after cleaning requires `make install`. Verify the cleanup paths are ignored and that cleanup leaves source/configuration files intact; never equate all ignored files with disposable build output.

## Implementation sequence

1. Read the confirmed requirements, inspect the local toolchain, and select compatible compiler/bundler versions. Use the documented timestamp grammar and CLI override notation as the implementation defaults.
2. Establish TypeScript configuration, Makefile build targets, and the shared source and diagnostic types.
3. Implement timezone handling, timestamp detection, explicit formats, and strict validation.
4. Implement entry grouping, chronological ordering, and shared output formatting.
5. Implement the CLI, including input protection, output handling, filename and color aliases, reverse ordering, verbose diagnostics, help, and version output.
6. Implement the offline browser interface, background processing, automatic merging, settings, file removal, width expansion, and dated downloads.
7. Produce distributable CLI output and the single HTML artifact; document installation, usage, supported formats, and limits.
8. Perform the acceptance checks below and record results. Do not add an automated test harness unless requested.

## Acceptance examples and checks

- Interleave files using different supported formats and explicit timezone offsets.
- Automatically parse a complete timestamp accompanied by date-only message text before or after it, including BIOS dates and logged date arguments. Consume fractions and offsets in full; retain errors for two date-and-time candidates, malformed candidates, incomplete records, and ambiguous numeric record timestamps.
- Verify ambiguity suggestions in both interfaces, including separators, fraction precision, offsets, timezone-free timestamps, duplicate formats, invalid/unsupported candidates, and the no-valid-candidates message. Check that suggested overrides can be copied into the UI/CLI, remain unapplied until chosen, and preserve the need for distinguishing literals when formats repeat.
- Reorder unsorted timestamped blocks while preserving attached stack traces.
- Preserve duplicate entries and produce stable output for identical timestamps.
- Preserve untimestamped continuation lines through inherited timestamps without emitting an unplaced section. Attach leading lines before their file's first timestamped entry, reject nonempty timestamp-free files, and ignore empty files.
- Verify reverse chronological order preserves equal-timestamp tie-breakers and the line order of multiline entries.
- Verify automatic UTC with a warning when every nonempty selected input needs a fallback; no warning for all-empty inputs or supplied fallbacks. Retain missing-timezone errors for mixed selections. Check explicit offsets, invalid inputs, cache reuse after selection/settings changes, and warning-free merged output.
- Reject ambiguous numeric dates without overrides and accept correctly specified per-file overrides.
- Reject invalid calendar dates and retain nanosecond ordering precision.
- Verify filename prefixes, duplicate basenames, and equivalent `-N` / `--no-filename` behavior.
- Verify equivalent behavior of `-n` and `--no-color`, terminal auto-color, forced color, and plain output defaults for redirection and `-o`.
- Confirm the exact two-line `--version` output.
- Verify verbose diagnostics go only to STDERR, match `-v` / `--verbose`, and never include log contents.
- Verify inputs remain unchanged after successful and failed operations; reject output aliases through equivalent paths, symbolic links, and hard links. Verify failed parsing leaves an existing output file untouched.
- Build both artifacts through Make and launch the CLI with `node dist/loglinealign.js`.
- Open the generated HTML directly from disk with networking unavailable; verify file loading, merging, controls, and downloads.
- Verify automatic merges on drop and selection, stable colors, pending parsing settings, and no obsolete result replacing a newer one.
- Verify first-field override copying only on leaving the field, independent subsequent edits, re-enabling after clearing all fields, preservation of literal spaces, whitespace-only handling, protection of existing overrides, pending/download blocking and Remerge, blank overrides on newly added files, and eligibility after removing the first file.
- Verify browser reverse ordering, verbose details, horizontal/vertical expand-collapse controls both independently and together, and automatic remerging after file removal. Confirm vertical expansion restores the header/footer on collapse and refreshes visible rows on resizing. Removal must not alter files on disk or reassign surviving source colors and labels.
- Verify timestamped default download names and preservation of custom names.
- Confirm downloaded browser output matches CLI plain-text output for equivalent inputs and settings.
- Verify literal, case-sensitive, whole-word, regex, and inverted filtering, including combined options, Unicode word boundaries, invalid patterns, timeout recovery, and superseded requests. Confirm that preview and full download retain the same matching/nonmatching physical lines, and that empty/cleared filters restore all lines even with inversion enabled. Verify multiple highlights, zero-width/Unicode matches, safe rendering of HTML-like text, filename offsets, colored/uncolored rows, scrolling, stale results, highlight timeout recovery, and plain-text downloads. Verify hover/focus descriptions and access to filter controls in expanded mode.
- Exercise a handful of roughly 10 MB files and verify that the page remains interactive and the full download is independent of the visible preview.

## Concrete ordering example

Given these files in positional order `a.log b.log`, with color disabled:

`a.log`:

```text
startup banner
2026-10-02T10:00:02Z A second
  A second detail
2026-10-02T10:00:00Z A first
```

`b.log`:

```text
2026-10-02T10:00:01Z B middle
2026-10-02T10:00:02Z B tied
```

Default output:

```text
[a.log] 2026-10-02T10:00:00Z A first
[b.log] 2026-10-02T10:00:01Z B middle
[a.log] startup banner
[a.log] 2026-10-02T10:00:02Z A second
[a.log]   A second detail
[b.log] 2026-10-02T10:00:02Z B tied
```

Output with `-r`:

```text
[a.log] startup banner
[a.log] 2026-10-02T10:00:02Z A second
[a.log]   A second detail
[b.log] 2026-10-02T10:00:02Z B tied
[b.log] 2026-10-02T10:00:01Z B middle
[a.log] 2026-10-02T10:00:00Z A first
```

The banner inherits the first timestamp encountered in its original file, even though that is not that file's earliest timestamp. The continuation remains after its parent entry, and equal timestamps keep file-input order in both directions. With `-N`, remove only each generated `[filename] ` prefix.

## Completion criteria

- A fresh checkout can install dependencies with `make install` and build both artifacts using Make. Include `pnpm-lock.yaml` for reproducible installs; creating a Git commit is not required or authorized by this plan.
- The Node CLI implements every documented option and produces the specified version output, plain-text behavior, ordering, diagnostics, and input-file protection.
- The generated HTML works directly from disk without network access or adjacent asset files, with all documented controls and complete downloads.
- Shared merge behavior is consistent between CLI and browser. Type checking, builds, and available manual acceptance checks have been performed; report any checks that could not be completed instead of claiming success.
- README.md contains the usage and build documentation and a foundation-first source study order. Summarize delivered artifacts, verification, and any remaining limitations when finished.
