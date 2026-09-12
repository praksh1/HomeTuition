# Preserved teacher plans — do not delete active contracts

The owner approved moving NEW teaching offers toward the existing 70/30 commission contract
on 11 September 2026. No separate teacher subscription is planned for that new product.

Recoverable source:
- `artifacts/sikshya/components/legacy/LegacyTeacherPlans.tsx`: original tier storefront, preserved.
- `artifacts/api-server/src/lib/tierLimits.ts`: existing paid-class allowances (still enforced).
- `artifacts/api-server/src/lib/monthly.ts` and `monthlyStore.ts`: existing recurring contracts.
- `artifacts/sikshya/app/(teacher)/monthly.tsx`: existing class management, NOT archived/removed.
- `monthlyPortal.ts`, `portalAccess.ts`, `monthly-homework.tsx`, `monthly-chat.tsx`: retained.
- Git release `357c222` preserves the complete pre-transition tree.

New legacy teacher-plan sales default paused outside NODE_ENV=test. Explicit server configuration
`LEGACY_TEACHER_PLAN_SALES=enabled` restores the preserved sale path; `paused` overrides even tests.
This switch does NOT enable new-class checkout or change existing entitlements, membership, refunds,
student charges, balances or teacher approval. Do not change NODE_ENV to test on a live service.

Remaining implementation: paid batch contracts and atomic checkout; purchased-lesson sessions mapped
through the canonical membership service; group homework/chat with per-enrollment history permissions;
funding and payout reconciliation. One paying student is NOT permission for other students to enter.
Archived code is not a hidden second billing engine and must not charge both subscription and commission.
