# Video provider decision — expanded research, 2026-08-28

The owner asked for a serious comparison of Daily alternatives, including whether Sikshya
should build the calling system itself. This is a decision document, not an implementation
record. **Daily remains the active provider. No provider migration, account signup, package
installation, or video backend change has been made.** Prices below are public list prices
checked against first-party vendor pages on 2026-08-28; enterprise quotes can differ.

## Executive answer

**Best free experiment and closest practical Daily replacement: Stream Video.** It gives each
account $100 of video usage every month, has maintained React Native/Expo and web SDKs, provides
high-level call UI, and exposes screen share, reactions, raise hand, roles, moderation, and PiP.
Unlike an iframe-style prebuilt, its controls can be composed inside Sikshya's own resizable
window. That directly addresses the collision between Daily Prebuilt and the whiteboard.

**Best managed cost structure for repeated daily classes: Jitsi as a Service (JaaS), subject to
a real cheap-Android test and a 10,000-device quote.** It bills monthly active devices rather
than minutes. The same student attending every day generally counts once, which fits Sikshya
better than participant-minute billing. Its published free tier is 25 devices; the published
plans stop far below the proposed 10,000 daily users, so the large-scale price must be quoted.

**Best low-unit-cost infrastructure if Sikshya later has a video engineer/on-call capability:
Cloudflare Realtime SFU or self-hosted LiveKit.** Both require Sikshya to own the call UI,
signalling/room orchestration, quality policy, monitoring, and incident response. They are not
appropriate as the owner's next solo migration, but they are the credible long-term cost floor.

The recommendation is staged:

1. Keep Daily while the current classroom UI and actual demand are validated.
2. Run a no-production-impact Stream Video proof of concept on cheap Android and web.
3. In parallel, test JaaS on its 25-device free tier and request a written 10,000-MAU quote.
4. Choose between Stream and JaaS using Nepal network tests and the quote, not a marketing demo.
5. Revisit Cloudflare raw SFU or self-hosted LiveKit only after the product has technical
   operations coverage and enough usage for the savings to matter.

## Workload used for comparison

One monthly-tier teacher was modelled as:

| Item                         |                                    Assumption |
| ---------------------------- | --------------------------------------------: |
| Teacher camera               |               one 720p feed at about 1.5 Mbps |
| Class                        |          90 minutes, teacher plus 15 students |
| Classes per month            |                                            26 |
| Participant-minutes          |                     16 × 90 × 26 = **37,440** |
| Student receiving-minutes    |                     15 × 90 × 26 = **35,100** |
| Approximate downstream video |                              **390 GB/month** |
| Repeated unique devices      | about **16**, before multi-device duplication |
| Sikshya revenue assumption   |    NPR 6,500, roughly **US$49/teacher/month** |

The model intentionally matches the product: one teacher publishes video or a screen share and
students primarily consume it. It is not a symmetric 16-camera gallery. Actual camera-on time,
class size, TURN usage, bitrate, device duplication, and concurrency must come from production
telemetry before signing a contract.

## What the serious options cost

Free allowances are account-wide, not per teacher. The "pilot" column shows why a provider may
be useful for experimentation; the scale column does not pretend that allowance repeats for
every teacher.

| Option                           | Public charging unit                                 | Pilot allowance                   |                                     Approx. one-teacher workload after allowance is exhausted | Engineering burden              |
| -------------------------------- | ---------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------: | ------------------------------- |
| **JaaS**                         | monthly active device                                | 25 MAU                            |             roughly **$5–$14** at published small-plan/overage economics; 10k MAU needs quote | low–medium                      |
| **Cloudflare Realtime SFU**      | $0.05/GB egress                                      | 1 TB/month                        |                                           about **$19.50** for 390 GB before shared allowance | high                            |
| **Tencent RTC prepaid**          | $0.87–$0.92/1,000 minutes                            | 10k min/month for first year      |                                                                       about **$32.57–$34.44** | medium                          |
| **Stream Video**                 | received quality: $0.75/1k at 480p; $1.50/1k at 720p | $100/month                        |                              about **$26 at 480p** or **$53 at 720p**, plus small audio usage | low–medium                      |
| **AWS Chime SDK**                | $0.0017 attendee-minute                              | normal AWS free-credit rules only |                                                                              about **$63.65** | high                            |
| **Cloudflare RealtimeKit**       | $0.002 participant-minute                            | none                              |                                                                              about **$74.88** | medium                          |
| **Agora Flexible Classroom**     | starts $2.19/1,000 min                               | 10k min/month                     |                     about **$60** for the first lone teacher, about **$82** without allowance | medium                          |
| **Daily**                        | graduated participant-minute rate, starting $0.004   | 10k min/month                     | about **$109.76** for the first lone teacher; about **$150** before shared allowance/discount | low                             |
| **100ms**                        | $0.004 participant-minute                            | 10k min/month                     |                             about **$109.76** first lone teacher; about **$150** at list rate | low–medium                      |
| **ZEGOCLOUD**                    | $3.99/1,000 HD minutes                               | 10k min/month                     |                             about **$109.49** first lone teacher; about **$149** at list rate | low–medium                      |
| **VideoSDK**                     | $0.004/HD participant-minute                         | one-time $20 credit               |                                                                   about **$150** at list rate | low–medium                      |
| **Azure Communication Services** | $0.004 user-minute                                   | Azure account credits may apply   |                                                                                about **$150** | high                            |
| **Twilio Video**                 | $0.004 participant-minute                            | trial credit                      |                                                                                about **$150** | high                            |
| **Vonage Video API**             | $0.0041 participant-minute                           | new-account promo varies          |                                                                                about **$154** | high                            |
| **Whereby Embedded**             | $9.99/month + $0.004 over 2k included minutes        | 2k min/month                      |                                                                 about **$152** including plan | low on web, weak fit for native |
| **LiveKit Cloud**                | participant minutes plus downstream GB               | 5k min + 50 GB on Build           |                             workload-specific; prior public rates put this around **$50–$60** | medium                          |
| **Zoom Video SDK**               | usage-based participant/session minutes              | published calculator/quote        |                                                         price must be confirmed in calculator | medium                          |
| **Sendbird Calls**               | quote-based                                          | sales-led                         |                                                                 no defensible public estimate | medium                          |

Notes on that table:

- Stream charges by the aggregate resolution a participant **receives**. For this one-way-heavy
  classroom, 35,100 student receiving-minutes cost about $26.33 at 480p or $52.65 at 720p.
  A screen share is another received video track, so simultaneous teacher camera plus screen
  share costs more. The $100 monthly credit can cover a meaningful pilot but is shared.
- JaaS defines MAU as an active **device**, identified in local storage. One student using a
  phone and laptop counts twice; clearing storage can also affect counting. Its published Basic
  example is $99 for 300 MAU and Standard is $499 for 1,500 MAU with $0.99 overage. Applying
  that overage mechanically to 10,000 devices would be $8,914/month, but an enterprise quote is
  the only responsible 10,000-device number.
- Tencent's current 25k/250k/1m top-up packs publish $0.92/$0.90/$0.87 per 1,000 minutes. The
  low price is real, but procurement, data location, Nepal route quality, support, and platform
  risk deserve the same scrutiny as features.
- Cloudflare raw SFU is infrastructure, not a call product. The estimate is egress only. The
  first 1 TB is account-wide, and Sikshya must build and operate everything above the SFU.
- LiveKit Cloud pricing combines participant minutes and data, so the true bill is sensitive to
  simulcast layers and actual delivered bitrate. Confirm the current calculator before a deal.
- Recording, transcription, PSTN/SIP, RTMP/HLS, and storage are excluded because the present
  classroom does not require them. Each is usually charged separately.

## What 10,000 daily users could mean

"10,000 users daily" is not a billable workload until average minutes and concurrency are
known. Two transparent scenarios are more useful:

| Scenario                            | Monthly participant-minutes |
| ----------------------------------- | --------------------------: |
| 10,000 users × 30 min/day × 30 days |               **9 million** |
| 10,000 users × 60 min/day × 30 days |              **18 million** |

Approximate list-price media bills, before taxes and add-ons:

| Provider/model              |                        9m min |                    18m min | Important caveat                                       |
| --------------------------- | ----------------------------: | -------------------------: | ------------------------------------------------------ |
| Tencent prepaid at $0.87/1k |                    **$7,830** |                **$15,660** | package purchase; 10k free is immaterial               |
| Stream at 480p received     |  **$6,650** after $100 credit |                **$13,400** | assumes one 480p received track per participant        |
| Stream at 720p received     | **$13,400** after $100 credit |                **$26,900** | extra simultaneous tracks increase cost                |
| Cloudflare RealtimeKit      |                   **$18,000** |                **$36,000** | managed participant-minute product                     |
| AWS Chime SDK               |                   **$15,300** |                **$30,600** | app must provide the whole call experience             |
| Daily graduated list tiers  |             about **$27,540** |          about **$51,340** | calculated across published graduated bands            |
| Cloudflare raw SFU          |     roughly **$4,500–$5,000** | roughly **$9,000–$10,000** | assumes one 1.5 Mbps received feed; egress only        |
| JaaS                        |            **quote required** |         **quote required** | based on unique monthly devices, not minutes           |
| Self-hosted LiveKit/Jitsi   |        **load test required** |     **load test required** | servers, transit, redundancy, TURN, monitoring, labour |

The Cloudflare raw estimate converts a 1.5 Mbps received stream to about 0.675 GB per user-hour,
then applies $0.05/GB after the shared 1 TB. It is a planning bound, not a quote. The self-hosted
cost cannot honestly be derived from minutes alone: peak concurrent rooms, participants per
room, bitrate layers, TURN percentage, regional redundancy, and incident staffing dominate it.

## Feature and product-fit comparison

### Stream Video — strongest first experiment

Why it fits:

- React Native works with Expo development builds and Android API 24+; web also has a prebuilt
  `EmbeddedCall`.
- React Native supplies high-level call content and composable controls rather than trapping
  the app inside a fixed iframe.
- Screen sharing works on Android/iOS after native setup.
- Reactions and raise-hand events are supported, as are teacher permissions, muting, kicking,
  and ending a call for everyone.
- Native PiP can be disabled, allowing Sikshya to keep only its own movable window.
- $100 of monthly usage makes a real multi-device pilot possible without immediate cost.

Risks to test:

- Kathmandu latency and route quality are unproven here.
- React Native screen sharing requires a native development build and platform configuration;
  it does not work inside Expo Go.
- Price depends on received resolution. Sikshya must cap the teacher camera to 480p/720p and
  avoid receiving unnecessary tracks or the estimate is meaningless.
- It is a functional replacement, not a pixel-identical copy of Daily. Sikshya should own the
  visual shell and use Stream's media/state components inside it.

### Jitsi as a Service — strongest repeated-use billing model

Why it fits:

- The free tier covers 25 active devices with unlimited minutes.
- Paid plans bill monthly active devices; daily repeat classes do not multiply the bill.
- Web embedding and native Android/iOS SDK paths exist, with screen sharing and standard meeting
  features already provided.
- It avoids running an SFU while retaining a later path to open-source Jitsi self-hosting.

Risks to test:

- Its native integration is not a React Native component in the same sense as Stream; expect
  native SDK/configuration work and less control over the embedded interface.
- Cheap Android memory use, screen-sharing usability, and 3G recovery must be tested.
- A device is not a person; multi-device use inflates MAU.
- The public pricing examples are too small for 10,000 daily users. Get a written quote.

### Tencent RTC / Agora — low media price, serious diligence required

Tencent's prepaid top-up pricing is the strongest public managed per-minute rate found. Agora
also has low prepaid bundles and a classroom product. Both have broad SDK/UI-kit support and
strong Asia positioning. Before choosing either, test Nepal routing, SDK size and battery on a
budget Android, support responsiveness, contractual data location, payment/procurement, export
controls, privacy requirements, and the exact feature tier. The low price is not enough by
itself.

### Cloudflare RealtimeKit — capable, but the unit economics do not fit this tier

RealtimeKit is a managed call product with UI Kit/Core SDK, web/React Native/Expo support,
screen sharing, chat, polls, and teacher/student presets. Its $0.002 participant-minute rate is
half Daily's entry rate, but the modelled $74.88 media bill still exceeds the assumed $49 teacher
revenue. It is technically attractive and operationally simple, but not the strongest economic
choice for long recurring classes.

### Cloudflare Realtime SFU — compelling infrastructure, a real build

Cloudflare's raw SFU charges $0.05/GB egress and includes the first 1 TB monthly. It can be the
cheapest managed media plane and benefits from Cloudflare's network. It does **not** give Sikshya
a Daily-like room. Sikshya would own token issuance, signalling, publish/subscribe rules,
participant state, reconnection, adaptive quality policy, device selection, screen sharing,
moderation, reactions, diagnostics, analytics, browser/native UI, and incident handling.

This is feasible for a staffed product. It is not an efficient next step for a non-technical
owner while the classroom UX is still settling.

## Can Sikshya build the whole thing itself?

There are five meanings of "build it ourselves," with radically different risk.

### A. Own the UI over a managed media SDK — yes, and this is recommended

Sikshya builds the visible call experience, roles, buttons, call-window modes, alerts, and
whiteboard integration while Stream/JaaS/LiveKit Cloud/etc. carries encrypted media. This gives
the product a Daily-like feature set without inheriting a provider's cramped Prebuilt UI. The
existing `lib/video` provider seam is already the correct boundary.

Effort: weeks for a disciplined proof of concept and migration, then ongoing QA. This is the
best balance of control, cost, and reliability.

### B. Own signalling/UI over a raw managed SFU — feasible, but not yet efficient

Use Cloudflare Realtime SFU as the media router and build everything else. This removes most
media-server operations but still requires deep WebRTC product engineering and quality
telemetry. A realistic production effort is measured in engineer-months, not days.

### C. Self-host an open-source SFU — feasible with a technical team

The serious starting points are:

- **LiveKit:** strongest developer SDK/UI ecosystem and a straightforward VM path; multi-node
  production needs Redis, certificates/TURN, host networking, monitoring, graceful draining,
  and region design. Recording/egress is a separate resource-heavy service.
- **Jitsi Meet:** closest open-source ready-made meeting product; faster to a full meeting UI,
  less natural for a deeply custom whiteboard-first shell.
- **OpenVidu:** a higher-level platform built around open media components; evaluate licensing
  and current deployment editions.
- **mediasoup, Janus, Pion:** excellent lower-level building blocks, but they increase the code
  Sikshya must design, secure, test, and operate.
- **BigBlueButton:** education-oriented and feature rich, but operationally heavy and built as a
  complete classroom product; embedding only its video beside Excalidraw is poor fit.
- **Ant Media:** strong broadcasting/streaming orientation; assess licensing and RTC classroom
  fit before considering it.

Cheap hosting quotes alone are misleading. A reliable service needs at least two failure
domains, TURN/TLS fallback, regional capacity near Nepal, autoscaling or capacity alarms,
metrics, log retention, upgrades without dropping classes, DDoS/security handling, and a human
who can respond during Nepal teaching hours.

Effort: one experienced real-time engineer for the initial system, plus sustained on-call/ops.
This can become the lowest cash cost at scale, but it is not free.

### D. Peer-to-peer WebRTC — excellent for 1:1, wrong for 1:15

For one teacher and one student, direct WebRTC can avoid SFU charges when NAT traversal succeeds;
only signalling and TURN fallback cost money. For 16 people, mesh WebRTC makes the teacher upload
15 copies and is unusable on Nepal mobile connections. Sikshya can later route 1:1 lessons P2P
and larger rooms through an SFU, but that hybrid transition adds testing and failure modes.

### E. Build an SFU/media server from scratch — possible, economically irrational

This means implementing congestion control, simulcast/SVC layer selection, packet routing,
NACK/PLI handling, bandwidth estimation, TURN behavior, browser/device quirks, security,
observability, and rolling upgrades. It duplicates years of work in LiveKit/Jitsi/mediasoup and
creates a safety-critical single point of failure for every paid class.

**Do not do this.** Build Sikshya's differentiated classroom UI; reuse a proven media engine.

## Required proof-of-concept scorecard

Do not select a provider from desktop demos. Run the same scripted test for Stream and JaaS,
then optionally Tencent and Cloudflare:

1. Teacher web/laptop plus at least two low-memory Android phones.
2. Kathmandu/Nepal SIM on constrained 3G and ordinary 4G, not only Wi-Fi.
3. 45–90 minute call with Excalidraw active and chat messages arriving.
4. Teacher camera at 480p and 720p; record delivered bitrate, freezes, recovery time, battery,
   temperature, memory, and data used.
5. Teacher screen share: student readability in Small, Medium, and Full call-window modes.
6. Mute/camera/reactions/raise hand/permissions and teacher end-for-everyone.
7. Background/foreground, screen lock, orientation change, network switch, and 20-second drop.
8. Confirm internal chat and internal PiP can be disabled so only Sikshya's controls remain.
9. Confirm SDK/app bundle impact and first-call join time.
10. Export provider usage and reconcile it against Sikshya's session records.

Passing means no lost whiteboard touches, no duplicate PiP/chat, readable screen share, call
recovery without manual reload, and a measured cost below the price ceiling.

## Primary sources checked

- [Daily Video SDK pricing](https://www.daily.co/pricing/video-sdk/)
- [Stream Video pricing guide](https://getstream.io/video/docs/javascript/pricing-guide/)
- [Stream React Native overview](https://getstream.io/video/docs/react-native/)
- [Stream React Native screen sharing](https://getstream.io/video/docs/react-native/guides/screensharing/overview/)
- [Stream React Native reactions](https://getstream.io/video/docs/react-native/guides/reactions/)
- [JaaS overview and free tier](https://jitsi.org/jaas/)
- [JaaS pricing/MAU FAQ](https://developer.8x8.com/jaas/docs/faq/)
- [JaaS mobile SDK overview](https://developer.8x8.com/jaas/docs/mobile-sdk-overview/)
- [Cloudflare Realtime overview and SFU pricing](https://developers.cloudflare.com/realtime/)
- [Cloudflare RealtimeKit pricing](https://developers.cloudflare.com/realtime/realtimekit/pricing/)
- [Cloudflare RealtimeKit SDK/UI overview](https://developers.cloudflare.com/realtime/realtimekit/)
- [Tencent RTC top-up packages](https://trtc.io/document/79594)
- [Tencent RTC free quota](https://trtc.io/document/42735)
- [Agora pricing](https://www.agora.io/en/pricing/)
- [100ms pricing](https://www.100ms.live/pricing)
- [ZEGOCLOUD pricing](https://www.zegocloud.com/pricing)
- [VideoSDK pricing](https://www.videosdk.live/pricing)
- [AWS Chime SDK pricing](https://aws.amazon.com/chime/chime-sdk/pricing/)
- [Azure Communication Services pricing](https://azure.microsoft.com/en-us/pricing/details/communication-services)
- [Twilio Video pricing](https://www.twilio.com/en-us/video/pricing)
- [Vonage Video API pricing](https://www.vonage.com/communications-apis/video/pricing/)
- [Whereby Embedded pricing](https://whereby.com/information/embedded/pricing)
- [LiveKit Cloud quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- [LiveKit self-hosting overview](https://docs.livekit.io/transport/self-hosting/)
- [LiveKit production VM deployment](https://docs.livekit.io/transport/self-hosting/vm/)
- [LiveKit Kubernetes deployment](https://docs.livekit.io/transport/self-hosting/kubernetes/)
- [LiveKit self-hosted egress requirements](https://docs.livekit.io/transport/self-hosting/egress/)
- [Sendbird Calls SDK overview](https://sendbird.com/products/voice-and-video/sdk)

## Decision still owed

The owner has not selected a replacement. The next decision is only whether to authorize two
isolated proofs of concept: Stream Video first, JaaS second. Do not replace Daily or alter the
production classroom until a proof of concept passes the scorecard and the owner approves the
migration explicitly.
