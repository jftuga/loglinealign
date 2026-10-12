# CLI reference

[README](../README.md) · [CLI](cli.md) · [Browser](browser.md) · [Formats](formats.md) · [Development](development.md)

Run these examples from the repository root after [building the CLI](../README.md#build).

## Examples

### Merge and save

```sh
# Print the merge, or save it with an explicit fallback timezone.
node dist/loglinealign.js app.log database.log
node dist/loglinealign.js --timezone UTC -o merged.log app.log database.log

# Use a dated output filename.
node dist/loglinealign.js -o 'merge--%Y%m%d.%H%M%S.log' app.log database.log
```

### Change presentation

```sh
# Omit colors and source labels.
node dist/loglinealign.js -n -N app.log database.log

# Show newest entries first, with diagnostics on STDERR.
node dist/loglinealign.js -r -v app.log database.log
```

### Interpret timestamps and correct clocks

```sh
# Override a calendar format or select an epoch unit.
node dist/loglinealign.js --format legacy.log '%d/%m/%Y %H:%M:%S' \
  --timezone +02:00 legacy.log service.log
node dist/loglinealign.js --format epoch.log epoch-ns epoch.log

# Assign offsets to timestamps that omit them.
node dist/loglinealign.js --file-timezone east.log +02:00 \
  --file-timezone west.log -05:00 east.log west.log

# Move a slow clock's entries 30 minutes later.
node dist/loglinealign.js --time-shift slow.log +00:30 slow.log reference.log
```

### Handle filenames beginning with a hyphen

```sh
node dist/loglinealign.js -- -filename-starting-with-a-hyphen.log
```

## Options

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
| `--version` | Print the version and repository URL |
| `--help` | Usage and supported format notation |

`--color` and `--no-color`/`-n` are mutually exclusive. Without either, color is enabled only when STDOUT is a terminal and `-o` is absent. Turning color off suppresses generated escape sequences; escape sequences already present in input text are preserved.

## Per-file targets and diagnostics

Each per-file option's FILE must exactly match the spelling of one positional input. Unknown targets, ambiguous repeated positional targets, and duplicate assignments for the same option are errors. Different per-file options may target the same input. Identical basenames receive labels such as `app.log [1]` and `app.log [2]`. Labels and color assignments follow original input order.

Errors and verbose diagnostics go to STDERR. Verbose output includes source names, byte sizes, detected/overridden formats, effective timezone usage, per-file adjustments, entry and continuation counts, leading lines, ordering, and durations; it does not print log contents. Invalid arguments, parsing errors, and failed file operations exit nonzero. The complete merge is validated before any result is emitted.

## Input protection

Shell redirection runs before the application and can truncate inputs before protection is possible. **Never run `node dist/loglinealign.js app.log > app.log`.** Use `-o` for application-controlled output protection. Ordinary filesystem races and external processes changing inputs during a run are outside the guarantee.

### How inputs and output are protected

Inputs are opened read-only. `-o` rejects an input's own path, equivalent paths, symlink aliases, and hard-link aliases by checking canonical paths and filesystem identities. Output is written to an exclusively created temporary file in the destination directory, synced, and renamed into place only after success. An existing non-input destination can be replaced; parse failures leave it intact. Replacement creates a new file with owner-only permissions, rather than preserving the previous destination's permissions. An existing non-input symlink is replaced itself, rather than writing through to its target.

Inputs must be regular files. Named pipes are rejected without waiting for a writer; directories and devices are also rejected.

## Related reference

See [timestamp formats and overrides](formats.md#timestamp-rules), [timezones and adjustments](formats.md#per-file-timezone-and-time-adjustment), [entry ordering](formats.md#entry-ordering-and-output), and [output filename templates](formats.md#filename-templates).
