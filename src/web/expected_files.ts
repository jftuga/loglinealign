/** List the files a loaded profile expects, marking each as loaded or missing. The application re-renders it whenever files are added or removed. */
import { element } from './dom';

export interface ExpectedFile {
  name: string;
  loaded: boolean;
}

export function renderExpectedFiles(profileName: string, files: readonly ExpectedFile[]): void {
  const panel = element('expected-files');
  panel.hidden = !profileName;
  if (!profileName) return;
  element('expected-profile').textContent = profileName;
  const loaded = files.filter(file => file.loaded).length;
  element('expected-summary').textContent = !files.length ? 'This profile has no saved files.' : loaded === files.length ? `All ${files.length} saved file${files.length === 1 ? ' is' : 's are'} loaded.` : `${loaded} of ${files.length} saved files loaded; ${files.length - loaded} missing.`;
  const list = element('expected-list');
  list.replaceChildren(...files.map(file => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'expected-name';
    name.textContent = file.name;
    const state = document.createElement('span');
    state.className = `expected-state ${file.loaded ? 'loaded' : 'missing'}`;
    state.textContent = file.loaded ? 'Loaded' : 'Missing';
    item.append(name, state);
    return item;
  }));
}
