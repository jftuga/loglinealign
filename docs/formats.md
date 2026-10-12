# Formats, timezones, and output

[README](../README.md) · [CLI](cli.md) · [Browser](browser.md) · [Formats](formats.md) · [Development](development.md)

These rules apply to both the CLI and offline browser.

[Timestamp rules](#timestamp-rules) · [Timezones and adjustments](#per-file-timezone-and-time-adjustment) · [Format overrides](#format-overrides-and-specifiers) · [Entry ordering](#entry-ordering-and-output) · [Filename templates](#filename-templates)

## Timestamp rules

Automatic detection finds full year-first timestamps anywhere in a line, including inside brackets or after a prefix:

```text
2026-10-02T14:35:07Z
2026-10-02 14:35:07.123456789+02:00
2026/10/02 14:35:07,123-0400
[service] [2026-10-02T14:35:07Z] message
```

The year has four digits; month, day, hour, minute, and second have two each. Hyphenated dates accept `T` or one space before the clock; slash-separated dates accept one space. Optional fractions use a dot or comma and one to nine digits. Optional offsets are attached `Z`, `±HH:MM`, or `±HHMM`, through ±23:59.

Each file must use one date family, date/time separator, and fractional separator. Fraction presence and precision may vary, as may explicit offsets. Dates use the proleptic Gregorian calendar, years 0001–9999. Invalid dates, clock fields, offsets, leap seconds, and excessive fractional precision are rejected. Parsing determines order; original timestamp text is retained.

### Per-file timezone and time adjustment

Timezone precedence is:

1. Explicit timestamp offset or epoch value.
2. **File timezone** / `--file-timezone`.
3. Global **Fallback timezone** / `--timezone`.
4. The [conditional UTC assumption](#missing-timezones-and-the-utc-assumption).

Fallbacks accept `UTC` or fixed offsets through ±23:59, including `+05:30` and `+05:45`. They interpret only timestamps without offsets: `12:00` with `+02:00` means `10:00 UTC`. Local machine timezone, named regions, and daylight-saving rules are never inferred.

**Time adjustment** / `--time-shift` adds a constant duration after timezone interpretation, including to explicit-offset and epoch timestamps. Use a sign, at least two hour digits, and two minute digits from 00 to 59: `+00:30` means 30 minutes later, `-01:00` one hour earlier, and `+24:00` one day later. Decimal hours and seconds are unsupported. Adjustments preserve nanosecond precision, cross date boundaries, and never accumulate across repeated merges. Clock errors are not detected automatically.

Adjustments change ordering without rewriting timestamp text, so displayed times may look out of order. Downloads contain no adjustment metadata; reprocessing them requires equivalent settings for the corresponding source entries. Fixed offsets and constant adjustments cannot handle a timezone-less file spanning a daylight-saving transition or a changing clock error. See the [browser controls](browser.md#set-formats-and-timezones) for applying these settings.

### Missing timezones and the UTC assumption

UTC is assumed only after all selected files validate, when no global fallback is supplied and every nonempty selected file both:

- Contains at least one timestamp without an offset.
- Has no per-file timezone assignment.

The CLI warns once on STDERR; the browser warns above the preview and allows export without filling timezone fields. Warnings never enter output. Explicit offsets remain authoritative. Empty and BOM-only files are ignored; an all-empty selection produces no warning. The policy is reevaluated when the selection changes.

If the selection includes explicit-offset-only or epoch-only files, or some files already have timezone assignments, assign a timezone to each unresolved file or supply a global fallback. Excluded and empty files do not cause missing-timezone errors, but malformed settings for included files are still rejected.

### Lines with multiple timestamps and ambiguity errors

One complete date/time takes precedence over date-only mentions. For example, `2026-09-10T11:55:07.155861+0300 ... --since 2026-09-08` needs no override; neither does a complete timestamp alongside a BIOS date such as `05/22/2023`. Detection consumes the full fraction and offset.

Multiple date/time candidates are ambiguous, even if one is malformed or another has greater precision. Use an override with distinguishing literals or fields. For example, `%Y-%m-%dT%H:%M:%S.%6N%z` can select `2026-07-20T12:33:25.583969+0300` over a second timestamp in a kernel `setting system clock to ...` message that lacks that fraction and offset style.

Ambiguity errors suggest distinct formats from valid supported candidates, in line order:

```text
Multiple timestamp candidates with clock fields on one line; use a format override with distinguishing literals. Possible candidates: "%Y-%m-%dT%H:%M:%S.%6N%z", "%Y-%m-%d %H:%M:%S%:z".
```

Suggestions preserve separators, fractional width, and offset style. They are never applied automatically and describe only the failing line. Copy one without surrounding quotes into **Format override**, or quote it as the CLI `--format` argument. It must fit the entire file; add distinguishing literals if it still matches twice. Invalid or unsupported candidates are omitted; if none qualify, the error reports `Possible candidates: none (no valid supported timestamp candidates)`.

### Recognition limits

Recognizable date starts include year-first dates with a four-digit year, one- or two-digit month, and optional day, plus numeric day/month/year dates, outside alphanumeric tokens. A following `T`, or spaces/tabs followed by digits and a colon, marks a date/time candidate even when incomplete. Selection among candidates follows the [ambiguity rules](#lines-with-multiple-timestamps-and-ambiguity-errors).

Recognizable dates without a complete timestamp fail instead of becoming continuation text. Clock-only and month/day-plus-clock records at the start of a line, optionally after whitespace and `[`, also fail. Attached malformed suffixes, common timezone abbreviations, and whitespace-separated numeric offsets are rejected by automatic detection.

Detection cannot identify every unsupported timestamp or distinguish a full timestamp quoted in prose from a record timestamp. Named-month dates may become continuation text, while a calendar date on a continuation line may cause an error. Inspect detected formats and counts; use distinguishing overrides where appropriate. Automatic detection never falls back to date-only, time-only, or epoch parsing.

### Format overrides and specifiers

Numeric dates such as `02/10/2026 14:35:07` require an override even when values suggest a date order. Overrides and filename templates use these case-sensitive specifiers:

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

Every calendar date/time field is required exactly once; fraction and zone fields may appear at most once. Shorthands expand first, so `%F %Y` repeats the year. Unsupported specifiers, including `%0N`, `%10N`, and a trailing `%`, produce errors listing valid choices.

Other characters are literal, including leading/trailing spaces in a nonblank override. Include the fraction separator, such as `.%3N` or `,%6N`; `[%F %T]` matches a bracketed timestamp. The browser treats whitespace-only overrides as automatic detection.

Overrides match substrings and retain surrounding text. A recognizable timestamp that fails the override is an error. A trailing literal separator, as in `%Y-%m-%dT%H:%M:%S%:z | `, allows the remaining text to be message content. Overrides ending in a timestamp field still reject attached malformed fractions, offsets, and suffixes.

### Epoch overrides

Use `epoch-s`, `epoch-ms`, `epoch-us`, or `epoch-ns` for standalone signed numeric tokens. Epochs use integer arithmetic, represent absolute instants, need no timezone, and are never auto-detected. Only `epoch-s` accepts a decimal-point fraction, through nine digits, including negative fractional seconds; other units require integers.

Multiple standalone numbers are ambiguous; digits in identifiers are ignored. Joined values such as `123-456` and `123+456` are not standalone tokens. Recognizable calendar dates and leading clock-only records are rejected before their numeric fields can be mistaken for epochs.

## Entry ordering and output

Each timestamp starts an entry block. Following untimestamped lines attach to that entry even when timestamps are unsorted. Leading untimestamped lines attach before the file's first timestamped entry. Thus a banner before `10:00:02` stays with that entry when a later `10:00:00` entry sorts ahead of it.

Blocks sort by absolute timestamp plus adjustment, then original input-file order, then timestamp line position. Reverse changes only the timestamp comparison: equal-time ties and block contents keep their order. Duplicates remain; reversing does not reverse stack traces.

Empty and BOM-only files contribute nothing. Nonempty files without timestamps fail, including whitespace-only files. Malformed UTF-8 also fails.

### Line prefixes and output formatting

Every physical line, including blank and continuation lines, gets a source prefix unless disabled. Labels are right-justified to the longest selected label, including duplicate-name suffixes and selected empty files:

```text
[  vmstat.log] procs -
[vmstat_1.log] procs -
```

Browser filtering retains that width; excluding or removing sources recalculates it. Use `-N` / `--no-filename` or **No filename** to omit the prefix and padding.

A leading UTF-8 BOM is accepted. CRLF and CR normalize to LF; nonempty output ends with a newline. A final input newline adds no extra blank record. No headings or unplaced-lines section are added.

## Filename templates

The browser's Download filename and CLI `-o PATH` accept the filename subset in the [specifier table](#format-overrides-and-specifiers). Names without specifiers are unchanged. Use `%%` for a literal percent: `report-100%%.log` becomes `report-100%.log`; `100%.log` is invalid. Invalid templates fail CLI argument parsing or disable browser Download.

### Expansion details and shell quoting

Expansion captures one local-time instant at CLI start or browser Download click, independently of the parsing timezone. `%z` uses that instant's local offset, including daylight-saving changes; `%s` floors Unix epoch seconds. Fractional digits truncate milliseconds without rounding; greater precision and bare `%N` are unsupported. Use `%z` instead of `%:z` and `%H%M%S` instead of `%T` to avoid colons.

For example, `merge--%F_%H%M%S.%3N%z.log` can produce `merge--2026-10-04_150809.037-0400.log`. The CLI expands directories too: `-o 'archive/%Y/%m/merge.log'`. Parent directories must exist; [input-overwrite protections](cli.md#input-protection) still apply.

For UTC filenames in the CLI, use `TZ=UTC`, for example `TZ=UTC node dist/loglinealign.js -o 'merge--%Y%m%d.%H%M%S.log' app.log`. Single-quote templates in POSIX shells. In Windows `cmd` batch files, double each `%` and double-quote paths; a literal percent in the resulting filename therefore requires `%%%%` in the batch file.
