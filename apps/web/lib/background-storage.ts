import { BACKGROUND_STORAGE_KEY, DEFAULT_BACKGROUND, parseBackground, type BackgroundPreferences } from "./background";

const DATABASE = "traccia-appearance";
const STORE = "background";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Background storage is blocked by another tab."));
    };
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Background storage was interrupted."));
    transaction.onerror = () => reject(transaction.error);
  });
}

/** Original images exceed localStorage's quota. Keep them in IndexedDB, separate from small preference writes. */
export async function writeBackground(background: BackgroundPreferences, replaceImage = true): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const complete = finished(transaction);
    const store = transaction.objectStore(STORE);
    const { image, ...preferences } = background;
    try {
      store.put(preferences, "preferences");
      if (replaceImage) store.put(image, "image");
    } catch (cause) {
      transaction.abort();
      await complete.catch(() => {});
      throw cause;
    }
    await complete;
  } finally {
    database.close();
  }
}

export async function readBackground(): Promise<BackgroundPreferences> {
  const database = await openDatabase();
  let preferences: unknown;
  let image: unknown;
  try {
    const transaction = database.transaction(STORE, "readonly");
    const complete = finished(transaction);
    const store = transaction.objectStore(STORE);
    const settingsRequest = store.get("preferences");
    const imageRequest = store.get("image");
    settingsRequest.onsuccess = () => {
      preferences = settingsRequest.result;
    };
    imageRequest.onsuccess = () => {
      image = imageRequest.result;
    };
    await complete;
  } finally {
    database.close();
  }
  if (preferences && typeof preferences === "object") return parseBackground(JSON.stringify({ ...preferences, image }));

  // Carry existing choices and images across the storage change. Only remove the old copy after a successful write.
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(BACKGROUND_STORAGE_KEY);
  } catch {
    /* IndexedDB can still work when localStorage is disabled. */
  }
  if (!legacy) return DEFAULT_BACKGROUND;
  const migrated = parseBackground(legacy);
  await writeBackground(migrated);
  try {
    localStorage.removeItem(BACKGROUND_STORAGE_KEY);
  } catch {
    /* Keeping a redundant legacy copy is harmless. */
  }
  return migrated;
}
