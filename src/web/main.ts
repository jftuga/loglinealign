/** Manage local files, controls, and virtualized or fully searchable results. The embedded worker owns parsing, cached entries, ordering, filtering, and download generation. */
import { sourceColor } from '../core/colors';
import { sourceLabels } from '../core/format';
import { describeTimezone } from '../core/timezone';
import { formatTimeShift, parseTimeShift } from '../core/time_adjustment';
import { defaultFilenameTemplate, expandFilenameTemplate, validateFilenameTemplate } from '../core/filename_template';
import { createTimestampParser } from '../core/timestamp';
import { fallbackTimezone } from '../core/timezone';
import { element } from './dom';
import { filterColor } from './filter';
import { createFilterControls } from './filter_controls';
import { renderExpectedFiles } from './expected_files';
import { acceptValid, attachTextHistory } from './history_input';
import { trashIcon } from './icons';
import type { Profile, ProfileSettings, SavedSource } from './profiles';
import { applyCheckboxStates, checkboxStates, rememberCheckboxes, restoreCheckboxes } from './remembered_checks';
import { createSaveLoadControls } from './save_load_controls';
import { createTimeControls } from './time_controls';
import { initializeFileDrop } from './file_drop';
import type { FileReport, WebSource, WorkerRequest, WorkerResponse } from './protocol';

declare const __VERSION__: string;
declare const __REPOSITORY__: string;
declare const __WORKER_CODE__: string;

const picker = element<HTMLInputElement>('file-picker');
const timezone = element<HTMLInputElement>('timezone');
const reverse = element<HTMLInputElement>('reverse');
const noFilename = element<HTMLInputElement>('no-filename');
const color = element<HTMLInputElement>('color');
const verbose = element<HTMLInputElement>('verbose');
const browserFind = element<HTMLInputElement>('browser-find');
const mergeChecks = [reverse, noFilename, color, verbose, browserFind];
const findPanel = element('browser-find-panel');
const findStatus = element('browser-find-status');
const findContinue = element<HTMLButtonElement>('browser-find-continue');
const findCancel = element<HTMLButtonElement>('browser-find-cancel');
const download = element<HTMLButtonElement>('download');
const copy = element<HTMLButtonElement>('copy');
const copyStatus = element<HTMLSpanElement>('copy-status');
const downloadName = element<HTMLInputElement>('download-name');
const downloadPreview = element<HTMLParagraphElement>('download-preview');
const viewport = element<HTMLDivElement>('viewport');
const rows = element<HTMLDivElement>('rows');
const spacer = element<HTMLDivElement>('spacer');
const status = element<HTMLParagraphElement>('status');
const errors = element<HTMLPreElement>('errors');
const warnings = element<HTMLDivElement>('warnings');
const warningText = element<HTMLSpanElement>('warning-text');
let filters: ReturnType<typeof createFilterControls>;
const filterError = element<HTMLParagraphElement>('filter-error');
const tabs = ['sources-tab', 'filter-tab', 'settings-tab', 'download-tab', 'profiles-tab', 'help-tab'].map(id => element<HTMLButtonElement>(id));
const sources: WebSource[] = [];
const names: string[] = [];
const reports = new Map<number, FileReport>();
const appliedSettings = new Map<number, Pick<WebSource, 'format' | 'timezone' | 'timeShift'>>();
// Per-file settings from the last loaded profile, each matched to at most one loaded source.
let expectedProfile = '';
let expectedFiles: { saved: SavedSource; sourceId?: number }[] = [];
let appliedTimezone = '';
let revision = 0;
let viewRequest = 0;
let total = 0;
let pending = false;
let busy = false;
let downloading = false;
let copyRequest = 0;
let pendingCopy: { request: number; resolve: (blob: Blob) => void; reject: (error: Error) => void } | undefined;
let frame = 0;
let worker: Worker;
let downloadPresentation = true;
let downloadFilename = '';
let invalidFilename = false;
let filterRevision = 0;
let filtering = false;
let filterInFlight = false;
let viewInFlight = false;
let lastSentView = 0;
let filterDelay: number | undefined;
let filterWatchdog: number | undefined;
let mergedReady = false;
let mergedTotal = 0;
let mergedEntries = 0;
let mergeDuration = 0;
let textBytes = 0;
let filenameBytes = 0;
let findMode: 'virtual' | 'confirm' | 'loading' | 'ready' = 'virtual';
let loadedRows = 0;
let findTimer: number | undefined;
let findScrollTop = 0;
// Approval covers this result only; presentation changes need approval again only if larger.
let approvedFindBytes = -1;
const rowHeight = 22;
const maxHeight = 8000000;

function send(message: WorkerRequest): void { worker.postMessage(message); }

/** Set one global visibility state for tab content, retaining navigation, merge actions, and status. */
function setControlsCollapsed(collapsed: boolean): void {
  const scrollTop = viewport.scrollTop;
  const content = element('tool-content');
  const result = element('result');
  if (collapsed && !content.hidden) result.style.setProperty('--control-space', `${content.getBoundingClientRect().height}px`);
  content.hidden = collapsed;
  result.classList.toggle('controls-collapsed', collapsed);
  element('collapse-controls').setAttribute('aria-expanded', String(!collapsed));
  element('collapse-icon').textContent = collapsed ? '▸' : '▾';
  element('collapse-label').textContent = collapsed ? 'Show controls' : 'Hide controls';
  viewport.scrollTop = scrollTop;
  scheduleView();
}

/** Keep preview-only mode independent of the selected tab and collapse state. */
function setVerticalExpanded(expanded: boolean): void {
  const scrollTop = viewport.scrollTop;
  document.body.classList.toggle('expanded-vertical', expanded);
  const button = element<HTMLButtonElement>('expand-vertical');
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-label', expanded ? 'Restore normal results height' : 'Expand results to full window height');
  button.title = expanded ? 'Restore normal results height' : 'Expand results vertically';
  viewport.scrollTop = scrollTop;
  element('result').scrollIntoView({ block: 'start' });
  scheduleView();
}

/** Reveal new sources after a drop in Sources or preview-only mode. */
function receiveDroppedFiles(files: FileList): void {
  const expanded = document.body.classList.contains('expanded-vertical');
  if (expanded) setVerticalExpanded(false);
  const sourcesTab = element<HTMLButtonElement>('sources-tab');
  if (expanded || sourcesTab.getAttribute('aria-selected') === 'true') {
    selectTab(sourcesTab);
    setControlsCollapsed(false);
    if (expanded) sourcesTab.focus({ preventScroll: true });
  }
  addFiles(files);
}

/** Change the visible controls without rebuilding them or altering the current merge. */
function selectTab(selected: HTMLButtonElement): void {
  const scrollTop = viewport.scrollTop;
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    element(tab.getAttribute('aria-controls')!).hidden = !active;
  }
  element('remerge-sources').hidden = selected.id !== 'sources-tab';
  element('remerge').hidden = selected.id !== 'settings-tab';
  if (selected.id === 'download-tab') updateFilenamePreview();
  selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  viewport.scrollTop = scrollTop;
  scheduleView();
}

/** Use automatic tab activation for arrow keys, Home, and End. */
function navigateTabs(event: KeyboardEvent): void {
  const index = tabs.indexOf(event.currentTarget as HTMLButtonElement);
  let next: number;
  switch (event.key) {
    case 'ArrowRight': next = (index + 1) % tabs.length; break;
    case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
    case 'Home': next = 0; break;
    case 'End': next = tabs.length - 1; break;
    default: return;
  }
  event.preventDefault();
  const tab = tabs[next]!;
  selectTab(tab);
  tab.focus({ preventScroll: true });
}

function updateDownload(): void {
  const unavailable = !total || pending || busy || filtering || !errors.hidden || !filterError.hidden;
  download.disabled = unavailable || downloading || invalidFilename;
  copy.disabled = unavailable || pendingCopy !== undefined;
}

/** Cancel clipboard preparation when the output changes or its worker is stopped. */
function cancelCopy(): void {
  copyRequest++;
  pendingCopy?.reject(new Error('The merged output changed. Click Copy again.'));
  pendingCopy = undefined;
  copyStatus.textContent = '';
}

/** Start the clipboard write during the click, then supply all output from the worker. */
async function copyOutput(): Promise<void> {
  if (copy.disabled) return;
  const request = ++copyRequest;
  copyStatus.textContent = 'Copying…';
  try {
    if (!navigator.clipboard) throw new Error('Clipboard access is unavailable. Use Download instead.');
    const blob = new Promise<Blob>((resolve, reject) => { pendingCopy = { request, resolve, reject }; });
    // A promise-backed ClipboardItem preserves user activation while the worker prepares large results.
    // Handle cancellation even if the clipboard API rejects before consuming that promise.
    void blob.catch(() => {});
    updateDownload();
    send({ type: 'copy', revision, filterRevision, request, filename: !noFilename.checked });
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    } else {
      await navigator.clipboard.writeText(await (await blob).text());
    }
    if (pendingCopy?.request === request) copyStatus.textContent = 'Copied!';
  } catch (error) {
    if (request === copyRequest) {
      copyStatus.textContent = `Copy failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    if (pendingCopy?.request === request) {
      pendingCopy.reject(new Error('Clipboard operation finished.'));
      pendingCopy = undefined;
    }
    updateDownload();
  }
}

function showFilterError(message = ''): void {
  filterError.hidden = !message;
  filterError.textContent = message;
}

function cancelFilter(): void {
  window.clearTimeout(filterDelay);
  window.clearTimeout(filterWatchdog);
  filterDelay = undefined;
  filterWatchdog = undefined;
  if (filterInFlight || viewInFlight) {
    worker.terminate();
    worker = createWorker();
    mergedReady = false;
  }
  filterInFlight = false;
  viewInFlight = false;
  filtering = false;
}

function watchFilter(): void {
  if (filterWatchdog !== undefined) return;
  const watchedRevision = filterRevision;
  filterWatchdog = window.setTimeout(() => {
    cancelFilter();
    downloading = false;
    clearPreview();
    if (watchedRevision !== filterRevision && !pending) {
      startMerge(false);
    } else {
      showFilterError('Filtering took too long. Simplify the filter or clear it.');
      status.textContent = 'Filter stopped. Edit or clear the filter to try again.';
      updateDownload();
    }
  }, 5000);
}

function requestFilter(): void {
  filterDelay = undefined;
  if (!mergedReady || busy) return;
  try { filters.validate(); }
  catch (error) {
    showFilterError(error instanceof Error ? error.message : String(error));
    filtering = false;
    clearPreview();
    status.textContent = 'Correct the filter to view and download results.';
    return;
  }
  showFilterError();
  filtering = true;
  filterInFlight = true;
  clearPreview();
  status.textContent = 'Filtering merged logs…';
  send({ type: 'filter', revision, filterRevision, options: filters.read() });
  watchFilter();
}

function changeFilter(): void {
  filterRevision++;
  downloading = false;
  window.clearTimeout(filterDelay);
  showFilterError();
  clearPreview();
  try { filters.validate(); }
  catch (error) {
    cancelFilter();
    showFilterError(error instanceof Error ? error.message : String(error));
    if (!pending && !busy) status.textContent = 'Correct the filter to view and download results.';
    updateDownload();
    return;
  }
  if (pending || busy || !errors.hidden) return;
  if (!mergedReady) {
    if (sources.some(source => source.included)) startMerge(false);
    return;
  }
  filtering = true;
  status.textContent = 'Filtering merged logs…';
  filterDelay = window.setTimeout(requestFilter, 150);
}

function clearPreview(): void {
  cancelCopy();
  resetFindView();
  approvedFindBytes = -1;
  total = 0;
  rows.replaceChildren();
  spacer.style.height = '0px';
  element('empty').hidden = false;
  updateDownload();
}

function markPending(): void {
  warnings.hidden = true;
  cancelFilter();
  mergedReady = false;
  pending = true;
  busy = false;
  downloading = false;
  revision++;
  element('pending').hidden = false;
  status.textContent = 'Merge settings changed. Select Remerge to apply them.';
  clearPreview();
  updateReports();
}

function startMerge(useCurrentSettings = true): void {
  warnings.hidden = true;
  cancelFilter();
  mergedReady = false;
  revision++;
  busy = true;
  downloading = false;
  if (useCurrentSettings) {
    pending = false;
    appliedTimezone = timezone.value.trim();
    for (const source of sources) {
      appliedSettings.set(source.id, { format: source.format.trim() ? source.format : '', timezone: source.timezone.trim(), timeShift: source.timeShift.trim() });
    }
  }
  element('pending').hidden = !pending;
  errors.hidden = true;
  status.textContent = 'Merging selected files…';
  clearPreview();
  updateReports();
  send({ type: 'merge', revision, sources: sources.map(source => ({ ...source, ...appliedSettings.get(source.id) })), timezone: appliedTimezone, reverse: reverse.checked });
}

function addFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    const id = names.length;
    names.push(file.name);
    const source: WebSource = { id, order: id, name: file.name, label: file.name, file, included: true, format: '', timezone: '', timeShift: '+00:00' };
    applySavedSource(source);
    sources.push(source);
  }
  const labels = sourceLabels(names);
  for (const source of sources) source.label = labels[source.id]!;
  showExpectedFiles();
  renderFiles();
  startMerge();
}

/** Apply the first unmatched saved settings with the same filename; each saved entry applies to one file. */
function applySavedSource(source: WebSource): void {
  const expected = expectedFiles.find(item => item.sourceId === undefined && item.saved.name === source.name);
  if (!expected) return;
  expected.sourceId = source.id;
  const { included, format, timezone, timeShift } = expected.saved;
  Object.assign(source, { included, format, timezone, timeShift });
}

function showExpectedFiles(): void {
  renderExpectedFiles(expectedProfile, expectedFiles.map(item => ({ name: item.saved.name, loaded: item.sourceId !== undefined })));
}

function removeSource(id: number): void {
  const index = sources.findIndex(source => source.id === id);
  if (index < 0) return;
  sources.splice(index, 1);
  // A removed file is missing again; adding it back reapplies its saved settings.
  for (const item of expectedFiles) if (item.sourceId === id) item.sourceId = undefined;
  showExpectedFiles();
  reports.delete(id);
  appliedSettings.delete(id);
  renderFiles();
  startMerge();
}

function describeAppliedTime(source: WebSource, usedFallback: boolean): string {
  const settings = appliedSettings.get(source.id);
  const shift = parseTimeShift(settings?.timeShift ?? '+00:00');
  return describeTimezone(usedFallback, settings?.timezone, appliedTimezone) + (shift ? `; time adjustment ${formatTimeShift(shift)}` : '');
}

function describeReport(source: WebSource): string {
  const report = reports.get(source.id);
  const prefix = `${source.file.size.toLocaleString()} bytes · `;
  if (!source.included) return prefix + 'Excluded' + (report?.error ? ` · ${report.error}` : '');
  if (pending) return prefix + 'Merge settings pending';
  if (busy) return prefix + 'Merging…';
  if (report?.error) return report.error;
  if (!report?.diagnostics) return prefix + 'Waiting to merge';
  const d = report.diagnostics;
  const format = appliedSettings.get(source.id)?.format ? `${d.format} · ` : '';
  return `${prefix}${format}${d.entries.toLocaleString()} entries · ${d.continuations.toLocaleString()} continuation lines · ${describeAppliedTime(source, d.usedFallback)}`;
}

function updateReports(): void {
  for (const source of sources) {
    const result = reports.get(source.id);
    const detected = document.getElementById(`detected-${source.id}`);
    if (detected) {
      const automatic = !pending && !busy && source.included && !appliedSettings.get(source.id)?.format && !result?.error && result?.diagnostics?.entries;
      detected.textContent = automatic ? result.diagnostics!.format : '—';
    }
    const report = document.getElementById(`report-${source.id}`);
    if (report) {
      report.textContent = describeReport(source);
      report.classList.toggle('bad', !pending && !busy && Boolean(result?.error));
    }
  }
}

function renderFiles(): void {
  const container = element('files');
  container.replaceChildren();
  element('file-count').textContent = `(${sources.length} file${sources.length === 1 ? '' : 's'})`;
  for (const source of sources) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const heading = document.createElement('div');
    heading.className = 'file-heading';
    const label = document.createElement('label');
    const included = document.createElement('input');
    included.type = 'checkbox';
    included.checked = source.included;
    included.setAttribute('aria-label', `Include ${source.label}`);
    included.addEventListener('change', () => { source.included = included.checked; updateReports(); startMerge(); });
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = sourceColor(source.order).css;
    swatch.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = source.label;
    label.append(included, swatch, name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'trash';
    remove.setAttribute('aria-label', `Remove ${source.label}`);
    remove.title = 'Remove from this session';
    // This icon is static trusted markup; filenames and log text always use textContent.
    remove.innerHTML = trashIcon;
    remove.addEventListener('click', () => removeSource(source.id));
    heading.append(label, remove);
    const format = document.createElement('input');
    format.id = `format-${source.id}`;
    format.type = 'text';
    format.value = source.format;
    format.placeholder = 'Leave blank for automatic detection';
    format.spellcheck = false;
    format.setAttribute('aria-label', `Format override (optional) for ${source.label}`);
    format.setAttribute('aria-describedby', 'format-help');
    let copyFormatOnBlur = false;
    format.addEventListener('input', () => {
      // Remember the blank starting state while the user types the full override.
      if (source === sources[0] && sources.every(item => !item.format.trim())) copyFormatOnBlur = true;
      source.format = format.value;
      markPending();
    });
    format.addEventListener('blur', () => {
      const shouldCopy = copyFormatOnBlur;
      copyFormatOnBlur = false;
      if (!shouldCopy || source !== sources[0] || !source.format.trim()) return;
      const remaining = sources.slice(1);
      if (!remaining.length || remaining.some(item => item.format.trim())) return;
      for (const item of remaining) {
        item.format = source.format;
        element<HTMLInputElement>(`format-${item.id}`).value = source.format;
      }
      markPending();
    });
    const formatLabel = document.createElement('label');
    formatLabel.className = 'format-label';
    formatLabel.htmlFor = format.id;
    formatLabel.textContent = 'Format override (optional)';
    const detected = document.createElement('output');
    detected.id = `detected-${source.id}`;
    detected.className = 'detected-format';
    detected.setAttribute('aria-label', `Detected format for ${source.label}`);
    const detectedLabel = document.createElement('label');
    detectedLabel.className = 'format-label';
    detectedLabel.htmlFor = detected.id;
    detectedLabel.textContent = 'Detected format';
    const report = document.createElement('div');
    report.id = `report-${source.id}`;
    report.className = 'file-report';
    const fields = document.createElement('div');
    fields.className = 'file-fields';
    const formatControls = document.createElement('div');
    formatControls.className = 'format-controls';
    formatControls.append(formatLabel, format, detectedLabel, detected);
    // Overrides keep literal leading and trailing spaces, so remember them untrimmed.
    attachTextHistory(format, 'format', 'Recent format overrides', value => acceptValid(value, override => createTimestampParser(override, undefined)));
    fields.append(formatControls, createTimeControls(source, markPending));
    row.append(heading, fields, report);
    container.append(row);
  }
  if (!sources.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Add files to build your timeline.';
    container.append(empty);
  }
  updateReports();
}

function viewportStart(): number {
  const visible = Math.max(1, Math.floor(viewport.clientHeight / rowHeight));
  const height = Math.min(total * rowHeight, maxHeight);
  const scrollable = Math.max(1, height - viewport.clientHeight);
  return Math.max(0, Math.min(total - visible, Math.floor(viewport.scrollTop / scrollable * Math.max(0, total - visible))));
}

function requestView(): void {
  frame = 0;
  if (!total || busy || filtering || findMode === 'loading' || findMode === 'ready') return;
  const start = viewportStart();
  viewInFlight = true;
  lastSentView = ++viewRequest;
  send({ type: 'view', revision, filterRevision, request: lastSentView, start, count: Math.ceil(viewport.clientHeight / rowHeight) + 2, filename: !noFilename.checked });
  watchFilter();
}

function scheduleView(): void {
  if (!frame) frame = requestAnimationFrame(requestView);
}

/** Invalidate queued batches before changing results, presentation, or rendering mode. */
function resetFindView(): void {
  window.clearTimeout(findTimer);
  findTimer = undefined;
  viewRequest++;
  // An obsolete batch can still be evaluating a regex. Keep its watchdog until
  // the worker replies (or cancelFilter terminates it), even though it cannot render.
  findMode = 'virtual';
  loadedRows = 0;
  findPanel.hidden = true;
  viewport.classList.remove('full-results');
  viewport.removeAttribute('aria-busy');
}

function requestFindBatch(): void {
  findTimer = undefined;
  if (findMode !== 'loading') return;
  viewInFlight = true;
  lastSentView = ++viewRequest;
  send({ type: 'view', revision, filterRevision, request: lastSentView, start: loadedRows, count: 500, filename: !noFilename.checked });
  watchFilter();
}

function beginFindView(): void {
  // Preserve the logical row when leaving the scaled virtual scrollbar.
  findScrollTop = viewportStart() * rowHeight;
  resetFindView();
  findMode = 'loading';
  findPanel.hidden = false;
  findPanel.dataset.state = findMode;
  findContinue.hidden = true;
  findCancel.hidden = false;
  findStatus.textContent = `Preparing browser Find: 0 of ${total.toLocaleString()} lines. Search is incomplete until ready.`;
  rows.replaceChildren();
  rows.style.top = '0px';
  spacer.style.height = 'auto';
  viewport.classList.add('full-results');
  viewport.setAttribute('aria-busy', 'true');
  requestFindBatch();
}

/** Choose a full document or the bounded preview without reparsing or refiltering. */
function refreshView(): void {
  const start = findMode === 'loading' || findMode === 'ready' ? Math.floor(viewport.scrollTop / rowHeight) : viewportStart();
  resetFindView();
  rows.replaceChildren();
  const height = Math.min(total * rowHeight, maxHeight);
  spacer.style.height = `${height}px`;
  const visible = Math.max(1, Math.floor(viewport.clientHeight / rowHeight));
  viewport.scrollTop = start / Math.max(1, total - visible) * Math.max(0, height - viewport.clientHeight);
  if (browserFind.checked && total && !busy && !filtering) {
    const bytes = textBytes + (noFilename.checked ? 0 : filenameBytes);
    if ((total > 50000 || bytes > 10000000) && bytes > approvedFindBytes) {
      findMode = 'confirm';
      findPanel.hidden = false;
      findPanel.dataset.state = findMode;
      findContinue.hidden = false;
      findCancel.hidden = false;
      findStatus.textContent = `${total.toLocaleString()} retained lines (${(bytes / 1000000).toFixed(1)} MB). Making these results searchable may use substantial memory and slow this tab. Continue?`;
    } else {
      beginFindView();
      return;
    }
  }
  scheduleView();
}

function disableFindView(): void {
  const restoreFocus = findPanel.contains(document.activeElement);
  browserFind.checked = false;
  approvedFindBytes = -1;
  refreshView();
  if (restoreFocus) viewport.focus({ preventScroll: true });
}

function renderRows(message: Extract<WorkerResponse, { type: 'view' }>): void {
  const fragment = document.createDocumentFragment();
  for (const row of message.rows) {
    const line = document.createElement('div');
    line.className = 'log-row';
    let position = 0;
    for (const { start, end, filters: matchedFilters } of row.matches) {
      line.append(document.createTextNode(row.text.slice(position, start)));
      const mark = document.createElement('mark');
      mark.textContent = row.text.slice(start, end);
      const colors = matchedFilters.map(filterColor);
      mark.style.background = colors.length === 1 ? colors[0]! : `linear-gradient(to bottom, ${colors.map((color, index) => `${color} ${index * 100 / colors.length}% ${(index + 1) * 100 / colors.length}%`).join(', ')})`;
      mark.title = `Matched filters: ${matchedFilters.map(index => index + 1).join(', ')}`;
      line.append(mark);
      position = end;
    }
    line.append(document.createTextNode(row.text.slice(position)));
    line.dataset.order = String(row.order);
    line.style.setProperty('--source-color', sourceColor(row.order).css);
    fragment.append(line);
  }
  if (findMode === 'loading') {
    if (message.start !== loadedRows) return;
    const block = document.createElement('div');
    block.className = 'log-block';
    block.append(fragment);
    rows.append(block);
    loadedRows += message.rows.length;
    if (loadedRows >= total) {
      findMode = 'ready';
      findPanel.dataset.state = findMode;
      viewport.removeAttribute('aria-busy');
      viewport.scrollTop = findScrollTop;
      findStatus.textContent = `Browser Find ready: all ${total.toLocaleString()} retained lines are searchable with Ctrl+F / Cmd+F.`;
      if (document.activeElement === findCancel) viewport.focus({ preventScroll: true });
      findCancel.hidden = true;
    } else {
      findStatus.textContent = `Preparing browser Find: ${loadedRows.toLocaleString()} of ${total.toLocaleString()} lines. Search is incomplete until ready.`;
      // A task boundary lets input, cancellation, and paint run between batches.
      findTimer = window.setTimeout(requestFindBatch, 0);
    }
  } else {
    rows.style.top = `${viewport.scrollTop}px`;
    rows.replaceChildren(fragment);
  }
}

function updateFilenamePreview(): string | undefined {
  let filename: string | undefined;
  try {
    filename = expandFilenameTemplate(downloadName.value.trim() || defaultFilenameTemplate, new Date());
    downloadPreview.textContent = `Saves as: ${filename}`;
    invalidFilename = false;
  } catch (error) {
    downloadPreview.textContent = error instanceof Error ? error.message : String(error);
    invalidFilename = true;
  }
  downloadName.setAttribute('aria-invalid', String(invalidFilename));
  downloadPreview.classList.toggle('bad', invalidFilename);
  updateDownload();
  return filename;
}

function saveDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function receive(event: MessageEvent<WorkerResponse>): void {
  const message = event.data;
  if (message.revision !== revision) return;
  if (message.type === 'merged') {
    busy = false;
    warningText.textContent = message.warning ? `Warning: ${message.warning}` : '';
    warnings.hidden = pending || !message.warning;
    for (const report of message.reports) reports.set(report.id, report);
    updateReports();
    mergedTotal = message.total;
    mergedEntries = message.entries;
    mergeDuration = message.durationMs;
    mergedReady = !message.errors.length;
    errors.hidden = !message.errors.length;
    errors.textContent = message.errors.join('\n');
    status.textContent = message.errors.length ? 'Resolve the selected file errors to merge and download.' : pending ? 'Merge settings pending. Select Remerge to apply them.' : 'Preparing preview…';
    element('diagnostics').textContent = message.reports.map(report => {
      const source = sources.find(item => item.id === report.id)!;
      const d = report.diagnostics;
      return `${source.label}: ${report.size} bytes; ${report.error ?? (d ? `${d.format}; ${d.entries} entries; ${d.continuations} continuation lines (${d.leading} leading); ${describeAppliedTime(source, d.usedFallback)}; ${d.durationMs.toFixed(1)} ms parse; ${report.cached ? 'cached' : 'parsed'}` : 'empty')}`;
    }).join('\n') + `\n${message.entries} entries; ${reverse.checked ? 'descending' : 'ascending'}; merge ${message.durationMs.toFixed(1)} ms`;
    updateDownload();
    if (mergedReady) requestFilter();
  } else if (message.type === 'filtered') {
    window.clearTimeout(filterWatchdog);
    filterWatchdog = undefined;
    if (message.filterRevision !== filterRevision) {
      if (filterInFlight) watchFilter();
      return;
    }
    filterInFlight = false;
    viewInFlight = false;
    filtering = false;
    showFilterError(message.error);
    total = message.total;
    textBytes = message.textBytes;
    filenameBytes = message.filenameBytes;
    spacer.style.height = `${Math.min(total * rowHeight, maxHeight)}px`;
    viewport.scrollTop = 0;
    element('empty').hidden = Boolean(total);
    const activeFilters = filters.read().filter(filter => filter.text !== '');
    const filtered = activeFilters.length > 0;
    const summary = filtered ? `${total.toLocaleString()} of ${mergedTotal.toLocaleString()} lines · ${message.entries.toLocaleString()} of ${mergedEntries.toLocaleString()} entries` : `${total.toLocaleString()} lines · ${mergedEntries.toLocaleString()} entries`;
    const noMatches = 'No lines match all filters';
    status.textContent = message.error ? 'Correct the filter to view and download results.' : !sources.some(source => source.included) ? 'No files selected.' : !mergedTotal ? 'Selected files are empty.' : !total ? `${noMatches} (${mergedTotal.toLocaleString()} lines searched).` : `${summary}${filtered ? ` · ${activeFilters.length} active filter${activeFilters.length === 1 ? '' : 's'}` : ''} · ${reverse.checked ? 'newest first' : 'oldest first'} · ${(mergeDuration + message.durationMs).toFixed(0)} ms${pending ? ' · merge settings pending' : ''}`;
    const empty = element('empty');
    if (!total && mergedTotal && filtered) {
      empty.textContent = message.error ? 'Correct the filter to show results.' : `${noMatches}. Change or clear the filters.`;
    } else {
      empty.textContent = 'Your merged logs will appear here.';
    }
    download.textContent = filtered ? 'Download filtered .log' : 'Download .log';
    updateDownload();
    refreshView();
  } else if (message.type === 'view') {
    if (message.request === lastSentView) {
      viewInFlight = false;
      if (!filterInFlight) { window.clearTimeout(filterWatchdog); filterWatchdog = undefined; }
    }
    if (message.filterRevision === filterRevision && message.request === viewRequest) {
      renderRows(message);
    }
  } else if (message.type === 'download') {
    if (message.filterRevision !== filterRevision) return;
    downloading = false;
    if (!pending && !busy && !filtering && filterError.hidden && downloadPresentation === !noFilename.checked) saveDownload(message.blob, downloadFilename);
    updateDownload();
  } else if (message.type === 'copy') {
    if (message.filterRevision === filterRevision && pendingCopy?.request === message.request) pendingCopy.resolve(message.blob);
  } else {
    warnings.hidden = true;
    cancelFilter();
    mergedReady = false;
    busy = false;
    downloading = false;
    reports.clear();
    updateReports();
    errors.hidden = false;
    errors.textContent = message.message;
    status.textContent = 'Merge failed. Check your settings and try again.';
    clearPreview();
  }
}

/** Apply checkbox settings that change presentation without a merge or view rebuild. */
function showPresentation(): void {
  viewport.classList.toggle('source-colors', color.checked);
  element('diagnostic-panel').hidden = !verbose.checked;
}

function captureProfile(): ProfileSettings {
  return {
    sources: sources.map(({ name, included, format, timezone, timeShift }) => ({ name, included, format, timezone, timeShift })),
    timezone: timezone.value,
    checks: checkboxStates(mergeChecks),
    filters: filters.read(),
    downloadName: downloadName.value,
  };
}

/** Apply every saved setting, list the files it expects, and remerge loaded files. */
function applyProfile(name: string, profile: Profile): string {
  expectedProfile = name;
  expectedFiles = profile.sources.map(saved => ({ saved }));
  for (const source of sources) applySavedSource(source);
  showExpectedFiles();
  timezone.value = profile.timezone;
  applyCheckboxStates(mergeChecks, profile.checks);
  rememberCheckboxes(mergeChecks);
  showPresentation();
  downloadName.value = profile.downloadName;
  updateFilenamePreview();
  renderFiles();
  // Merge first: the filter change then waits for this merge instead of starting one with old settings.
  if (sources.length) startMerge();
  filters.write(profile.filters);
  return `Loaded "${name}".`;
}

/** Shows or hides the panel a disclosure button controls and returns the new expanded state. */
function setDisclosure(button: HTMLButtonElement, expanded: boolean): boolean {
  button.setAttribute('aria-expanded', String(expanded));
  element(button.getAttribute('aria-controls')!).hidden = !expanded;
  return expanded;
}

function createWorker(): Worker {
  const url = URL.createObjectURL(new Blob([__WORKER_CODE__], { type: 'text/javascript' }));
  const instance = new Worker(url);
  URL.revokeObjectURL(url);
  instance.onmessage = (event: MessageEvent<WorkerResponse>): void => { if (instance === worker) receive(event); };
  instance.onerror = (): void => {
    if (instance !== worker) return;
    warnings.hidden = true;
    busy = false;
    filtering = false;
    filterInFlight = false;
    viewInFlight = false;
    mergedReady = false;
    window.clearTimeout(filterWatchdog);
    filterWatchdog = undefined;
    reports.clear();
    updateReports();
    errors.hidden = false;
    errors.textContent = 'The background worker failed. Reload this page in a browser that supports local Blob workers.';
    clearPreview();
  };
  return instance;
}

function initialize(): void {
  const repository = element<HTMLAnchorElement>('repository');
  repository.href = __REPOSITORY__;
  repository.textContent = `loglinealign v${__VERSION__} · GitHub`;
  // Color each wordmark part like the first loaded sources so the title previews the palette order.
  for (const [order, part] of [...element('wordmark').children].entries()) (part as HTMLElement).style.color = sourceColor(order).css;
  const aboutToggle = element<HTMLButtonElement>('about-toggle');
  aboutToggle.addEventListener('click', () => {
    const expanded = setDisclosure(aboutToggle, aboutToggle.getAttribute('aria-expanded') !== 'true');
    aboutToggle.textContent = expanded ? 'Hide' : 'What is this?';
  });
  const disclaimerToggle = element<HTMLButtonElement>('disclaimer-toggle');
  disclaimerToggle.addEventListener('click', () => setDisclosure(disclaimerToggle, disclaimerToggle.getAttribute('aria-expanded') !== 'true'));
  // The disclaimer overlays the page, so dismiss it like a popover: Escape or any click outside it.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !element('disclaimer').hidden) { setDisclosure(disclaimerToggle, false); disclaimerToggle.focus(); }
  });
  document.addEventListener('click', event => {
    if (!element('identity-links').contains(event.target as Node)) setDisclosure(disclaimerToggle, false);
  });
  restoreCheckboxes(mergeChecks);
  for (const check of mergeChecks) check.addEventListener('change', () => rememberCheckboxes(mergeChecks));
  worker = createWorker();
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', navigateTabs);
  }
  element('collapse-controls').addEventListener('click', () => setControlsCollapsed(!element('tool-content').hidden));
  document.querySelector<HTMLAnchorElement>('a[href="#timezone"]')!.addEventListener('click', event => {
    event.preventDefault();
    selectTab(element<HTMLButtonElement>('settings-tab'));
    timezone.focus();
  });
  element('dismiss-warning').addEventListener('click', () => { warnings.hidden = true; viewport.focus({ preventScroll: true }); });
  filters = createFilterControls(element('filter-list'), element<HTMLTemplateElement>('filter-template'), element<HTMLButtonElement>('filter-add'), element('filter-count'), changeFilter);
  picker.addEventListener('change', () => { if (picker.files?.length) addFiles(picker.files); picker.value = ''; });
  initializeFileDrop(element('drop-overlay'), receiveDroppedFiles);
  timezone.addEventListener('input', markPending);
  attachTextHistory(timezone, 'fallback-timezone', 'Recent fallback timezones', value => acceptValid(value.trim(), fallbackTimezone));
  for (const id of ['remerge', 'remerge-sources']) {
    element(id).addEventListener('click', () => startMerge());
  }
  reverse.addEventListener('change', () => startMerge(false));
  noFilename.addEventListener('change', () => { cancelCopy(); updateDownload(); refreshView(); });
  browserFind.addEventListener('change', () => { approvedFindBytes = -1; refreshView(); });
  findContinue.addEventListener('click', () => {
    if (findMode !== 'confirm') return;
    approvedFindBytes = textBytes + (noFilename.checked ? 0 : filenameBytes);
    findCancel.focus({ preventScroll: true });
    beginFindView();
  });
  findCancel.addEventListener('click', disableFindView);
  showPresentation();
  color.addEventListener('change', showPresentation);
  verbose.addEventListener('change', showPresentation);
  element('expand-vertical').addEventListener('click', () => {
    setVerticalExpanded(!document.body.classList.contains('expanded-vertical'));
  });
  viewport.addEventListener('scroll', scheduleView, { passive: true });
  new ResizeObserver(scheduleView).observe(viewport);
  downloadName.addEventListener('input', updateFilenamePreview);
  attachTextHistory(downloadName, 'download-name', 'Recent download filenames', value => acceptValid(value.trim(), validateFilenameTemplate));
  createSaveLoadControls(captureProfile, applyProfile);
  copy.addEventListener('click', copyOutput);
  updateFilenamePreview();
  download.addEventListener('click', () => {
    if (download.disabled) return;
    const filename = updateFilenamePreview();
    if (filename === undefined) return;
    downloadFilename = filename;
    downloading = true;
    downloadPresentation = !noFilename.checked;
    updateDownload();
    send({ type: 'download', revision, filterRevision, filename: !noFilename.checked });
  });
}

try { initialize(); }
catch (error) {
  errors.hidden = false;
  errors.textContent = `Unable to start: ${error instanceof Error ? error.message : String(error)}`;
}
