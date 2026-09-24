# Self-hosted LiveKit preview — activation and migration gates

Owner priority from 24 September: learn self-hosting privately while preserving the accepted classroom
and all earlier queued tasks. No purchases or production switch authorized by this request.

- [x] Inspect the current provider and keep the existing SDK/auth/membership/classroom architecture.
- [x] Separate preview branch and no-deploy CI; generated private key pair, namespace, TLS/TURN VM
  configuration, operator helper, safe diagnostic and step-by-step rollback/runbook.
- [x] Standalone verification passed at `05ea6c1`, run `36019725512`: 21 kit checks,
  pinned-image/Caddy validation, generated non-dev SFU/authenticated probe, 48 real-media checks,
  and 78 full-classroom permission/reconnect checks. No public-host claims from localhost tests.
- [ ] Owner selects an existing Linux VM (public IPv4/UDP), two controlled preview domains, region
  and any hosting budget if needed. Never infer a $0 long-term allowance from an advertised trial.
- [ ] Restrict host/provider firewall, verify external DNS and trusted TLS on both names.
- [ ] Verify real external media AND TCP-443 TURN fallback across laptop/phone/cellular.
- [ ] End preview test calls, privately save current Cloud values, stage all five preview variables
  together, and verify Fadko's complete synthetic classroom through the self-hosted server.
- [ ] Rehearse VM reboot, outage recovery and a return to Cloud. Record time and owner difficulty.
- [ ] Measure resource use and egress at target concurrency; decide if savings justify maintenance.
- [ ] Before ANY real-user/production migration: cached/refreshed-token replay after revocation,
  removal, suspension and class end, media admission enforcement, backup/restore drill, monitoring,
  incident ownership, capacity evidence and explicit production rollout approval.

No automatic failover: an environment-variable change does not move existing media rooms. No recording
or third-party evidence analysis added. Native apps remain a separate video SDK migration decision.

Earlier make-up/remedies, quiz drafts, support enhancements and Messages cold-refresh issue remain in
`2026-09-24-teacher-studio-and-remedies.md` and `2026-09-24-classroom-followups.md` for the next product pass.
Technical setup: `infra/livekit-preview/README.md`; evidence: the matching worklog.
