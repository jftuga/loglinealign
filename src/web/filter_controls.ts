/** Repeatable filter fields with independent options, validation, a shared limit, and a shared history of text-and-option bundles. */
import { createFilter, emptyFilter, filterColor, isFilterOptions, MAX_FILTERS } from './filter';
import type { FilterOptions } from './filter';
import { recordHistory } from './history';
import { attachHistory } from './history_input';
import { trashIcon } from './icons';

type FilterField = { row: HTMLElement; text: HTMLInputElement; invert: HTMLInputElement; toggles: HTMLButtonElement[]; read: () => FilterOptions };

function describeFilter(options: FilterOptions): string {
  const flags = [options.matchCase && 'Aa', options.wholeWord && 'word', options.regex && '.*', options.invert && 'invert'].filter(Boolean);
  return flags.length ? `${options.text}  [${flags.join(' ')}]` : options.text;
}

function writeField(field: FilterField, options: FilterOptions): void {
  field.text.value = options.text;
  field.invert.checked = options.invert;
  const pressed = [options.matchCase, options.wholeWord, options.regex];
  for (const [index, toggle] of field.toggles.entries()) toggle.setAttribute('aria-pressed', String(pressed[index]));
}

/** Remember only nonempty, valid filters. */
function recordFilter(options: FilterOptions): void {
  if (options.text === '') return;
  try { createFilter(options); } catch { return; }
  recordHistory('filter', options, isFilterOptions);
}

export function createFilterControls(container: HTMLElement, template: HTMLTemplateElement, add: HTMLButtonElement, count: HTMLElement, onChange: () => void) {
  const fields: FilterField[] = [];
  let nextId = 0;

  function update(): void {
    for (const [index, field] of fields.entries()) {
      field.row.querySelector('.filter-number')!.textContent = `Filter ${index + 1}`;
      field.row.style.setProperty('--filter-color', filterColor(index));
      field.row.querySelector('.filter-options')!.setAttribute('aria-label', `Filter ${index + 1} matching options`);
      const remove = field.row.querySelector<HTMLButtonElement>('.filter-remove')!;
      remove.setAttribute('aria-label', `Remove filter ${index + 1}`);
      remove.title = fields.length === 1 ? 'Reset the last filter' : `Remove filter ${index + 1}`;
    }
    add.disabled = fields.length >= MAX_FILTERS;
    add.title = add.disabled ? `Maximum of ${MAX_FILTERS} filters` : 'Add filter';
    count.textContent = `${fields.length} / ${MAX_FILTERS}`;
  }

  function append(): void {
    if (fields.length >= MAX_FILTERS) return;
    const row = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    // Keep the initial field's existing IDs; every subsequent field gets unique associations.
    const suffix = nextId++ === 0 ? '' : `-${nextId}`;
    for (const node of row.querySelectorAll<HTMLElement>('[id], [for], [aria-describedby]')) {
      for (const attribute of ['id', 'for', 'aria-describedby']) {
        const value = node.getAttribute(attribute);
        if (value) node.setAttribute(attribute, value.split(' ').map(id => ['filter-help', 'filter-error'].includes(id) ? id : id + suffix).join(' '));
      }
    }
    const text = row.querySelector<HTMLInputElement>('input[type=search]')!;
    const invert = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    const toggles = [...row.querySelectorAll<HTMLButtonElement>('.filter-toggle')];
    const read = (): FilterOptions => ({ text: text.value, matchCase: toggles[0]!.getAttribute('aria-pressed') === 'true', wholeWord: toggles[1]!.getAttribute('aria-pressed') === 'true', regex: toggles[2]!.getAttribute('aria-pressed') === 'true', invert: invert.checked });
    const field = { row, text, invert, toggles, read };
    attachHistory(text, { field: 'filter', name: 'Recent filters', isEntry: isFilterOptions, text: entry => entry.text, label: describeFilter, apply: entry => { writeField(field, entry); onChange(); } });
    // Record after the user leaves the whole row, so option toggles chosen after typing are included.
    row.addEventListener('focusout', event => { if (!row.contains(event.relatedTarget as Node | null)) recordFilter(read()); });
    text.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.defaultPrevented) recordFilter(read()); });
    text.addEventListener('input', onChange);
    invert.addEventListener('change', onChange);
    for (const button of toggles) button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      onChange();
    });
    row.querySelector<HTMLButtonElement>('[id^=filter-clear]')!.addEventListener('click', () => { text.value = ''; onChange(); text.focus(); });
    const remove = row.querySelector<HTMLButtonElement>('.filter-remove')!;
    remove.innerHTML = trashIcon;
    remove.addEventListener('click', () => {
      const index = fields.indexOf(field);
      if (fields.length === 1) {
        writeField(field, emptyFilter);
      } else {
        fields.splice(index, 1);
        row.remove();
      }
      update();
      onChange();
      fields[Math.min(index, fields.length - 1)]!.text.focus();
    });
    fields.push(field);
    container.append(row);
    update();
  }

  add.addEventListener('click', () => {
    append();
    onChange();
    fields.at(-1)!.text.focus();
  });
  append();
  return {
    read: (): FilterOptions[] => fields.map(field => field.read()),
    /** Replace every field, keeping at least one and at most the limit, then reapply once. */
    write(options: FilterOptions[]): void {
      const wanted = Math.max(1, Math.min(options.length, MAX_FILTERS));
      while (fields.length > wanted) fields.pop()!.row.remove();
      while (fields.length < wanted) append();
      for (const [index, field] of fields.entries()) writeField(field, options[index] ?? emptyFilter);
      update();
      onChange();
    },
    validate(): void {
      const errors: string[] = [];
      for (const [index, field] of fields.entries()) {
        field.text.setAttribute('aria-invalid', 'false');
        try { createFilter(field.read()); }
        catch (error) {
          field.text.setAttribute('aria-invalid', 'true');
          errors.push(`Filter ${index + 1}: ${(error as Error).message}`);
        }
      }
      if (errors.length) throw new Error(errors.join(' '));
    },
  };
}
