/** Save / Load tab: save, load, and delete named profiles, or clear all of this page's browser storage after confirmation. The application supplies how settings are captured and applied. */
import { confirmAction } from './confirm_dialog';
import { element } from './dom';
import { deleteProfile, readProfiles, saveProfile } from './profiles';
import type { Profile, ProfileSettings } from './profiles';
import { clearStored } from './storage';

const unavailable = 'Browser storage is unavailable or full in this browser.';

export function createSaveLoadControls(capture: () => ProfileSettings, apply: (name: string, profile: Profile) => string): void {
  const name = element<HTMLInputElement>('profile-name');
  const list = element<HTMLSelectElement>('profile-list');
  const load = element<HTMLButtonElement>('profile-load');
  const remove = element<HTMLButtonElement>('profile-delete');
  const status = element<HTMLParagraphElement>('profile-status');

  function report(message: string, bad = false): void {
    status.textContent = message;
    status.classList.toggle('bad', bad);
  }

  function refresh(selected = list.value): void {
    const profiles = readProfiles();
    list.replaceChildren();
    for (const [profileName, profile] of profiles) {
      const option = document.createElement('option');
      option.value = profileName;
      option.textContent = `${profileName} — saved ${new Date(profile.savedAt).toLocaleString()}`;
      list.append(option);
    }
    if (!profiles.size) {
      const option = document.createElement('option');
      option.textContent = 'No saved profiles';
      list.append(option);
    } else if (profiles.has(selected)) {
      list.value = selected;
    }
    list.disabled = load.disabled = remove.disabled = !profiles.size;
  }

  async function save(): Promise<void> {
    const profileName = name.value.trim();
    if (!profileName) { report('Enter a profile name to save.', true); name.focus(); return; }
    if (readProfiles().has(profileName) && !await confirmAction(`Replace the saved profile "${profileName}"?`, 'Replace')) return;
    if (!saveProfile(profileName, capture())) { report(`${unavailable} The profile was not saved.`, true); return; }
    refresh(profileName);
    report(`Saved "${profileName}".`);
  }

  function loadSelected(): void {
    const profile = readProfiles().get(list.value);
    if (!profile) { refresh(); report('That profile no longer exists.', true); return; }
    report(apply(list.value, profile));
  }

  async function removeSelected(): Promise<void> {
    const profileName = list.value;
    if (!await confirmAction(`Delete the saved profile "${profileName}"?`, 'Delete')) return;
    if (!deleteProfile(profileName)) { report(`${unavailable} The profile was not deleted.`, true); return; }
    refresh();
    report(`Deleted "${profileName}".`);
  }

  async function clearAll(): Promise<void> {
    if (!await confirmAction('Delete all saved profiles, field histories, and remembered Merge Settings for LogLineAlign in this browser? Current page settings stay until you reload. This cannot be undone.', 'Clear all')) return;
    if (!clearStored()) { report(`${unavailable} Nothing was cleared.`, true); return; }
    refresh();
    report('Cleared all LogLineAlign browser storage.');
  }

  element('profile-save').addEventListener('click', () => void save());
  name.addEventListener('keydown', event => { if (event.key === 'Enter') void save(); });
  list.addEventListener('change', () => { name.value = list.value; });
  load.addEventListener('click', loadSelected);
  remove.addEventListener('click', () => void removeSelected());
  element('storage-clear').addEventListener('click', () => void clearAll());
  // Another open copy of this page may change the same storage.
  window.addEventListener('storage', () => refresh());
  refresh();
}
