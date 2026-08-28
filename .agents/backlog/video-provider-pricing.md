# What the video actually costs, by provider — researched 2026-08-27

> **Superseded for decision-making:** the broader, first-party-source review from 2026-08-28 is
> in [`video-provider-research-2026-08-28.md`](./video-provider-research-2026-08-28.md). This
> original note is retained as historical context; several simplified cost conclusions below
> were corrected or qualified by the expanded review.

The owner asked for a side-by-side of Daily.co alternatives before deciding anything. Nothing
has been acted on; Daily is untouched and still configured. This is the research, written down
so the numbers survive a container reset and so a second AI does not repeat the search.

**A decision is still owed by the owner.** See "What to settle" at the bottom.

---

## The workload every figure is priced on

One teacher, one month, monthly tier:

|                         |                                                         |
| ----------------------- | ------------------------------------------------------- |
| Teacher video           | 1.5 Mbps (720p)                                         |
| Class                   | 90 min × 15 students receiving                          |
| Classes per month       | 26                                                      |
| **Participant-minutes** | 16 × 90 × 26 = **37,440**                               |
| **Egress**              | 1.5 Mbps × 15 × 5,400 s ≈ 15 GB/class × 26 ≈ **390 GB** |
| **Unique devices**      | **16** per teacher                                      |

Students' audio is rounding error — 40 kbps each and mostly muted. The teacher's outgoing video
is essentially the whole bill. Against a subscription of NPR 6,500 ≈ **US$49 per teacher**.

`GET /admin/video-usage` reports the first two of these from real data once there are real
teachers. Every figure below moves with class size and camera-on rate, and only real usage
settles those.

## The results

| Provider                           | Billed in               | Published rate                                     | $/teacher/mo |
| ---------------------------------- | ----------------------- | -------------------------------------------------- | ------------ |
| **Self-hosted LiveKit on Hetzner** | flat server             | ≈ €25–40/mo, 20 TB included, $1/TB over            | **≈ 0.60**   |
| **Jitsi as a Service (8x8)**       | monthly active _device_ | $99/300 MAU · $499/1,500 · $999/3,000 · $0.99 over | **≈ 10**     |
| Cloudflare Realtime SFU            | GB egress               | $0.05/GB, first 1,000 GB free                      | ≈ 19.50      |
| Agora, prepaid/committed           | participant-min         | ≈ $0.85 per 1,000 min                              | ≈ 32         |
| Self-hosted on AWS/GCP             | GB egress               | ≈ $0.09/GB + instance                              | ≈ 35         |
| LiveKit Cloud (Scale)              | both                    | $0.0004/min + $0.10/GB down                        | ≈ 54         |
| LiveKit Cloud (Ship)               | both                    | $0.0005/min + $0.12/GB down                        | ≈ 58         |
| Zoom Video SDK                     | participant-min         | $0.0035/min, 10k free                              | ≈ 131        |
| Agora, postpaid                    | participant-min         | $3.99 per 1,000 min HD                             | ≈ 149        |
| 100ms                              | participant-min         | $0.004/min                                         | ≈ 150        |
| **Daily.co — today**               | participant-min         | **$0.004/min**, 10k free                           | **≈ 150**    |

About a **250× spread** for the same software doing the same job.

## The two things worth knowing

**1. Daily costs about three times what a teacher pays us.** An earlier note used $0.002 per
participant-minute as an illustration and said so. The published rate is **$0.004**, so the real
figure is ≈$150/teacher against a ≈$49 subscription. Daily's own volume discount only reaches
$0.0015 at 50M minutes/month — roughly 1,300 teachers — and even there it is ≈$56/teacher. **The
unit is wrong, not the number**, and no negotiation fixes a unit.

**2. Jitsi as a Service bills per monthly active _device_, and that is upside-down from
everybody else.** 8x8's own FAQ: a MAU is a device that attended at least one meeting with at
least one other participant during the billing month, tracked by an identifier in local storage.
**A student attending all 26 daily classes from the same phone counts once.**

Every per-minute vendor charges more the more diligently a teacher teaches. JaaS charges more
only as the platform _grows_ — which is the bill you want, because growth arrives with revenue
and diligence does not. For a product whose whole shape is the same people meeting every day,
this is a structural advantage rather than a discount.

The caveat that could kill it: **MAU is per device, not per person.** A student on both a phone
and a laptop is two. Most of this market has one phone, so it probably helps us — but it is real.

## Recommendation as it stands

**Jitsi as a Service**, at roughly $10/teacher/month. Not because it is cheapest — self-hosted
LiveKit on Hetzner is ~$0.60 — but because it is the cheapest thing the owner can run _without
becoming an operations engineer_, and the owner is non-technical. The gap is about $470/month at
50 teachers, which buys "nobody is woken at 8pm in Kathmandu when a class will not connect".

Self-hosted LiveKit is the right answer the moment somebody technical is on the team, and it
sits behind the same seam, so the choice is not permanent.

## Test before committing — in this order

1. **The React Native path on JaaS.** This is the single thing that could rule it out, and it is
   free to find out: the developer tier covers 25 devices. Jitsi's React Native support has
   historically been the weakest part of its story and we ship to phones. If it will not run on
   a cheap Android in Nepal, stop and look at Cloudflare Realtime instead.
2. **Latency to Kathmandu** on each candidate. None of these numbers means anything if the call
   is unwatchable. Hetzner is Germany/Finland; Agora is strongest in Asia; Cloudflare's edge is
   the most distributed.
3. **Keep Daily configured throughout.** `lib/video/types.ts` already defines a provider as two
   functions selected by `VIDEO_PROVIDER`, with a test that runs the whole server twice — on
   Daily and on a stub — checking the rules come out identical. Switching back is a variable,
   not a deploy.

## The lever that is not a provider choice

A tutoring class is not a symmetric meeting — it is one teacher sending video to a room of
mostly-muted students. **Route 1:1 classes peer-to-peer** and pay nothing but TURN fallback,
using the SFU only when a class is genuinely large. The seam can decide this per session. If a
meaningful share of classes are small this is worth more than the provider choice — but it needs
the real numbers first, so it comes after step 1 above, not before.

## What to settle with the owner

- Which of the two candidates: **JaaS** (managed, ~$10/teacher) or **self-hosted LiveKit**
  (~$0.60/teacher, and the owner owns the pager)?
- Is $470/month at 50 teachers a fair price for not running servers? That is the entire
  decision in one sentence.
- Willing to commit money up front? That is the only thing that makes Agora competitive
  (~$32 prepaid vs ~$149 postpaid), and the owner has said current usage data is just them
  testing.

## How far to trust these numbers

All rates are published list prices found in August 2026. **Most vendors' own pricing pages
could not be opened from the cloud container** — its egress proxy blocks them — so the figures
come from search results and secondary sources rather than from the vendors directly. Good
enough to rank options; **not good enough to sign a contract on.** Confirm the shortlisted two
directly before committing.

Add-ons nobody here needs — recording, RTMP, HLS, transcription — are excluded throughout. Free
tiers are per _account_, not per teacher, so they vanish into rounding at any real scale.
