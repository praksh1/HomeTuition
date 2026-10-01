export type Drafts = Record<string, string>;
interface DraftStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

/** Device-only drafts. Serialized writes stop older saves resurrecting a sent draft. */
export function createDraftStore(storage: DraftStorage, key: string) {
  let mutations: Promise<void> = Promise.resolve();
  const loadDrafts = async (): Promise<Drafts> => {
    try {
      const raw = await storage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch { return {}; }
  };
  const saveDraft = (conversation: string | number, text: string): Promise<void> => {
    const write = mutations.then(async () => {
      const drafts = await loadDrafts();
      if (text.trim()) drafts[String(conversation)] = text;
      else delete drafts[String(conversation)];
      try { await storage.setItem(key, JSON.stringify(drafts)); }
      catch { /* Full/unavailable storage must not break messaging. */ }
    });
    mutations = write.catch(() => {});
    return write;
  };
  return {
    loadDrafts,
    saveDraft,
    getDraft: async (conversation: string | number) => (await loadDrafts())[String(conversation)] ?? "",
    clearDraft: (conversation: string | number) => saveDraft(conversation, ""),
  };
}
