/** Persist checkbox states by element ID. Merge Settings restores them on page load, and saved profiles reuse the same shape. */
import { isRecord, readStored, writeStored } from './storage';

const key = 'merge-settings';

export function checkboxStates(inputs: readonly HTMLInputElement[]): Record<string, boolean> {
  return Object.fromEntries(inputs.map(input => [input.id, input.checked]));
}

/** Apply known states; missing or malformed entries keep each checkbox's current state. */
export function applyCheckboxStates(inputs: readonly HTMLInputElement[], states: Record<string, unknown>): void {
  for (const input of inputs) {
    const state = Object.hasOwn(states, input.id) ? states[input.id] : undefined;
    if (typeof state === 'boolean') input.checked = state;
  }
}

export function restoreCheckboxes(inputs: readonly HTMLInputElement[]): void {
  const stored = readStored(key);
  if (isRecord(stored)) applyCheckboxStates(inputs, stored);
}

export function rememberCheckboxes(inputs: readonly HTMLInputElement[]): void {
  writeStored(key, checkboxStates(inputs));
}
