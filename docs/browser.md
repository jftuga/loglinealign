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

### Search off-screen results with browser Find

Select **Enable browser Find across all results** in **Merge Settings** to use your browser's Ctrl+F / Cmd+F across every retained result line, including displayed filename prefixes. The option is off by default and applies immediately without Remerge. Wait for **Browser Find ready** before searching; matches are incomplete while the full view is being prepared.

The full view preserves source colors, filter highlights, and ordering. Active filters still exclude lines from browser Find. Unlike **Filter logs**, browser Find navigates matches without removing their surrounding lines, and can also match other visible page text.

More than 50,000 retained lines or 10 MB of retained UTF-8 output (including displayed prefixes and line breaks) triggers a warning with **Continue** and **Cancel**. These are advisory thresholds, not hard limits or estimates of browser memory use. Filtering or remerging checks the new result again. Filename changes rebuild the view and can require confirmation if the output grows beyond the previously approved size. Large results may slow the tab or exhaust memory.

Preparation runs in batches with progress and a **Cancel** button. Cancel, or uncheck the option, to return to the lightweight preview and release the extra page elements. The warning and progress controls remain available with the controls hidden or results expanded. Copy and Download still export all retained lines while the view is being prepared. Changing filters, order, or filenames rebuilds the searchable view and may reset an active browser Find selection. Like the other Merge Settings checkboxes, the setting is remembered in browser storage and restored when the page opens; see [Field history and saved profiles](#field-history-and-saved-profiles).

## Field history and saved profiles

All of this data lives in the browser's local storage for this page, on this device only. Log contents are never stored. Private windows or browser settings can disable or discard it; the page works the same without it.

### Recent values

These fields remember their five most recent values: **Format override**, **File timezone**, **Time adjustment**, **Fallback timezone**, **Download filename**, and each **Filter logs** field. Each field type has one history, shared by all files or all filter fields. A value is recorded when you leave the field or press Enter, and only if it is nonblank and valid. A `+00:00` adjustment is not recorded, and neither are values set with **Earlier**, **Later**, or **Reset**. Format overrides keep their literal leading and trailing spaces.

Typing in a field lists the remembered values that contain the typed text, ignoring case. ArrowDown lists all of them. Use ArrowUp/ArrowDown and Enter, or click, to choose a value; Escape closes the list. Choosing a value works the same as typing it, so format and timezone changes still wait for **Remerge**. **Clear history**, always the last entry, forgets that field type's values.

A filter history entry stores the text along with its **Match case**, **Match whole word**, **Regular expression**, and **Invert match** options. It is recorded when focus leaves the filter's row, so options toggled after typing are included. The list shows the enabled options in brackets, and choosing an entry restores all of them.

The **Merge Settings** checkboxes are remembered whenever they change and restored when the page opens.

### Save / Load

The **Save / Load** tab stores named profiles. A profile contains:

- Each loaded file's include state, Format override, File timezone, and Time adjustment, keyed by filename
- Fallback timezone
- Every filter field, including its options
- The Merge Settings checkboxes
- Download filename

Enter a name and select **Save**. Saving under an existing name asks before replacing it. To restore a profile, select it under **Saved profiles** and choose **Load**: every setting is applied, and loaded files are remerged. Each saved file setting applies to one loaded file with the same name, matched in order when names repeat. Saved settings for files that are not loaded apply when a file with that name is added later in the session.

After a load, **Expected files** lists every saved filename as **Loaded** or **Missing**, with a count, and updates as you add or remove files. Removing a matched file marks it missing again; adding it back reapplies its saved settings. The page cannot open files by name or path, so add missing files with **Choose files** in **Sources** or by dropping them anywhere on the page; you can add all of them at once. The list stays until another profile is loaded or the page is reloaded. **Delete** removes the selected profile after confirmation.

**Clear all** deletes every saved profile, field history, and remembered Merge Settings value for LogLineAlign after confirmation. Current page settings stay until you reload. It removes only this page's keys; storage that other local pages share in the same browser is left alone.

## Navigate and show controls

Switching tabs preserves edits and results without merging. Use Left/Right arrows between focused tabs, or Home/End for the first/last tab. Hover or focus filter buttons for matching-option descriptions.

**Hide controls** collapses tab content while keeping tabs, merge actions, and status visible; **Show controls** reopens it. The vertical-arrow button shows only the logs and copy controls; press it again to restore the previous view.

Switching tabs preserves the collapsed state. Dropping files in the expanded log view returns to Sources; a drop on a collapsed Sources tab opens it, while drops on other normal-view tabs retain that tab.

## Browser text filter

In **Search / Filter**, **Filter logs** searches original text, including timestamps, and excludes generated filename prefixes. Use the small **Add filter** icon to add up to three fields. Filters apply in order: the second searches only lines retained by the first, and the third searches only lines retained by both earlier filters. Each field has its own options and a color swatch matching its preview highlights. The add icon is disabled at the limit. The trashcan removes a field and immediately reapplies the remaining filters; deleting the last field resets its text and options while keeping it visible.

The default is a case-insensitive literal search; spaces are significant. Each filter independently supports these options, which can be combined:

| Option | Behavior |
| --- | --- |
| `Aa` — Match case | Distinguish uppercase and lowercase |
| Underlined `ab` — Match whole word | Require boundaries around the complete match |
| `.*` — Regular expression | Use a JavaScript Unicode regex, such as `error\|warning` or `status=[45][0-9]{2}`, without `/` delimiters |
| Invert match | Keep nonmatching lines, like `grep -v` |

Filtering evaluates each physical line independently. It can retain a stack-trace line without its timestamp, or omit part of an entry. Retained lines keep their chronological position and source identity. Regex anchors `^` and `$` apply per line; patterns cannot span lines.

Whole-word boundaries treat Unicode letters, combining marks, numbers, and underscores as word characters. Searching for whole-word `error` matches `error-handler`, but excludes `errors` and `_error`. In regex mode, boundaries surround the complete regex match.

The preview highlights each filter’s matches in a different color: yellow, blue, and pink. Overlapping matches use a split background showing all contributing colors. Empty queries, inverted filters, and zero-width matches add no visible highlights; other filters still highlight their matches. **Clear** empties only that field while retaining its options. An empty field has no effect, even with inversion enabled; clear every field to restore all lines. Source diagnostics describe the original inputs; result counts describe the filtered output.

Invalid regexes clear the preview, identify the filter in the error, and mark its field. Matching that takes about five seconds is stopped. Correct, simplify, or clear the query to recover without reselecting files. Filtering is available only in the browser.

## Copy and download

**Copy** and **Download** export all retained lines as plain text, including lines outside the visible preview. Both honor filtering, ordering, and **No filename**, even with controls hidden. Neither adds colors or highlights; ANSI sequences already in the input remain. Clear all filters to export the complete merge. Copy reports success or clipboard errors beside its button.

Leave **Download filename** blank to use `merge--%Y%m%d.%H%M%S.log`, or enter a custom name or [filename template](formats.md#filename-templates). The preview updates as you type or open Download. Each click captures the template and current local time; subsequent edits affect later downloads.

### When export is unavailable

Resolve selected-file errors, apply pending settings, and wait for processing to finish. There must be at least one retained line: empty selections, empty files, and filters with no results cannot be exported. Excluded-file errors do not block export. Invalid filters block both actions; an invalid filename template blocks Download.

For shared rules, see [entry ordering and output](formats.md#entry-ordering-and-output).
