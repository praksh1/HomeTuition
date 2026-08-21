/**
 * Whether the classroom shows a Chat tab of its own.
 *
 * There are two chats in a class and only one should be visible at a time, or a teacher and a
 * student end up talking in different places and both think the other is ignoring them.
 *
 * On the **web** the call carries Daily's own chat, inside the video where it belongs. The
 * classroom's tab next to the board is then a second, emptier conversation sitting beside a
 * working one — so it is hidden. Reported exactly that way: "I don't want teacher and student
 * to get confused on which chat system to use."
 *
 * On the **installed iOS and Android apps** there is no Daily chat at all. Those drive Daily's
 * native SDK behind this app's own call interface, because a WebView cannot capture the screen
 * for screen sharing, and the native SDK has no Prebuilt panels. The classroom's own tab is the
 * only chat those users have, so it stays.
 *
 * That difference is a real cost and it is written down rather than hidden: a class mixing an
 * installed app with a browser has two conversations that cannot see each other, and both look
 * like they are working. Nobody is on an installed app today — it has never been published —
 * so nothing is paid for it yet. It comes due the day the app reaches a store, and that is on
 * the pre-launch checklist in ISSUES.md. See .agents/memory/one-chat-per-class.md.
 */
export function showsOwnChatTab(platform: string): boolean {
  return platform !== "web";
}
