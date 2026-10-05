/** Build per-file timezone and adjustment controls for the Sources panel. Edits notify the application that settings are pending; they never start a merge directly. */
import { fallbackTimezone } from '../core/timezone';
import { formatTimeShift, parseTimeShift } from '../core/time_adjustment';
import type { WebSource } from './protocol';

const steps = new WeakMap<WebSource, string>();

function validateInput(input: HTMLInputElement, timezone: boolean): boolean {
  try {
    if (timezone) fallbackTimezone(input.value.trim());
    else parseTimeShift(input.value.trim());
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    return true;
  } catch (error) {
    input.setCustomValidity(error instanceof Error ? error.message : String(error));
    input.setAttribute('aria-invalid', 'true');
    return false;
  }
}

export function createTimeControls(source: WebSource, onChange: () => void): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const field of ['timezone', 'timeShift'] as const) {
    const container = document.createElement('div');
    container.className = 'time-controls';
    fragment.append(container);
    const timezone = field === 'timezone';
    const title = timezone ? 'File timezone (optional)' : 'Time adjustment';
    const input = document.createElement('input');
    input.id = `${timezone ? 'timezone' : 'time-shift'}-${source.id}`;
    input.type = 'text';
    input.value = source[field];
    input.placeholder = timezone ? 'Inherit global fallback' : '+00:00';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `${title} for ${source.label}`);
    input.setAttribute('aria-describedby', `${input.id}-help`);
    input.addEventListener('input', () => {
      source[field] = input.value;
      validateInput(input, timezone);
      onChange();
    });
    validateInput(input, timezone);
    const label = document.createElement('label');
    label.className = 'format-label';
    label.htmlFor = input.id;
    label.textContent = title;
    const help = document.createElement('p');
    help.id = `${input.id}-help`;
    help.className = 'hint';
    help.textContent = timezone ? 'UTC or ±HH:MM for timestamps without an offset. Blank inherits the global fallback.' : 'Positive = later; negative = earlier. Original log text stays unchanged. Apply with Remerge.';
    container.append(label, input, help);
    if (timezone) continue;
    const actions = document.createElement('div');
    actions.className = 'time-adjustment-actions';
    const step = document.createElement('select');
    step.setAttribute('aria-label', `Adjustment step for ${source.label}`);
    for (const [value, text] of [['30', '30 min'], ['60', '1 hour']]) {
      const option = document.createElement('option');
      option.value = value!;
      option.textContent = text!;
      step.append(option);
    }
    step.value = steps.get(source) ?? '30';
    step.addEventListener('change', () => steps.set(source, step.value));
    actions.append(step);
    for (const [title, direction] of [['Earlier', -1n], ['Later', 1n], ['Reset', 0n]] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = title;
      button.setAttribute('aria-label', `${title} time adjustment for ${source.label}`);
      button.addEventListener('click', () => {
        if (direction && !validateInput(input, false)) { input.reportValidity(); return; }
        const value = direction ? parseTimeShift(input.value.trim()) + direction * BigInt(step.value) : 0n;
        input.value = source.timeShift = formatTimeShift(value);
        validateInput(input, false);
        onChange();
      });
      actions.append(button);
    }
    container.append(actions);
  }
  return fragment;
}
