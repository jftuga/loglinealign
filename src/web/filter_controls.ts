/** Repeatable filter fields with independent options, validation, and a shared limit. */
import { createFilter, filterColor, MAX_FILTERS } from './filter';
import type { FilterOptions } from './filter';
import { trashIcon } from './icons';

export function createFilterControls(container: HTMLElement, template: HTMLTemplateElement, add: HTMLButtonElement, count: HTMLElement, onChange: () => void) {
  const fields: { row: HTMLElement; text: HTMLInputElement; invert: HTMLInputElement; toggles: HTMLButtonElement[]; read: () => FilterOptions }[] = [];
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
        text.value = '';
        invert.checked = false;
        for (const toggle of toggles) toggle.setAttribute('aria-pressed', 'false');
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
