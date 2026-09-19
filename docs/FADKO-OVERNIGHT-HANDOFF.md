# Fadko overnight handoff

Date: 19 September 2026
Branch: `codex/unified-messages-inbox`

## Current working tree

This tree contains the previously verified message polish plus the first shared premium-shell
slice. It has not been committed or deployed because the Codex approval service is rate-limited
until the morning reset.

### Message polish already verified

- Direct and class conversations settle at the newest message after load and realtime updates.
- Web Enter sends; Shift+Enter keeps a newline; IME composition is not interrupted.
- Inbox filters are one compact `View` menu with counts in parentheses.
- Rendered message checks previously passed 134/134; the full app unit suite now passes 478/478.

### Premium shell in the working tree

- `components/navigation/FloatingTabBar.tsx` is a shared floating capsule for teacher and student
  tabs. It keeps browser links, keyboard-accessible tab semantics, unread badges, safe-area
  clearance, and a capped width for laptops.
- Teacher and student tab layouts now use the shared bar while retaining their existing routes.
- `components/profile/ProfileOverflowMenu.tsx` adds the top-right profile menu with account,
  payments/earnings, notifications, support and logout shortcuts. The AI item is explicitly
  labelled “Coming soon” so the UI never claims an assistant exists before one is built.
- Both profile screens include the same wordmark/menu treatment.
- The profile UI browser gate now includes menu/touch-floor assertions.
- `docs/FADKO-PREMIUM-UX-BLUEPRINT.md` is the product contract for the next premium passes.

## Verification status

- `pnpm --filter @workspace/sikshya test`: **478 passed, 0 failed**.
- `pnpm --filter @workspace/sikshya run lint:design`: **passed; no new leaks**.
- `git diff --check`: clean.
- Typecheck still reports the repository's existing missing dependency junctions in the restricted
  sandbox (`datetimepicker`, `expo-crypto`, social auth, LiveKit). It also cannot run the exact
  Expo/Browser export here because OneDrive junction reads are denied without elevated access.
- The rendered profile/message browser suites should be rerun after the usage reset with the normal
  elevated Preview/CI environment. Do not treat the sandbox export failure as a product failure.

## First actions after reset

1. Run the full app typecheck and the profile, message and navigation browser suites.
2. Inspect 390px, 768px and 1440px screenshots. Confirm the floating bar does not hide the last
   action, the selected tab has one calm blue bubble, and profile menus never clip off-screen.
3. Commit the complete tree with one message, push `codex/unified-messages-inbox`, and deploy only
   Preview.
4. Test as teacher and student: every tab, browser Back, keyboard Tab/Enter, profile menu actions,
   unread message badge, and a long conversation opening at the newest message.
5. Keep Production unchanged until those checks pass.

## Product follow-ons, in order

1. Shared command/search surface for laptop users.
2. Class home information architecture for large rosters (summary, attendance, students, homework,
   materials and messages as separate views).
3. In-window attachment viewer with all PDF pages, zoom, download and authorization-preserving
   previews.
4. Cross-device notification read contract and a visible reconnect state.
5. A real AI support agent only after its service boundary, privacy rules and escalation path are
   approved. Until then, keep the menu item disabled and honest.

## Support assistant handoff

The support audit and provider-independent safety core now live in:

- `docs/FADKO-SUPPORT-ASSISTANT-ARCHITECTURE.md`
- `docs/FADKO-SUPPORT-KB-REVIEW-DRAFT.md`
- `artifacts/api-server/src/lib/supportAssistant.ts`
- `artifacts/api-server/src/lib/supportAssistant.test.ts`
- `artifacts/sikshya/components/support/SupportAssistantLauncher.tsx`

The repository already has `/support`, `/requests`, `/request/:id`, `/disputes`, `disputes`,
`ticket_events`, and the operator desk. The next model should extend those paths rather than
introducing a parallel helpdesk or Supabase. The deterministic core is intentionally not wired to
an AI provider yet: the current API is Express on Railway and the Cloudflare Worker is static
assets with no Workers AI binding. The premium shell is already mounted in both role shells and
the Support/Requests pages now share its visual language. Follow the phased rollout and safety
gates in the architecture document before enabling any provider; the next implementation step is
reviewed FAQ search, not an unbounded chatbot.
