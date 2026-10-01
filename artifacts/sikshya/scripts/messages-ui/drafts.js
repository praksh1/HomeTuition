export async function loadDrafts() {
  return { "12": "I will send the practice sheet after class." };
}

export async function getDraft() { return ""; }
export async function saveDraft() { globalThis.draftWriteCalls = (globalThis.draftWriteCalls ?? 0) + 1; }
export async function clearDraft() {}
export async function getFailedDraft(key) { return globalThis.failedMessageDrafts?.[key] ?? ""; }
export async function saveFailedDraft(key, text) { (globalThis.failedMessageDrafts ??= {})[key] = text; }
export async function clearFailedDraft(key) { if (globalThis.failedMessageDrafts) delete globalThis.failedMessageDrafts[key]; }
