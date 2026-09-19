/** Desktop chat convention: Enter sends; Shift+Enter keeps a deliberate line break. */
export function shouldSendMessageOnKey(
  platform: string,
  key: string,
  shiftKey = false,
  isComposing = false,
): boolean {
  return platform === "web" && key === "Enter" && !shiftKey && !isComposing;
}
