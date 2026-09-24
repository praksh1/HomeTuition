# Fadko self-hosted LiveKit preview

Status: **setup kit, not an activated public server**. Production stays on LiveKit Cloud.
This is a small, single-server rehearsal to learn the operational work before deciding to migrate.
It is not a promise of free hosting, automatic failover, or production-scale capacity.

## What changes — and what does not

Only the **preview API's LiveKit address and credentials** will change after the host passes testing.
The same LiveKit SDK and premium classroom UI remain. The whiteboard, class messages, attendance,
saved work, membership checks, booking/payment rules and teacher-controlled microphone/camera
permissions remain in Fadko's existing Railway API/Neon/storage architecture. They do not move into
the video server. No database migration, app redesign, new recording service or production key reuse.

Desktop browsers, iPhone Safari and Android browsers follow this path. Installed native apps are
**not** silently migrated: the current provider declares web support only and native builds still
have the separate Daily SDK path. Native-app migration needs its own build/test decision.

## What we need from you before putting it online

1. An existing Linux VM/server with a public IPv4 address, SSH access and a provider that permits
   inbound UDP. A dedicated Ubuntu 24.04 host is the proposed first target; host access is not
   currently available to this task. Do not use the production API machine.
2. A domain you control with two unused subdomains, such as `livekit-preview.YOUR-DOMAIN` and
   `turn-preview.YOUR-DOMAIN`. These are examples, not addresses we have registered.
3. Host region and a spending limit, **if obtaining a host would cost money**. No host, domain,
   paid networking feature or plan has been purchased or provisioned by this kit.

For a small rehearsal, a 2-vCPU/4-GB VM is a starting *test budget*, not a certified capacity promise.
Choose a region near the intended testers; measure actual phones and networks. Video bandwidth and
CPU, especially everyone-on-camera, must be measured before deciding whether self-hosting is cheaper.
Free allocations may be unavailable, reclaimed or exceeded. Never assume an indefinite $0 server.

Railway keeps running Fadko's application backend. Its ordinary public HTTP/TCP service is not the
deployment target for this UDP VM bundle. Cloudflare continues hosting Fadko's frontend and may
serve DNS; the normal orange-cloud HTTP proxy is not used for these media hostnames.

## Stage 1 — prepare the private bundle (does not deploy anything)

Technical operator instructions; the founder can have Codex do these once the host/domain are chosen.
On Windows, open a terminal in the repository worktree:

`C:\Users\missk\OneDrive\Documentos\ChatGPT\HomeTuition (Claude)\.worktrees\classroom-production-sep24`

Then, substituting the **real approved** subdomains:

```powershell
node infra/livekit-preview/generate.mjs --domain livekit-preview.YOUR-DOMAIN --turn-domain turn-preview.YOUR-DOMAIN
```

The private bundle appears under `.local/livekit-preview/<domain>/` and is ignored by Git.
It contains two containers (LiveKit and Caddy), separate random credentials and a preview-only
Railway settings file. Existing bundles are never overwritten: rerunning cannot silently rotate keys.
The generated folder is sensitive. Do not attach it to a ticket/chat, commit it, or upload it to
Actions artifacts. Windows file mode bits do not restrict ACLs; keep it in your private Windows
account and transfer directly to the VM. This checkout is under OneDrive—avoid generating real
credentials here if that folder is shared; generate directly on the private VM instead.

There is no Redis, recording, ingress, Kubernetes or automatic updater in this first single-node
pilot. Fixed versions make the test reproducible: LiveKit `v1.13.6`, Caddy-L4 `v2.11.3`.

## Stage 2 — host, DNS and firewall (before starting)

Install Docker Engine plus its Compose plugin using the provider's supported Ubuntu image or
[Docker's official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Copy the generated folder privately to `/opt/fadko-livekit-preview` on that VM. Keep the directory
owner-only (`700`), secret files owner-only (`600`), and use SSH keys, not a public password login.

For Cloudflare DNS, open the selected domain → **DNS → Records → Add record**. Create two **A**
records using the approved preview labels and the VM's public IPv4. Set **Proxy status: DNS only**
(gray cloud) for both. Do not edit production records. Do not publish AAAA records unless IPv6 routing,
firewall and media have also been tested. Wait for both hostnames to resolve to that VM.

Review BOTH the provider's firewall/security group and the VM's firewall. Rules for this bundle:

| Inbound traffic | Who may reach it | Purpose |
|---|---|---|
| TCP 22 (or the configured SSH port) | Your administrator IP only | Server management |
| TCP 80 | Internet | Automatic certificate issuance |
| TCP 443 | Internet | Encrypted signalling and TURN/TLS, separated by hostname |
| TCP 7881 | Internet | Direct media TCP fallback |
| UDP 3478 | Internet | Authenticated TURN/STUN |
| UDP 50000–60000 | Internet | Direct audio/video media |
| TCP 7880, 5349, 2019 | **Never public**; local host only | Internal signalling, decrypted TURN hop, Caddy admin |

Host networking means Docker's usual port mapping does not protect these listeners. Keep default
inbound deny and explicitly allow the table's public ports; do not open all ports. Preserve SSH
access while changing rules. The helper intentionally does not rewrite firewalls or reboot machines.
TURN's internal TCP 5349 is behind Caddy's TLS 443 listener; it must not be directly exposed.

On the dedicated Linux VM, in `/opt/fadko-livekit-preview`:

```sh
bash previewctl.sh start --firewall-reviewed
bash previewctl.sh status
```

Caddy automatically obtains publicly trusted certificates for BOTH names. No self-signed
certificate, private CA bypass or TLS-verification disablement belongs on the public preview.

## Stage 3 — check before switching Fadko preview

From the Windows repository worktree (with existing pnpm dependencies installed):

```powershell
node infra/livekit-preview/probe.mjs --file .local/livekit-preview/REAL-PREVIEW-DOMAIN/railway-staging.env
```

This private diagnostic checks trusted TLS and an authenticated, read-only LiveKit API request.
It displays aggregate room count, never room names, keys or tokens. It refuses non-preview settings
and times out instead of spinning forever. A green API check **does not prove audio/video**.

Before switching, privately record the CURRENT staging values for `VIDEO_PROVIDER`, `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `VIDEO_ROOM_NAMESPACE` in a password manager. No key in
screenshots or worklogs. End active preview classes; this is a planned test interruption, not a
seamless mid-call migration. The existing integration has one LiveKit destination per API process;
hot-switching it with callers present would split rooms and send moderation to the wrong server.

In Railway, select the existing **staging API service**, verify its domain is
`hometuition-api-staging-production.up.railway.app`, then **Variables**. Stage only the five values
from `railway-staging.env` together and deploy once. Do NOT select
`workspaceapi-server-production-5a63.up.railway.app`. The word `production` inside the staging
service's generated hostname is not permission to touch the actual production API.
Do not change the database, frontend API URL, payments, Cloudflare Worker or native SDK.

Open the preview support desk's existing video diagnostic card. It checks the deployed API, while
the command above checks from the operator machine. Legacy diagnostic copy may refer to LiveKit's
Cloud dashboard; for this deployment credentials belong to the VM's private bundle instead.

Then test a new synthetic Fadko class:

- Teacher laptop ↔ student iPhone Safari, then teacher phone ↔ student laptop/Android browser.
- Wi-Fi ↔ cellular (not only two devices on the same Wi-Fi). Check audible speech and moving video.
- Block direct UDP in an isolated tester network/browser setup and verify **TURN/TLS relay media**
  on TCP 443 using WebRTC selected-candidate stats; seeing the call tile is insufficient.
- Student starts audience-only; raised hand, teacher grant, explicit student unmute, revoke,
  camera request and teacher mute-all still work. Grant must never activate a device automatically.
- Reload/reconnect, hide/show call, screen share, page changes, PDF/image restoration and in-class chat.
- End class; check no unexpected join after cutoff, no cross-environment room access, and no orphan call.
- Rehearse a preview VM reboot and recovery with test users, then return to Cloud once to prove rollback.
- Measure CPU/RAM/network egress at intended class size; 50 UI rows are not a 50-person media load test.

## Daily ownership — what you would actually manage

For the founder: keep the hosting provider's browser console available. Open the **preview** Fadko
support desk for the credentials/API check; run a short real call for media confidence. Ask Codex
to inspect server health before any class if anything looks wrong. There is no new unauthenticated
"admin dashboard" exposed to the internet and no pretend green status UI.

The technical operator uses `bash previewctl.sh status` or `logs` in the VM folder. Logs can contain
participant identities—redact before sharing. Check CPU, memory, disk, outbound traffic/bandwidth
allowance and certificate expiry. Container logs are capped at about 30 MB per service; certificate
state stays in `caddy-data`. Back up configs/keys/certificate state encrypted and access-controlled;
these are not lesson/whiteboard backups. Keep SSH access and recovery instructions available.

Updates are manual and rehearsed when no test calls are running. Pin the reviewed new image versions,
run the checks, retain previous versions, then deploy. Do not use `latest` or unattended image updates.
OS security patches, certificates, outages, abuse/DDoS response and capacity are now responsibilities
we own; LiveKit Cloud's regional redundancy and monitoring are not recreated by two containers.

## Rollback — preview only

1. End preview test classes and ask testers to leave. Restore the five saved **staging Cloud** values
   together in Railway → staging API → Variables; deploy. Restore the old namespace too.
2. Run the staging support desk check and a **new** two-device test class. Previously issued self-host
   tokens and ongoing calls cannot be transferred to Cloud. Do not claim seamless failover.
3. Only after Cloud is confirmed and no preview callers remain, run
   `bash previewctl.sh stop --no-active-testers` on the VM. Do not delete the private configs or
   `caddy-data`; they allow resuming the experiment. Production needs no rollback—it never changed.

## Automated checks and limits

`node --test infra/livekit-preview/preview.test.mjs` verifies config, credential isolation, input
validation, non-overwrite behavior and safe diagnostics. The feature-branch workflow validates actual
Docker images/Caddy config, starts a real non-dev SFU with generated credentials, rejects development
keys, and reruns Fadko's existing real-media and teacher-permission/reconnect browser suites.
The disposable CI SFU uses loopback rather than public-IP discovery. Public DNS, ACME certificate
issuance, carrier-network TURN relay, load, VM restart and physical phone checks require the selected host.
No workflow deploys this bundle or reads cloud secrets.

### Security gate before any real-user or production migration

Self-hosting is not security-identical to Cloud: LiveKit documents automatic token revocation as a
Cloud-only feature. A cached/refreshed token can remain usable after removal or a permission change
on a self-hosted server. Fadko starts students as audience and re-applies server-authoritative floor
permissions, but that alone is not evidence that a modified client cannot reuse an older grant.
Keep this first pilot private/synthetic. Before broader rollout, explicitly test cached-token replay
after mute/revoke, account suspension, classroom end and participant removal; design enforcement at
the media admission boundary, including refreshed tokens, and test it. Short TTLs reduce exposure
but are not instant revocation. Do not weaken permissions or call this gate passed because normal
reconnect UI works. [LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/).

## Upstream sources checked 24 September 2026

- [LiveKit VM deployment](https://docs.livekit.io/transport/self-hosting/vm/)
- [LiveKit network ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
- [LiveKit deploy generator source](https://github.com/livekit/deploy/tree/1a7b369f94e3a2f890d366fceeb4f273bf9fb3f6/generate): same SNI/TLS route pattern; this kit adds preview isolation, pinned images, private output and no auto-provisioning.
- [LiveKit v1.13.6 configuration](https://github.com/livekit/livekit/blob/v1.13.6/config-sample.yaml)
- [Railway public networking](https://docs.railway.com/networking/public-networking)
- [Cloudflare proxy limitations](https://developers.cloudflare.com/dns/proxy-status/limitations/)

Related unfinished product work remains in `.agents/backlog/2026-09-24-teacher-studio-and-remedies.md`
and `.agents/backlog/2026-09-24-classroom-followups.md`; this experiment does not mark those complete.
