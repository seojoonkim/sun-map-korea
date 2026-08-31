import type { SharedAnalysisV1 } from "./share-state";

const STORAGE_KEY = "sun-map-korea:saved-analyses:v1";

export type SavedAnalysis = {
  id: string;
  name: string;
  createdAt: string;
  state: SharedAnalysisV1;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function parseSaved(value: string | null): SavedAnalysis[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedAnalysis => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Record<string, unknown>;
      return typeof item.id === "string"
        && typeof item.name === "string"
        && typeof item.createdAt === "string"
        && Boolean(item.state) && typeof item.state === "object";
    });
  } catch {
    return [];
  }
}

export function createSavedAnalysesStore(storage?: StorageLike | null) {
  let persistenceAvailable = Boolean(storage);
  let entries: SavedAnalysis[] = [];
  if (storage) {
    try {
      entries = parseSaved(storage.getItem(STORAGE_KEY));
    } catch {
      persistenceAvailable = false;
    }
  }

  const persist = () => {
    if (!persistenceAvailable || !storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      persistenceAvailable = false;
    }
  };

  return {
    get persistenceAvailable() {
      return persistenceAvailable;
    },
    list(): SavedAnalysis[] {
      return entries.map((entry) => ({ ...entry, state: structuredClone(entry.state) }));
    },
    save(name: string, state: SharedAnalysisV1, createdAt = new Date().toISOString()): SavedAnalysis {
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName.length > 40) throw new Error("Saved analysis name must be 1–40 characters");
      const id = globalThis.crypto?.randomUUID?.()
        ?? `${createdAt}-${Math.random().toString(36).slice(2, 10)}`;
      const saved = { id, name: trimmedName, createdAt, state: structuredClone(state) };
      entries = [...entries, saved];
      persist();
      return { ...saved, state: structuredClone(saved.state) };
    },
    remove(id: string) {
      entries = entries.filter((entry) => entry.id !== id);
      persist();
    },
  };
}
