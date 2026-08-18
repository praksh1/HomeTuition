import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@sikshya_drafts";

/**
 * Unsent message text, kept per conversation.
 *
 * Drafts live on the device rather than the server: a half-written message is not something
 * to publish, and there is no server-side draft model. This is enough to stop a message being
 * lost when the user navigates away mid-sentence, and to give the Drafts folder real content.
 */
export type Drafts = Record<string, string>;

export async function loadDrafts(): Promise<Drafts> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Drafts) : {};
  } catch {
    return {};
  }
}

export async function saveDraft(otherUserId: string | number, text: string): Promise<void> {
  const drafts = await loadDrafts();
  const key = String(otherUserId);
  if (text.trim()) drafts[key] = text;
  else delete drafts[key]; // an emptied draft is not a draft
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    // Storage full or unavailable — losing a draft is not worth crashing over.
  }
}

export async function getDraft(otherUserId: string | number): Promise<string> {
  const drafts = await loadDrafts();
  return drafts[String(otherUserId)] ?? "";
}

export async function clearDraft(otherUserId: string | number): Promise<void> {
  await saveDraft(otherUserId, "");
}
