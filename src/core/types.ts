/** Shared data contracts for parsing and merging. No platform APIs belong here. */
export interface Source {
  id: number;
  order: number;
  name: string;
  label: string;
}

export interface ParseOptions {
  format?: string;
  timezone?: string;
}

export interface Timestamp {
  key: bigint;
  format: string;
  fractionSeparator?: string;
  usedFallback: boolean;
}

export interface Entry {
  key: bigint;
  source: Source;
  line: number;
  lines: string[];
}

export interface Diagnostics {
  format: string;
  entries: number;
  continuations: number;
  leading: number;
  lines: number;
  usedFallback: boolean;
  durationMs: number;
  firstFallbackLine?: number;
}

export interface ParsedSource {
  entries: Entry[];
  diagnostics: Diagnostics;
}

export interface DisplayOptions {
  filename: boolean;
  filenameWidth: number;
  color: boolean;
}
