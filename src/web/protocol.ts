/** Typed messages connect the UI to its embedded worker. Rows leave the worker in bounded batches, including when preparing the full browser-searchable view. */
import type { Diagnostics, Source } from '../core/types';
import type { FilterOptions, HighlightRange } from './filter';

export interface PreviewRow {
  text: string;
  order: number;
  matches: HighlightRange[];
}

export interface WebSource extends Source {
  file: File;
  included: boolean;
  format: string;
  timezone: string;
  timeShift: string;
}

export type WorkerRequest =
  | { type: 'merge'; revision: number; sources: WebSource[]; timezone: string; reverse: boolean }
  | { type: 'filter'; revision: number; filterRevision: number; options: FilterOptions[] }
  | { type: 'view'; revision: number; filterRevision: number; request: number; start: number; count: number; filename: boolean }
  | { type: 'download'; revision: number; filterRevision: number; filename: boolean }
  | { type: 'copy'; revision: number; filterRevision: number; request: number; filename: boolean };

export interface FileReport {
  id: number;
  size: number;
  diagnostics?: Diagnostics;
  error?: string;
  cached?: boolean;
}

export type WorkerResponse =
  | { type: 'merged'; revision: number; total: number; entries: number; reports: FileReport[]; errors: string[]; warning?: string; durationMs: number }
  | { type: 'filtered'; revision: number; filterRevision: number; total: number; entries: number; textBytes: number; filenameBytes: number; durationMs: number; error?: string }
  | { type: 'view'; revision: number; filterRevision: number; request: number; start: number; rows: PreviewRow[] }
  | { type: 'download'; revision: number; filterRevision: number; blob: Blob }
  | { type: 'copy'; revision: number; filterRevision: number; request: number; blob: Blob }
  | { type: 'error'; revision: number; message: string };
