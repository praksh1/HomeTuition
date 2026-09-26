# Fadko video: near-zero-cost launch plan

Checked 24 September 2026. USD unless stated. This is a decision report, not a purchase or a claim about your actual bill. No server, domain, account upgrade or payment method was purchased/configured.

## Recommendation

Keep the working LiveKit Cloud production service. Try an Oracle Always Free server **only as an isolated preview**, with free DNS names. Do not move paying classes onto it until the public-network, recovery, moderation/security and real-device tests pass. If Oracle has no free capacity, wait or continue Cloud testing; do not quietly substitute a paid VM.

“Free video” is not “the whole app is free”: Railway API, database, file storage, email and any AI usage remain separate. Their current invoices have not been audited here.

The prepared self-host pilot covers the current web classroom, including iPhone/Android browsers and laptops. It does not silently migrate installed native apps, which still have a separate Daily SDK path; that migration needs a separate build and test pass. The whiteboard, saved work and Fadko API remain on their existing services.

The read-only LiveKit dashboard check reached a sign-out screen instead of project usage. No sign-out was submitted and no plan/account setting changed. Actual remaining allowance is therefore unverified; the calculator uses published plan allowances, not your account balance.

## Also check legitimate startup credits

LiveKit's [Startup Program](https://livekit.com/startups) currently offers approved startups a year of waived Cloud Scale base fees and $10,000 additional Cloud credits, expiring after 12 months or depletion. Its advertised total also includes separate partner inference credits, not interchangeable video credit. Requirements include incorporation/active incorporation, an identifiable founding team on a live website, early-stage size/funding limits and near-term launch. Existing free-plan projects may apply; acceptance is not guaranteed. Enrollment requires a card and Scale checkout. Do not activate it without checking overage/expiry billing and obtaining approval. No application was submitted. The owner confirmed **not yet incorporated** on 24 September; exclude these credits from the launch budget for now.

This may be more useful than changing infrastructure solely to save money. It does not prevent learning self-hosting on an isolated free preview.

## Options

| Option | Incremental video hosting cost | What to know | Decision |
|---|---:|---|---|
| LiveKit Cloud Build | $0 within allowance | 5,000 participant-minutes, 50 GB downstream, 100 concurrent connections | Keep for initial testing |
| Oracle Always Free ARM VM | $0 **if eligible resources are available** | Current docs: 2 OCPUs / 12 GB total, 200 GB combined disk and 10 TB monthly outbound; free capacity and continued availability are not guaranteed | Best zero-cost self-host preview candidate |
| Hetzner Europe CX23 | $6.49/month **before** IPv4/tax/extras | Cheap, but Nepal latency must be measured; this price is not a capacity guarantee | Paid fallback, not ordered |
| Hetzner Singapore CPX12 / CPX22 | $17.99 / $30.99/month **before** IPv4/tax/extras | Closer geography is worth testing; not automatically better on every Nepal ISP | Later regional comparison |
| LiveKit Cloud Ship | $50/month plus usage above included amounts | 150,000 participant-minutes and 250 GB downstream included; $0.0005/minute and $0.12/GB above these | Managed alternative once revenue supports it |

Sources: [LiveKit pricing](https://livekit.io/pricing), [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Hetzner June 2026 pricing](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/).

LiveKit's free allowance is a hard limit, shared across the user's free projects; extra projects do not multiply it. It resets monthly. Exhaustion can refuse new requests, so this is not an unlimited free production plan. [LiveKit quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/)

Oracle may reclaim an idle free VM after a seven-day low-utilization period. Do not manufacture load to evade that rule. Region capacity may prevent signup/provisioning; confirm the Console's Always Free eligibility and estimate before creating anything. Older tutorials quoting 4 CPUs / 24 GB do not match the current page. A single VM also has no failover when it reboots. [Oracle conditions](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

The preview kit's pinned [LiveKit v1.13.6](https://hub.docker.com/v2/repositories/livekit/livekit-server/tags/v1.13.6) and [Caddy L4 v2.11.3](https://hub.docker.com/v2/repositories/livekit/caddyl4/tags/v2.11.3) both list `linux/arm64` images. This verifies image availability for ARM, not a successful Oracle deployment or capacity test.

Hetzner Singapore includes 0.5–5 TB transfer depending on the plan and quotes $8.49/TB extra. Confirm the **specific** selected plan's allowance, IPv4, backups and tax at checkout; the base price alone is not the bill. [Singapore transfer pricing](https://www.hetzner.com/cloud-singapore/)

## What a classroom actually consumes

These are our planning calculations, not provider quotes or measured Fadko traffic. Assume one teacher, the listed students, one-hour lessons, no recording and **one 1 Mbps teacher stream delivered to each student**. Add a conservative 20% transfer allowance for planning. Additional student cameras, screen sharing and quality levels change the result substantially.

- Participant-minutes = (students + teacher) × lesson hours × 60.
- Downstream GB ≈ students × hours × Mbps × 0.45 × 1.20 (decimal GB).
- Whiteboard/PDF traffic is separate app traffic, not automatically charged as LiveKit video.

| Example per month | Participant-minutes | Estimated downstream | Cloud Build fits? |
|---|---:|---:|---|
| 1 student, 10 lesson-hours | 1,200 | 5.4 GB | Yes, under these assumptions |
| 5 students, 10 lesson-hours | 3,600 | 27 GB | Yes |
| 20 students, 4 lesson-hours | 5,040 | 43.2 GB | No: minutes exceed free allowance |
| 20 students, 20 lesson-hours | 25,200 | 216 GB | No; modeled Ship cost $50 before tax/extras |
| 20 students, 60 lesson-hours | 75,600 | 648 GB | Modeled Ship cost $97.76 before tax/extras |

At 2 Mbps, the last row's estimated transfer doubles to 1,296 GB and its modeled Ship bill becomes $175.52. This is why **concurrent rooms, hours and delivered video bitrate**, rather than registered-user count, determine hosting cost. 1,000 signed-up users who rarely attend can cost less than 20 students attending daily.

At the assumed bitrate, one 20-student room requires roughly 24 Mbps outbound including the allowance; three simultaneous rooms roughly 72 Mbps. This does **not** prove a small VM can run them: CPU, packet rate, relay traffic and ISP quality must be load-tested.

## Do we need to buy a domain?

Not for the preview. DuckDNS offers free subdomains; two available names can identify signaling and TURN, for example `fadko-preview-<unique>.duckdns.org` and `fadko-turn-preview-<unique>.duckdns.org`. These are examples, not reserved names. [DuckDNS](https://www.duckdns.org/why.jsp)

The preview kit already provisions certificate automation once public DNS and network access are valid. Free DNS adds another external dependency and is not a branded production domain. If using Cloudflare DNS later, use DNS-only records for this direct media server; normal proxied DNS handles HTTP/HTTPS and is not a general-purpose UDP relay. [Cloudflare proxy behavior](https://developers.cloudflare.com/dns/proxy-status/)

## Sensible spending and launch gates

1. **Now: $0 additional target.** Keep Cloud production; review its Usage page weekly while testing. Start planning a transition at 70% of either monthly allowance, before classes depend on the last few minutes.
2. **Free preview:** create an Oracle account only with the owner's involvement for identity/card/terms. Choose an eligible nearby home region after checking availability. Create only free resources; no paid upgrade, trial-only substitute, public admin console or recording service.
3. **Prove it:** iPhone + Android + laptop, home Wi-Fi + mobile networks, UDP-blocked TURN fallback, reconnect, reboot, restore, simultaneous classes and two-hour stability. The existing Linux/real-media CI tests are useful but do not prove these public-network conditions.
4. **Security before migration:** self-hosted LiveKit lacks Cloud's token-revocation behavior. Test old/refresh-token reuse after mute, removal and class end, and enforce admission before admitting real students. Keep Cloud until this is resolved. [LiveKit token revocation](https://docs.livekit.io/frontends/reference/tokens-grants/)
5. **Later investment:** get an exact VM quote and compare observed transfer/maintenance against managed Cloud. Explicitly approve any monthly ceiling first. Never rotate free accounts or bypass quotas.

Self-hosting trades the service invoice for operational responsibility: operating-system patches, certificate renewal, monitoring, backups, incident response and capacity planning. My recommendation is to learn those on preview while preserving the working production experience.
