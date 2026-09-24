# Self-hosted LiveKit is a preview experiment, not a production migration

24 September 2026: owner requested self-hosted LiveKit preview to learn if operating it is manageable,
while retaining Fadko's architecture and all queued work. Production remains on LiveKit Cloud; no
purchases approved. Start from the current classroom release, not the older root checkout.

The existing LiveKit provider already accepts a self-hosted URL/key pair. Keep auth/membership,
teacher media permissions, whiteboard/chat, attendance and payments in the existing application.
Preview hosting is a separate Linux media VM with UDP and TURN/TLS, not another normal web Worker.
Do not change staging provider variables during an active test class; one API process has one
LiveKit destination and changing it mid-call splits rooms/moderation. Save all five old staging
settings privately and switch/roll back together after ending test calls.

Setup and owner runbook: `infra/livekit-preview/README.md`. Verification and exact activation state:
`.agents/worklog/2026-09-24-codex-livekit-self-host-preview.md`. Never infer a running VM from generated
configuration or passing localhost media tests. Host, domain and budget choice precede activation.
Keep make-up/quiz/support/cold-refresh follow-ups in the existing backlog for the next product pass.
