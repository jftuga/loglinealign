/** Manage local files, controls, and a bounded viewport for the standalone page. The embedded worker owns parsing, cached entries, ordering, filtering, and download generation. */
import { sourceColor } from '../core/colors';
import { sourceLabels } from '../core/format';
import { createFilter } from './filter';
import type { FilterOptions } from './filter';
import type { FileReport, WebSource, WorkerRequest, WorkerResponse } from './protocol';

declare const __VERSION__: string;
declare const __REPOSITORY__: string;
declare const __WORKER_CODE__: string;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

const picker = element<HTMLInputElement>('file-picker');
const timezone = element<HTMLInputElement>('timezone');
const reverse = element<HTMLInputElement>('reverse');
const noFilename = element<HTMLInputElement>('no-filename');
const color = element<HTMLInputElement>('color');
const verbose = element<HTMLInputElement>('verbose');
const download = element<HTMLButtonElement>('download');
const downloadName = element<HTMLInputElement>('download-name');
const viewport = element<HTMLDivElement>('viewport');
const rows = element<HTMLDivElement>('rows');
const spacer = element<HTMLDivElement>('spacer');
const status = element<HTMLParagraphElement>('status');
const errors = element<HTMLPreElement>('errors');
const warnings = element<HTMLDivElement>('warnings');
const warningText = element<HTMLSpanElement>('warning-text');
const filterText = element<HTMLInputElement>('filter-text');
const filterCase = element<HTMLButtonElement>('filter-case');
const filterWord = element<HTMLButtonElement>('filter-word');
const filterRegex = element<HTMLButtonElement>('filter-regex');
const filterInvert = element<HTMLInputElement>('filter-invert');
const filterError = element<HTMLParagraphElement>('filter-error');
const sources: WebSource[] = [];
const names: string[] = [];
const reports = new Map<number, FileReport>();
const appliedFormats = new Map<number, string>();
let appliedTimezone = '';
let revision = 0;
let viewRequest = 0;
let total = 0;
let pending = false;
let busy = false;
let downloading = false;
let frame = 0;
let worker: Worker;
let downloadPresentation = true;
let filterRevision = 0;
let filtering = false;
let filterInFlight = false;
let viewInFlight = false;
let filterDelay: number | undefined;
let filterWatchdog: number | undefined;
let mergedReady = false;
let mergedTotal = 0;
let mergedEntries = 0;
let mergeDuration = 0;
const rowHeight = 22;
const maxHeight = 8000000;

function send(message: WorkerRequest): void { worker.postMessage(message); }

function updateDownload(): void {
  download.disabled = !total || pending || busy || filtering || downloading || !errors.hidden || !filterError.hidden;
}

function readFilter(): FilterOptions {
  return { text: filterText.value, matchCase: filterCase.getAttribute('aria-pressed') === 'true', wholeWord: filterWord.getAttribute('aria-pressed') === 'true', regex: filterRegex.getAttribute('aria-pressed') === 'true', invert: filterInvert.checked };
}

function showFilterError(message = ''): void {
  filterError.hidden = !message;
  filterError.textContent = message;
  filterText.setAttribute('aria-invalid', String(Boolean(message)));
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
  try { createFilter(readFilter()); }
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
  send({ type: 'filter', revision, filterRevision, options: readFilter() });
  watchFilter();
}

function changeFilter(): void {
  element('filter-help').textContent = filterInvert.checked ? 'Keep nonmatching lines in the preview and download (grep -v). An empty filter shows all lines.' : 'Keep matching lines in the preview and download. Matches are highlighted in the preview only.';
  filterRevision++;
  downloading = false;
  window.clearTimeout(filterDelay);
  showFilterError();
  clearPreview();
  try { createFilter(readFilter()); }
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
  status.textContent = 'Parsing settings changed. Select Remerge to apply them.';
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
    for (const source of sources) appliedFormats.set(source.id, source.format.trim() ? source.format : '');
  }
  element('pending').hidden = !pending;
  errors.hidden = true;
  status.textContent = 'Merging selected files…';
  clearPreview();
  updateReports();
  send({ type: 'merge', revision, sources: sources.map(source => ({ ...source, format: appliedFormats.get(source.id) ?? '' })), timezone: appliedTimezone, reverse: reverse.checked });
}

function addFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    const id = names.length;
    names.push(file.name);
    sources.push({ id, order: id, name: file.name, label: file.name, file, included: true, format: '' });
  }
  const labels = sourceLabels(names);
  for (const source of sources) source.label = labels[source.id]!;
  renderFiles();
  startMerge();
}

function removeSource(id: number): void {
  const index = sources.findIndex(source => source.id === id);
  if (index < 0) return;
  sources.splice(index, 1);
  reports.delete(id);
  appliedFormats.delete(id);
  renderFiles();
  startMerge();
}

function describeReport(source: WebSource): string {
  const report = reports.get(source.id);
  const prefix = `${source.file.size.toLocaleString()} bytes · `;
  if (!source.included) return prefix + 'Excluded' + (report?.error ? ` · ${report.error}` : '');
  if (pending) return prefix + 'Parsing settings pending';
  if (busy) return prefix + 'Merging…';
  if (report?.error) return report.error;
  if (!report?.diagnostics) return prefix + 'Waiting to merge';
  const d = report.diagnostics;
  const format = appliedFormats.get(source.id) ? `${d.format} · ` : '';
  return `${prefix}${format}${d.entries.toLocaleString()} entries · ${d.continuations.toLocaleString()} continuation lines · ${d.usedFallback ? `fallback ${appliedTimezone || 'UTC (assumed)'}` : 'explicit/epoch or empty'}`;
}

function updateReports(): void {
  for (const source of sources) {
    const result = reports.get(source.id);
    const detected = document.getElementById(`detected-${source.id}`);
    if (detected) {
      const automatic = !pending && !busy && source.included && !appliedFormats.get(source.id) && !result?.error && result?.diagnostics?.entries;
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
  element('file-count').textContent = `${sources.length} file${sources.length === 1 ? '' : 's'}`;
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
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7"/></svg>';
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
    row.append(heading, formatLabel, format, detectedLabel, detected, report);
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
  if (!total || busy || filtering) return;
  const start = viewportStart();
  viewInFlight = true;
  send({ type: 'view', revision, filterRevision, request: ++viewRequest, start, count: Math.ceil(viewport.clientHeight / rowHeight) + 2, filename: !noFilename.checked });
  watchFilter();
}

function scheduleView(): void {
  if (!frame) frame = requestAnimationFrame(requestView);
}

function renderRows(message: Extract<WorkerResponse, { type: 'view' }>): void {
  if (message.request !== viewRequest) return;
  rows.style.top = `${viewport.scrollTop}px`;
  const fragment = document.createDocumentFragment();
  for (const row of message.rows) {
    const line = document.createElement('div');
    line.className = 'log-row';
    let position = 0;
    for (const [start, end] of row.matches) {
      line.append(document.createTextNode(row.text.slice(position, start)));
      const mark = document.createElement('mark');
      mark.textContent = row.text.slice(start, end);
      line.append(mark);
      position = end;
    }
    line.append(document.createTextNode(row.text.slice(position)));
    line.dataset.order = String(row.order);
    if (color.checked) line.style.color = sourceColor(row.order).css;
    fragment.append(line);
  }
  rows.replaceChildren(fragment);
}

function datedFilename(): string {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `merge--${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.log`;
}

function saveDownload(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadName.value.trim() || datedFilename();
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
    status.textContent = message.errors.length ? 'Resolve the selected file errors to merge and download.' : pending ? 'Parsing settings pending. Select Remerge to apply them.' : 'Preparing preview…';
    element('diagnostics').textContent = message.reports.map(report => {
      const source = sources.find(item => item.id === report.id)!;
      const d = report.diagnostics;
      return `${source.label}: ${report.size} bytes; ${report.error ?? (d ? `${d.format}; ${d.entries} entries; ${d.continuations} continuation lines (${d.leading} leading); ${d.usedFallback ? `timezone fallback ${appliedTimezone || 'UTC (assumed)'}` : 'explicit/epoch or empty'}; ${d.durationMs.toFixed(1)} ms parse; ${report.cached ? 'cached' : 'parsed'}` : 'empty')}`;
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
    spacer.style.height = `${Math.min(total * rowHeight, maxHeight)}px`;
    viewport.scrollTop = 0;
    element('empty').hidden = Boolean(total);
    const filtered = filterText.value !== '';
    const summary = filtered ? `${total.toLocaleString()} of ${mergedTotal.toLocaleString()} lines · ${message.entries.toLocaleString()} of ${mergedEntries.toLocaleString()} entries` : `${total.toLocaleString()} lines · ${mergedEntries.toLocaleString()} entries`;
    const noMatches = filterInvert.checked ? 'No nonmatching lines' : 'No matching lines';
    status.textContent = message.error ? 'Correct the filter to view and download results.' : !sources.some(source => source.included) ? 'No files selected.' : !mergedTotal ? 'Selected files are empty.' : !total ? `${noMatches} (${mergedTotal.toLocaleString()} lines searched).` : `${summary}${filtered && filterInvert.checked ? ' · inverted' : ''} · ${reverse.checked ? 'newest first' : 'oldest first'} · ${(mergeDuration + message.durationMs).toFixed(0)} ms${pending ? ' · parsing settings pending' : ''}`;
    const empty = element('empty');
    if (!total && mergedTotal && filtered) {
      empty.textContent = message.error ? 'Correct the filter to show results.' : `${noMatches}. Change or clear the filter.`;
    } else {
      empty.textContent = 'Your merged logs will appear here.';
    }
    download.textContent = filtered ? 'Download filtered .log' : 'Download .log';
    updateDownload();
    scheduleView();
  } else if (message.type === 'view') {
    if (message.filterRevision === filterRevision && message.request === viewRequest) {
      viewInFlight = false;
      if (!filterInFlight) { window.clearTimeout(filterWatchdog); filterWatchdog = undefined; }
      renderRows(message);
    }
  } else if (message.type === 'download') {
    if (message.filterRevision !== filterRevision) return;
    downloading = false;
    if (!pending && !busy && !filtering && filterError.hidden && downloadPresentation === !noFilename.checked) saveDownload(message.blob);
    updateDownload();
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
  worker = createWorker();
  element('dismiss-warning').addEventListener('click', () => { warnings.hidden = true; viewport.focus({ preventScroll: true }); });
  filterText.addEventListener('input', changeFilter);
  filterInvert.addEventListener('change', changeFilter);
  for (const button of [filterCase, filterWord, filterRegex]) {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      changeFilter();
    });
  }
  element('filter-clear').addEventListener('click', () => { filterText.value = ''; changeFilter(); filterText.focus(); });
  picker.addEventListener('change', () => { if (picker.files?.length) addFiles(picker.files); picker.value = ''; });
  const drop = element('drop-zone');
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => event.preventDefault());
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragging'); if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files); });
  timezone.addEventListener('input', markPending);
  element('remerge').addEventListener('click', () => startMerge());
  reverse.addEventListener('change', () => startMerge(false));
  noFilename.addEventListener('change', scheduleView);
  color.addEventListener('change', () => {
    for (const row of rows.children) (row as HTMLElement).style.color = color.checked ? sourceColor(Number((row as HTMLElement).dataset.order)).css : '';
  });
  verbose.addEventListener('change', () => { element('diagnostic-panel').hidden = !verbose.checked; });
  element('expand').addEventListener('click', () => {
    const expanded = element('workspace').classList.toggle('expanded');
    element('expand').setAttribute('aria-expanded', String(expanded));
    element('expand').setAttribute('aria-label', expanded ? 'Restore sources and settings' : 'Expand results to full page width');
    element('expand').title = expanded ? 'Restore sources and settings' : 'Expand results';
    scheduleView();
  });
  element('expand-vertical').addEventListener('click', () => {
    const expanded = document.body.classList.toggle('expanded-vertical');
    const button = element<HTMLButtonElement>('expand-vertical');
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Restore normal results height' : 'Expand results to full window height');
    button.title = expanded ? 'Restore normal results height' : 'Expand results vertically';
    element('result').scrollIntoView({ block: 'start' });
    scheduleView();
  });
  viewport.addEventListener('scroll', scheduleView, { passive: true });
  new ResizeObserver(scheduleView).observe(viewport);
  download.addEventListener('click', () => {
    if (download.disabled) return;
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
