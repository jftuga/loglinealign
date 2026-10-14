/** Attach a most-recently-used dropdown to a text input. Typing shows stored entries containing the typed text, ArrowDown shows all of them, and a final entry clears that field's history. */
import { clearHistory, isString, readHistory, recordHistory } from './history';
import type { EntryGuard } from './history';

export interface HistorySource<T> {
  field: string;
  name: string;
  isEntry: EntryGuard<T>;
  text: (entry: T) => string;
  label: (entry: T) => string;
  apply: (entry: T) => void;
}

let nextList = 0;

class HistoryCombobox<T> {
  private readonly list = document.createElement('ul');
  private entries: T[] = [];
  private active = -1;

  constructor(private readonly input: HTMLInputElement, private readonly source: HistorySource<T>) {
    const wrapper = document.createElement('div');
    wrapper.className = 'history';
    input.replaceWith(wrapper);
    this.list.id = `history-${nextList++}`;
    this.list.className = 'history-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', source.name);
    this.list.hidden = true;
    wrapper.append(input, this.list);
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', this.list.id);
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('input', () => this.open(false));
    input.addEventListener('keydown', event => this.handleKey(event));
    input.addEventListener('blur', () => this.close());
    // Keep focus in the input so choosing an entry does not commit or close it first.
    this.list.addEventListener('mousedown', event => event.preventDefault());
  }

  private open(all: boolean): void {
    const typed = this.input.value.toLowerCase();
    this.entries = readHistory(this.source.field, this.source.isEntry).filter(entry => all || this.source.text(entry).toLowerCase().includes(typed));
    if (!this.entries.length) { this.close(); return; }
    this.list.replaceChildren();
    for (const entry of this.entries) this.option(this.source.label(entry));
    this.option('Clear history').classList.add('history-clear');
    this.setActive(-1);
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  private option(text: string): HTMLLIElement {
    const index = this.list.childElementCount;
    const option = document.createElement('li');
    option.id = `${this.list.id}-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.textContent = text;
    option.title = text;
    option.addEventListener('click', () => this.choose(index));
    this.list.append(option);
    return option;
  }

  private close(): void {
    this.list.hidden = true;
    this.setActive(-1);
    this.input.setAttribute('aria-expanded', 'false');
  }

  private setActive(index: number): void {
    this.active = index;
    for (const [position, option] of [...this.list.children].entries()) option.setAttribute('aria-selected', String(position === index));
    const option = this.list.children[index];
    if (option) {
      this.input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private choose(index: number): void {
    const entry = this.entries[index];
    if (entry === undefined) {
      clearHistory(this.source.field);
    } else {
      this.source.apply(entry);
      recordHistory(this.source.field, entry, this.source.isEntry);
    }
    this.close();
  }

  private handleKey(event: KeyboardEvent): void {
    const count = this.list.childElementCount;
    const open = !this.list.hidden;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (open) this.setActive((this.active + 1) % count);
      else this.open(true);
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      this.setActive((this.active + count - 1) % count);
    } else if (event.key === 'Enter' && open && this.active >= 0) {
      event.preventDefault();
      this.choose(this.active);
    } else if (event.key === 'Escape' && open) {
      // Also prevents search inputs from clearing their text.
      event.preventDefault();
      this.close();
    } else if (event.key === 'Tab') {
      this.close();
    }
  }
}

export function attachHistory<T>(input: HTMLInputElement, source: HistorySource<T>): void {
  new HistoryCombobox(input, source);
}

/** Return the value when it is worth remembering: not blank, and accepted by the check without throwing. */
export function acceptValid(value: string, check: (value: string) => unknown): string | undefined {
  if (!value.trim()) return undefined;
  try { return check(value) === false ? undefined : value; }
  catch { return undefined; }
}

/** Remember committed (blur or Enter) values; choosing one replaces the text and notifies existing input listeners. */
export function attachTextHistory(input: HTMLInputElement, field: string, name: string, accept: (value: string) => string | undefined): void {
  attachHistory(input, {
    field, name, isEntry: isString, text: entry => entry, label: entry => entry,
    apply: entry => { input.value = entry; input.dispatchEvent(new Event('input', { bubbles: true })); },
  });
  input.addEventListener('change', () => {
    const value = accept(input.value);
    if (value !== undefined) recordHistory(field, value, isString);
  });
}
