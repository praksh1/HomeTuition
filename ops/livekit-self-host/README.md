# Fadko LiveKit self-host configuration

This package renders the same single-node pilot for Dallas, India, or Singapore. A location has its own hostnames, region label and credentials. The renderer needs Node.js and uses no packages, network access or credentials. Its outputs target LiveKit **v1.13.11** and Caddy with the **Layer 4** module.

## Production branch baseline

The feature branch is `codex/livekit-self-hosted-production` in `praksh1/HomeTuition`. It begins at the exact Production source branch commit recorded in `production-base.json`. Keep application files based on that branch and record each subsequent synchronized commit. Current deployment metadata identifies `main` as the API source but does not expose its deployed commit. The served frontend revision remains unverified.

Bring forward Production updates through ordinary merges with one writer and a clean checkout. Keep the previous accepted commit and test evidence. Stop on conflicting edits, a Production rollback, source-branch changes, unexpected workflow triggers, or a moved remote feature head. Reconcile the specific changes and test the resulting exact candidate before accepting it. The owner-approved 15-minute source-sync heartbeat is active in the LiveKit Codex chat; it waits while another writer owns this checkout and stays quiet when source refs are unchanged. This schedule depends on the Codex scheduler being available.

The package workflow uses a standard Ubuntu 24.04 runner with its installed Node. It performs offline package checks and verifies that the current `main` is an ancestor. A production update requires another synchronized candidate. Classroom authorization, installed Android/web media, room End and direct/relay quality remain separate acceptance checks. The source receipt records those pending requirements.

The application adapter and diagnostics share one endpoint parser. `LIVEKIT_URL` accepts a root `wss://` origin on Cloud or a self-hosted server, with an optional port. A root slash, surrounding spaces, case and default ports are normalized. Embedded credentials, paths, queries, fragments, control characters and insecure remote `ws://` addresses are refused. Local `ws://localhost`, `ws://127.0.0.1` and `ws://[::1]` remain available for development. RoomService derives its HTTP origin from that same accepted address. Diagnostics redact malformed addresses and raw provider error text. Endpoint tests use synthetic SDK/logger replacements; they do not connect to LiveKit or qualify a real call.

**Dallas status on November 19.** The main Fadko chat has used the server console, passed a private classroom test, and verified trusted HTTPS on the candidate API port. Its hosted classroom launch is in progress. Public media, Caddy Layer 4 availability, and ownership of the ports required by this separate configuration still need verification.

## Render a candidate

Copy `profile.example.json` and replace the example names with two names under a domain you control. Set `region` to the location label. Leave `advertisedIpv4` at `null` to use LiveKit’s public IPv4 discovery. Set it to the assigned public IPv4 if automatic discovery advertises the wrong address. Confirm the address and routing at the host.

```text
node render-config.mjs profile.json dallas-candidate
```

The command creates a new output directory and refuses to overwrite an existing one. A successful render has `livekit.json`, `caddy.json`, and `network-plan.json` written last. Use the network plan to check DNS, the host firewall, and the endpoint the application would use.

The renderer requires IPv4 for media discovery, matching its A records and embedded TURN listener. Profile and output ancestors must be ordinary directories. Symbolic links and Windows junctions are refused.

## Check the Linux host

The preflight inspects the candidate before startup. Give it the generated directory, the actual paths of the two installed binaries, and the IPv4 address assigned by the server provider.

```text
node preflight.mjs dallas-candidate /absolute/path/livekit-server /absolute/path/caddy 203.0.113.25
```

The address above is a documentation example. Supply the host’s assigned address. The script reports software versions, required proxy modules, collisions on planned ports, recursive DNS answers and one memory/CPU/disk snapshot. It reads no signing keys. Each diagnostic child has an eight-second limit, and DNS queries have a bounded deadline. A stuck diagnostic child is terminated. The report includes only listeners that overlap this candidate.

An exit code of zero means these host checks passed. External firewall rules, trusted certificates, actual privilege to bind ports, and call quality still need verification. DNS timeouts and failed observations remain unknown. The DNS check uses the host’s configured recursive resolver. It expects both A records to match the assigned IPv4 and no AAAA record for this IPv4 configuration. The capacity snapshot records available resources at that moment.

The preflight invokes Caddy’s version and module listing commands. Caddy configuration validation provisions modules, so run that later with the deployment owner when the candidate’s resource use is agreed.

## Server checks before the first call

1. Verify the LiveKit release and Caddy build. The proxy needs the `layer4.handlers.proxy`, `layer4.handlers.tls`, and `layer4.matchers.tls` modules. Validate `caddy.json` with that Caddy build before serving traffic. Give its service account write access to `/var/lib/fadko-livekit/caddy` for certificate storage. The service account needs permission to bind TCP 80 and 443, typically through CAP_NET_BIND_SERVICE.
2. Confirm this candidate can own ports 80 and 443 on its public address. On a shared host such as Dallas, first inspect the current listeners and agree on routing for both names. The generated Caddy config is for a public address it can exclusively bind. It cannot be enabled on top of another listener using those ports.
3. Point both DNS-only A records to the candidate. Port 80 serves the certificate challenge. Open TCP 443 and 7881 and UDP 3478 and 7882–7885. Keep TCP 7880, 17880 and 5349 private at both host and provider firewalls. Confirm the actual IPv4 used by the media connection.
4. Generate a new key pair for this host. Store the key-to-secret YAML mapping at `/etc/fadko-livekit/keys.yaml`, readable by the LiveKit service account with mode `0600`. Keep the key and secret in server-side storage. Use LiveKit’s configuration and key file without dev mode. The renderer contains no signing keys.
5. Use explicit RoomService creation for each new test room with a maximum of two test participants. Issue separate short-lived grants limited to that room and identity. Have both test participants verify two-way audio/video, direct UDP, TURN/TLS fallback, and reconnect. For the TURN/TLS check, force relay or make direct UDP, TURN/UDP and direct TCP 7881 unavailable from the tester. Confirm the selected relay protocol is TLS. Verify invalid credentials, unknown rooms, `/whip/v1`, and direct access to private ports are refused. Record the browser, selected route, and observed results.

The public signaling proxy permits the pinned server’s four RTC routes and authenticated RoomService. Its default response denies other HTTP paths. TURN/TLS has its own hostname and uses PROXY v2 on the loopback leg so the relay sees the original browser address. The proxy and LiveKit should run in the same host network namespace for these loopback bindings.

## Move between locations

Render a new profile with fresh signaling/TURN names and signing credentials. Validate the new host while the old host is still available. For a future qualified Fadko integration, change the endpoint and its matching credentials together. The network plan gives `LIVEKIT_URL` and a separate `VIDEO_ROOM_NAMESPACE`. Supply `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` securely on the backend. Keep a matched endpoint, credentials and namespace for rollback.

Schedule the switch between lessons. Stop opening rooms on the old host, let calls finish, and let any cleanup tied to that host complete. Switch every participating API instance and worker to the same new endpoint, credentials and namespace before reopening joins. Reload those processes if they read settings at startup. Verify a new room and both media paths after the switch. If rollback is necessary, drain candidate calls before reselecting the previously validated settings. Active WebRTC connections stay on the host that created the room.

## Qualification for Fadko classrooms

This configuration is for an isolated browser pilot. The older Fadko adapter relies on automatic room creation. It needs an explicit create path before using this profile. Before enabling classroom traffic, the candidate must also prove that Teacher End disconnects both peers, concurrent joins and old or refreshed grants cannot revive an ended room, and Reopen uses a new room. Check ejection from a room that remains open separately. Self-hosted LiveKit’s participant removal leaves existing JWTs valid until expiry. Qualify Android and web together on the selected provider before using it for free beta.

- [LiveKit VM deployment](https://docs.livekit.io/transport/self-hosting/vm/) and [port reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
- [Pinned LiveKit configuration](https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml) and [TURN proxy settings](https://github.com/livekit/livekit/blob/v1.13.11/pkg/config/config.go#L285-L308)
- [LiveKit Caddy template](https://github.com/livekit/deploy/blob/main/generate/templates/caddy.go) and [Caddy Layer 4 proxy](https://github.com/mholt/caddy-l4/tree/master/modules/l4proxy)
- [LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/) and [reported End race](https://github.com/livekit/livekit/issues/4972)
