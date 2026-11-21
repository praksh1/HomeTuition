# LiveKit portable endpoint increment - November 21, 2026

Owner: this LiveKit chat, 01a1e6cd-a6bb-7c02-bdb9-b901e65f09dc. One writer with two independent read-only reviews. Main Fadko remains the Dallas runtime owner.

Base feature commit: 445f61c7bbf78ff605bb4f552380f9aa00e9f6ea. Production source main remains f9b0506f3d424e4aeaf0f86366eab4bfa8722432. This is source ancestry, not proof of served API/frontend bytes.

The owner explicitly approved a separate 15-minute source-sync check. Automation fadko-livekit-production-sync is ACTIVE in this chat. It checks refs, waits for active writers/dirty attempts, brings forward reviewed main changes through ordinary non-force integration, and verifies actual branch CI. Other schedules were preserved. No deployment or spending is authorized by the heartbeat.

Blocked journey addressed: safely select a Cloud or self-hosted endpoint when moving regions, and diagnose configuration without exposing credentials pasted into malformed URLs or arbitrary SDK errors. The adapter and diagnostics now share livekitEndpoint.ts. It accepts credential-free root WSS origins and explicit loopback WS development origins, canonicalizes the address, and derives matching HTTPS/HTTP RoomService origins. Invalid settings produce no token or RoomService operations. Namespace, identity, audience grants, TTL and room lifecycle stay as production implemented them.

Finite local acceptance: endpoint.test.mjs passed 5 tests, 0 failures/skips/cancellations, Node 24.22.1. Start 2026-11-21T21:18:42.2447941Z; end 2026-11-21T21:18:42.5687455Z; process duration 319 ms, TAP duration 193.3131 ms. Two reviewers accepted exact source hashes before execution. Test hooks substitute fixed synthetic SDK/logger modules and reject unexpected source dependencies. No installed SDK, provider network, application startup, database or listener was used. Runtime files are under the chat's .tmp/livekit-endpoint01. Full before/after bytes, hashes, review and raw TAP are preserved outside Git at .agents/changes/2026-11-21-livekit-endpoint01.

The public standard-runner branch workflow now also executes the endpoint tests with Node type stripping. Its gate detects module.registerHooks rather than assuming every newer major supports it. Existing deploy-web main guard and feature preview exclusion remain intact. Other inherited workflows target different branches. Hosted execution must be verified on the exact published candidate; a skipped job does not pass.

Still held: productionReady:false; explicit room creation for the auto_create:false pilot; teacher End, Reopen generation and old-token/rejoin races; real SDK/provider and public direct/TURN media; installed Android/web interoperability; actual Nepal Wi-Fi/mobile calls; free Cloud versus Dallas comparison. The endpoint tests qualify only the reviewed source behavior with synthetic SDK responses. Do not infer live classroom, deployed parity, quality or capacity from them.

Next product increment must design room creation and lifecycle against actual authorized session state with finite acceptance and independent review. Do not enable the generated pilot profile for application traffic until those prerequisites pass. Keep the current production provider selection unchanged and keep all work free.
