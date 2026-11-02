import type { Settings } from './types';
import { DEFAULT_SETTINGS } from './constants';

const SETTINGS_KEY = 'deckcart.settings.v1';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  if (!value) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    boards: value.boards?.length ? value.boards : DEFAULT_SETTINGS.boards,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}
