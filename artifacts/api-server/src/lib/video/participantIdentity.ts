/**
 * Turning a Sikshya account into an identifier a video provider will carry.
 *
 * ## Why this is its own file
 *
 * It is the one rule in the token path worth testing on its own, and pure and import-free so it
 * can be — `lib/daily.ts` reaches for a logger and the network, and a rule that needs either is a
 * rule nobody exercises.
 *
 * ## Identity, never permission
 *
 * The id below travels in a meeting token so the provider can echo it back on the webhooks it
 * sends, which is the only way `participant.joined` can name an account instead of describing
 * "somebody with moderator rights". **It grants nothing.** Rights are decided by this server's own
 * membership check in `lib/membership.ts` and expressed as `isOwner`; see VIDEO.md.
 */

/**
 * Daily caps a token's `user_id` at 36 characters.
 *
 * A Sikshya user id is an integer, so the cap is academic — but a silently truncated identifier
 * would correlate a provider event to the *wrong* account, and a confidently wrong attribution in
 * a refund argument is worse than an honest blank. So anything that would not fit is dropped.
 */
export const PROVIDER_USER_ID_MAX_LENGTH = 36;

/**
 * The string a provider should carry for this account, or null when there is nothing safe to send.
 *
 * Null for a non-integer, a zero or a negative — none of which is a real account id, and all of
 * which would put a meaningless value on an evidence row that an operator later reads as a person.
 */
export function providerUserId(userId: number): string | null {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  const asString = String(userId);
  return asString.length <= PROVIDER_USER_ID_MAX_LENGTH ? asString : null;
}
