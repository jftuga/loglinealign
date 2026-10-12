# Offline browser guide

[README](../README.md) · [CLI](cli.md) · [Browser](browser.md) · [Formats](formats.md) · [Development](development.md)

Open `dist/loglinealign.html` directly in a modern browser supporting BigInt, Blob workers, and local downloads. All processing stays on your device; no server or sibling assets are required. **Formats & usage** provides offline help.

## Sources and settings

Drop files anywhere on the page or use **Choose files** in **Sources**. Added files are selected and merged automatically. Uncheck a file to exclude it, or remove it from the session; neither action changes the disk file. Duplicate filenames receive distinct labels. Removing files preserves surviving labels and colors.

Each source shows its counts, errors, and **Detected format**. The detected format appears only after successful automatic parsing of a nonempty selected file; otherwise it shows a dash. It never fills the editable override field.

### Set formats and timezones

Leave **Format override** blank for automatic detection. When all overrides are blank, entering one in the first field and leaving that field copies it to the others once. Subsequent edits affect only that field; clearing all overrides enables copying again. Errors preserve your typed override for correction. See [format overrides](formats.md#format-overrides-and-specifiers).

Each source has independent **File timezone** and **Time adjustment** controls, including sources with duplicate names. A blank File timezone inherits **Fallback timezone** from **Merge Settings**. Time adjustment defaults to `+00:00` and must remain a valid signed duration. Type a duration or choose a 30-minute/1-hour step and use **Earlier** or **Later**; **Reset** restores `+00:00`. See [timezone precedence and adjustment rules](formats.md#per-file-timezone-and-time-adjustment).

Format, timezone, and adjustment edits remain pending until **Remerge**. Adding, including, excluding, or removing files also merges with the current settings. While edits are pending, exports are disabled and reversing uses the last applied settings.

### Change ordering and presentation

In **Merge Settings**, use **Reverse chronological order**, **No filename**, or **Color by source** to change the result's presentation. Filename prefixes are shown by default. **Show processing details** reports formats, effective timezones, unused fallbacks, and nonzero adjustments separately from the output.

## Navigate and show controls

Switching tabs preserves edits and results without merging. Use Left/Right arrows between focused tabs, or Home/End for the first/last tab. Hover or focus filter buttons for matching-option descriptions.

**Hide controls** collapses tab content while keeping tabs, merge actions, and status visible; **Show controls** reopens it. The vertical-arrow button shows only the logs and copy controls; press it again to restore the previous view.

Switching tabs preserves the collapsed state. Dropping files in the expanded log view returns to Sources; a drop on a collapsed Sources tab opens it, while drops on other normal-view tabs retain that tab.

## Browser text filter

In **Search / Filter**, **Filter logs** searches original text, including timestamps, and excludes generated filename prefixes. The default is a case-insensitive literal search; spaces are significant. Options can be combined:

| Option | Behavior |
| --- | --- |
| `Aa` — Match case | Distinguish uppercase and lowercase |
| Underlined `ab` — Match whole word | Require boundaries around the complete match |
| `.*` — Regular expression | Use a JavaScript Unicode regex, such as `error\|warning` or `status=[45][0-9]{2}`, without `/` delimiters |
| Invert match | Keep nonmatching lines, like `grep -v` |

Filtering evaluates each physical line independently. It can retain a stack-trace line without its timestamp, or omit part of an entry. Retained lines keep their chronological position and source identity. Regex anchors `^` and `$` apply per line; patterns cannot span lines.

Whole-word boundaries treat Unicode letters, combining marks, numbers, and underscores as word characters. Searching for whole-word `error` matches `error-handler`, but excludes `errors` and `_error`. In regex mode, boundaries surround the complete regex match.

The preview highlights nonoverlapping matches. Empty queries, inverted results, and zero-width matches have no visible highlights. **Clear** restores all lines while retaining matching options; an empty query shows everything even with inversion enabled. Source diagnostics describe the original inputs; result counts describe the filtered output.

Invalid regexes clear the preview and show an error. Matching that takes about five seconds is stopped. Correct, simplify, or clear the query to recover without reselecting files. Filtering is available only in the browser.

## Copy and download

**Copy** and **Download** export all retained lines as plain text, including lines outside the visible preview. Both honor filtering, ordering, and **No filename**, even with controls hidden. Neither adds colors or highlights; ANSI sequences already in the input remain. Clear the filter to export the complete merge. Copy reports success or clipboard errors beside its button.

Leave **Download filename** blank to use `merge--%Y%m%d.%H%M%S.log`, or enter a custom name or [filename template](formats.md#filename-templates). The preview updates as you type or open Download. Each click captures the template and current local time; subsequent edits affect later downloads.

### When export is unavailable

Resolve selected-file errors, apply pending settings, and wait for processing to finish. There must be at least one retained line: empty selections, empty files, and filters with no results cannot be exported. Excluded-file errors do not block export. Invalid filters block both actions; an invalid filename template blocks Download.

For shared rules, see [entry ordering and output](formats.md#entry-ordering-and-output).
