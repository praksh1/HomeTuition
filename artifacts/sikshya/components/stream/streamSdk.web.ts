import type { StreamSdk } from "./streamBridge";

/**
 * The web loader — where Stream would actually be tried first.
 *
 * The web has none of the native trouble: a browser already has WebRTC, so
 * `@stream-io/video-react-sdk` is ordinary JavaScript and can sit beside `@daily-co/daily-js`
 * with nothing to collide. The blocker on a phone — two forks of `react-native-webrtc` claiming
 * the same native module, see `streamSdk.ts` — simply does not exist here.
 *
 * It is still not installed, and the reason is the people this product is for. Adding the SDK to
 * `dependencies` puts it in the bundle every student downloads over a Nepali mobile connection,
 * for a provider that is switched off. Dead weight on that connection is a real cost paid by
 * real people for an experiment none of them asked for.
 *
 * So the wiring is written and the dependency is not taken. Everything the integration actually
 * does lives in `streamSession.ts` — `createStreamSdkFrom` builds the client, joins the call and
 * maps it onto this app's own session — and is driven in tests by a fake module, which is how
 * the behaviour that matters is checked without an account: that the token is used exactly as
 * the server minted it, that no secret is anywhere near the client, that joining never creates a
 * call, and that leaving closes the socket.
 *
 * ### Turning it on
 *
 * One dependency and one function body, both spelled out in STREAM.md:
 *
 * ```
 * pnpm --filter @workspace/sikshya add @stream-io/video-react-sdk
 * ```
 *
 * ```ts
 * const mod = await import("@stream-io/video-react-sdk");
 * return createStreamSdkFrom(mod as unknown as StreamClientModule, {
 *   VideoView: webParticipantView(mod),   // wraps its ParticipantView
 *   listDevices, selectDevice,            // the browser can enumerate both
 * });
 * ```
 *
 * Nothing above this file changes, on either platform.
 */
export async function loadStreamSdk(): Promise<StreamSdk> {
  return {
    ok: false,
    reason:
      "Stream video is not built into this app. The Stream web SDK is not installed — it is " +
      "one dependency away and would not conflict with Daily, but it is deliberately left out " +
      "so it does not ship in the bundle students download. See STREAM.md. The class is " +
      "running on Daily; nothing here is broken.",
  };
}
