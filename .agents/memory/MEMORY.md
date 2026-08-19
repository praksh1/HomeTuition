# Memory Index

- [Expo native-tabs nav pitfall](expo-native-tabs-nav.md) — NativeTabs only register tab triggers; non-tab pushed routes silently no-op on iOS.
- [AuthGuard async-redirect role-cast crash](authguard-role-cast-crash.md) — guard role-specific screens; a wrong-role user renders briefly before the effect redirects.
- [Expo tabs absolute bar overlaps full-screen screens](expo-tabs-overlap.md) — absolute-positioned tab bar covers classroom chat/input unless tabBarStyle display:none is set per screen.
- [WebView on Expo web](webview-expo-web.md) — react-native-webview renders nothing on Platform.OS==='web'; needs a graceful Platform.OS check fallback.
- [Daily Prebuilt embed pattern](daily-embed-pattern.md) — platform-split component (DailyIframe.createFrame on web / WebView loading room URL on native); `left-meeting` event for lifecycle sync; `iframe.allow` required on web for iOS Safari; theme via createFrame options on web and CSS var injection on native.
- [Expo mobile artifact web publish](expo-mobile-web-publish.md) — default mobile-kind build/serve targets Expo Go landing page, not a browser site; swap to `expo export -p web` + static serve for a real testable link.
- [Lazy ghost-session expiry](lazy-ghost-session-expiry.md) — expire stale "live" sessions on read, but measure from `startedAt`; using the scheduled date let a student's page load end their teacher's class.
- [Free follow vs paid subscription](free-follow-vs-paid-subscription.md) — keep a teacher's own paid subscription tier separate from a student's free "follow" relationship; don't overload one table for both.
- [Drizzle group-by aggregation errors](drizzle-group-by-aggregation.md) — grouped SQL aggregates (array_agg + case + filter) can fail at runtime despite compiling; prefer JS aggregation for small per-user datasets.
- [iOS WebView WebRTC + file picker gotchas](ios-webview-webrtc-filepicker.md) — inline HTML WebViews block WebRTC on iOS; native camera/mic perms must be granted before mount; mixed image+PDF accept forces Files app over Photo Library.
- [expo-notifications permission type mismatch](expo-notifications-perm-type.md) — duplicate expo-modules-core versions make NotificationPermissionsStatus fields inaccessible via normal property access; cast through `unknown` to bypass structural type check.
- [scripts package rootDir fix](scripts-rootdir-fix.md) — scripts/src/seed.ts must import lib/db via `@workspace/db/schema` (workspace package), not a relative `../../lib/db/src/` path; the latter violates rootDir and breaks tsc typecheck.
- [origin points at the wrong repository](git-remote-is-hometuition.md) — on the owner's Windows copy `origin` is the abandoned Paathshala repo and work goes to the `hometuition` remote; a fresh clone has one correct `origin`. Run `git remote -v` before pushing.
- [Setting PAYMENT_WEBHOOK_SECRET will break every booking](payment-mode-trap.md) — payment mode is inferred from config; no provider is integrated yet, so setting it declines every booking.
- [Daily's built-in chat is disabled on purpose](one-chat-per-class.md) — re-enabling it splits a mixed browser/phone class into two conversations that cannot see each other.
- [FamilyDoc is a separate project on the same machine](familydoc-sibling-project.md) — a second Nepal product at C:\Projects\FamilyDoc with no remote; don't confuse the two working copies.
