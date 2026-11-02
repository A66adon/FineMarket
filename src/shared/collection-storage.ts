import type { CollectionEntry, CollectionIndex } from './types';
import { createCollectionIndex } from './moxfield-collection';

const COLLECTION_KEY = 'deckcart.collection.v1';

interface StoredCollection {
  entries: CollectionEntry[];
  source: 'moxfield' | 'csv';
  fetchedAt: string;
}

export async function loadStoredCollection(): Promise<
  CollectionIndex | undefined
> {
  const stored = await browser.storage.local.get(COLLECTION_KEY);
  const value = stored[COLLECTION_KEY] as StoredCollection | undefined;
  if (!value?.entries?.length) return undefined;
  return createCollectionIndex(value.entries, value.source);
}

export async function saveStoredCollection(
  index: CollectionIndex,
): Promise<void> {
  const value: StoredCollection = {
    entries: index.entries,
    source: index.source,
    fetchedAt: index.fetchedAt,
  };
  await browser.storage.local.set({ [COLLECTION_KEY]: value });
}

export async function clearStoredCollection(): Promise<void> {
  await browser.storage.local.remove(COLLECTION_KEY);
}
