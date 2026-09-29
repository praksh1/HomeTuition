# Cost & Health — owner dashboard redesign

- Date: 2026-09-29
- Agent: Codex with chart-data and browser-QA agents
- Branch: codex/owner-cost-health-release
- Base: e3ce313 (verified origin/main)
- Status: complete; redesigned frontend deployed to Production

## Requested

Owner rejected the dense Cost & Health page and requested a premium investment-dashboard-style experience, comparable in clarity to financial apps. Preserve actual data, owner privacy, existing alerts, and no-purchase boundary.

## Changed

- Separated Overview, Providers, Alerts and Settings; persistent navigation, compact header, responsive main/side panels, provider watchlist, service pulse, and reduced setup prose on the overview.
- Added an actual-recorded-usage chart with 1D/7D/30D filters, explicit empty state, point details and no fabricated zero, filled-in trend or unsupported percent change.
- Provider rows expand into existing usage/connection details. Settings contain budgets, delivery checks and refresh methodology instead of overwhelming the landing view.
- Settings failure now preserves editing state and clears owner authorization on a 403.

## Decisions and assumptions

- Existing light-only Fadko palette retained. No copied Robinhood branding or invented financial results.
- Historical aggregates lack provider membership/billing periods: chart uses markers rather than implying comparable spend growth. Server returns latest 48 checks, so range filters do not promise complete history.
- Four per-provider warning targets remain; no inferred USD 60 total, LiveKit budget, hard caps, purchases or new credentials.
- Existing 60-second cache / 5-minute provider-check cadence retained. No faster billing polling or new service costs.

## Verification

- Before editing: clean checkout; origin/main and HEAD e3ce313.
- All workspace package typechecks and design lint pass; no new hardcoded color/type leaks.
- Chart helper: 14/14 focused tests, including missing/invalid/future/stale readings, genuine zero, time windows and reset boundaries.
- All 582 app unit tests pass. Production-targeted web export passes and verifies the exact production API and Fadko name.
- 612 isolated browser checks pass at 320/390/768/1440 px, repeated after final chart-sizing adjustment. Tests cover coordinate taps, clipped ancestors, navigation, empty data, 1D/7D/30D filters, selected-reading identity during polling, grouped-source labels, settings, denial before reads and after a settings 403, and unchanged refresh cadence. All API responses in this suite are synthetic; no real email/settings changes.
- Phone and desktop screenshots inspected; final screenshots are in the local temporary `sikshya-cost-health-OOt4EK` folder. They contain labelled synthetic test-account data, not the owner's actual bill.
- Cloudflare dry-run passes on the existing production Worker configuration.
- Production Worker `hometuition` version `45c346af-314d-4afd-8306-26ef1fb63518` serves the tested source implementation `5fa18d3`. `node scripts/verify-owner-cost-health.mjs` confirms all three exact deployed bundle hashes, production API target, new dashboard labels and live anonymous owner-data rejection. No backend changes or new provider calls/email tests were needed for deployment verification.

## Problems and surprises

- Signed-in browser tool still fails at initialization (kernel-assets path missing). Browser validation uses the existing isolated app test harness with synthetic API data, not the owner's signed-in session.
- First rendered check caught a clipped empty-chart button at 320 px and cramped heading; corrected with content-driven height and concise headings. SVG plot dimensions now match rendered width, avoiding stretched point markers.
- Review caught provider-group mislabelling and index-based selection drift; grouped rows now show source coverage, open the represented source and retain chart selection by reading identity.
- An intermediate harness run overlapped a replacing web export and was interrupted. Final tests run against a completed stable export. Initial cadence assertion was corrected to allow the next polling tick after the five-minute minimum rather than demanding an exact wall-clock instant.

## Fabrications found

No invented usage or demo values introduced. Synthetic values remain confined to tests.

## Deliberately not changed

Provider integrations, server billing behavior, owner-access policy, plans, quotas, unrelated Preview features, and customer screens.

## Remaining risks / next pickup point

Dashboard redesign is deployed and verified at the existing `/cost-health` URL; refresh an already-open page to load it. Existing missing provider credentials remain separate from the layout work; dollar coverage is not complete. Chart histories cannot yet establish same-provider billing trends. No full-app payment/classroom regression rerun or physical iOS/Android device validation is claimed for this owner-only UI change. Full workspace compile, app unit tests and responsive owner-browser checks passed. The prior complete CI workflow failed its unrelated app-against-server gate; this manual frontend release does not claim that full workflow passed.
