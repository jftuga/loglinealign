/** Typed messages connect the UI to its embedded worker. Only viewport rows and download blobs leave the worker, keeping large results off the DOM thread. */
import type { Diagnostics, Source } from '../core/types';
import type { FilterOptions, MatchRange } from './filter';

export interface PreviewRow {
  text: string;
  order: number;
  matches: MatchRange[];
}

export interface WebSource extends Source {
  file: File;
  included: boolean;
  format: string;
}

export type WorkerRequest =
  | { type: 'merge'; revision: number; sources: WebSource[]; timezone: string; reverse: boolean }
  | { type: 'filter'; revision: number; filterRevision: number; options: FilterOptions }
  | { type: 'view'; revision: number; filterRevision: number; request: number; start: number; count: number; filename: boolean }
  | { type: 'download'; revision: number; filterRevision: number; filename: boolean };

export interface FileReport {
  id: number;
  size: number;
  diagnostics?: Diagnostics;
  error?: string;
  cached?: boolean;
}

export type WorkerResponse =
  | { type: 'merged'; revision: number; total: number; entries: number; reports: FileReport[]; errors: string[]; warning?: string; durationMs: number }
  | { type: 'filtered'; revision: number; filterRevision: number; total: number; entries: number; durationMs: number; error?: string }
  | { type: 'view'; revision: number; filterRevision: number; request: number; start: number; rows: PreviewRow[] }
  | { type: 'download'; revision: number; filterRevision: number; blob: Blob }
  | { type: 'error'; revision: number; message: string };
