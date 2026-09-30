/** Blocking is private: the blocker stops composing; a blocked sender can still send privately. */
export function deliveryForBlocks(blockedByYou: boolean, blockedByRecipient: boolean) {
  return blockedByYou
    ? { canSend: false, suppressForRecipient: false }
    : { canSend: true, suppressForRecipient: blockedByRecipient };
}
