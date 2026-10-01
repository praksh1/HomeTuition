import AsyncStorage from "@react-native-async-storage/async-storage";
import { createDraftStore } from "./draftStore";

const KEY = "@sikshya_drafts";

/**
 * Unsent message text, kept per conversation.
 *
 * Drafts live on the device rather than the server: a half-written message is not something
 * to publish, and there is no server-side draft model. This is enough to stop a message being
 * lost when the user navigates away mid-sentence, and to give the Drafts folder real content.
 */
export type { Drafts } from "./draftStore";
export const { loadDrafts, saveDraft, getDraft, clearDraft } = createDraftStore(AsyncStorage, KEY);

// A failed outgoing message is distinct from words already being typed for the next one.
// Keep recovery text privately on the device, outside inbox recipient keys.
const failed = createDraftStore(AsyncStorage, "@fadko_unsent_message_recovery");
export const saveFailedDraft = failed.saveDraft;
export const getFailedDraft = failed.getDraft;
export const clearFailedDraft = failed.clearDraft;
