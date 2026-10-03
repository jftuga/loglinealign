/** Resolve the shared fallback policy after inputs have been validated with a supplied timezone or provisional UTC. Reevaluate this policy for every selection, independently of cached parsing results. */
import type { ParsedSource, Source } from './types';
import { missingTimezoneMessage } from './timezone';

export function resolveFallback(inputs: { source: Source; parsed: ParsedSource }[], timezone?: string, allInputsValid = true): { warning?: string; errors: Map<number, string> } {
  const errors = new Map<number, string>();
  if (timezone) return { errors };
  const nonempty = inputs.filter(input => input.parsed.diagnostics.entries > 0);
  if (allInputsValid && nonempty.length && nonempty.every(input => input.parsed.diagnostics.usedFallback)) {
    return { errors, warning: 'Every nonempty selected file contains timestamps without a timezone; assuming UTC for those timestamps. Explicit offsets are preserved. Set a fallback timezone to override this assumption.' };
  }
  for (const { source, parsed } of nonempty) {
    if (parsed.diagnostics.usedFallback) errors.set(source.id, `${source.name}:${parsed.diagnostics.firstFallbackLine}: ${missingTimezoneMessage}`);
  }
  return { errors };
}
