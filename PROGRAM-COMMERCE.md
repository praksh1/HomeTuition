# Learning Program commerce contract

Status: **foundation only; no checkout, collection, refund or payout is enabled by this work.**

This document turns the approved managed-marketplace direction into a small accounting contract
without inventing the commercial numbers the owner has not chosen.

## The simple product users should understand

Students see two things they can buy:

1. **Single Class** — one scheduled class, one price.
2. **Learning Program** — a defined outcome delivered through a fixed set of paid lessons, one
   total price and one published set of cancellation terms.

Teachers separately choose how they pay Fadko. The working names are **Flexible** and **Teacher
Pro**, but neither should be put into the public app until its price and fee are approved. Students
always pay before gaining access. A delayed teacher payout is not a postpaid student purchase.

## The accounting rule now expressed in code

A provider-confirmed Learning Program payment is frozen into one allocation per paid lesson. The
allocations add back exactly to the confirmed tuition. If a whole-rupee price does not divide
evenly, the earliest lessons receive the extra rupees in order.

Each lesson then follows its own life:

`future -> delivered_pending -> eligible -> paid_out`

or, when something is contested:

`delivered_pending -> disputed -> eligible | refund_owed -> refunded`

A cancelled future lesson moves first to `replacement_pending`. A valid make-up carries that same
allocation back to `future`; an approved refund moves it to `refund_owed`. Cancellation therefore
does not silently choose a remedy. These words describe accounting state only. `refund_owed` must
never be shown as “refunded”, and `eligible` must never be shown as “paid out”. Provider
confirmation is what completes either action.

Session evidence may inform a human decision, but cannot move an allocation by itself. A make-up
replaces an owed lesson and keeps the original allocation; it does not create another earning.

The executable form is `artifacts/api-server/src/lib/programCommerce.ts`. Nothing imports it into
today's booking or Monthly-class paths.

## What the premium experience will eventually show

Teacher:

- one total Program price and the number of paid lessons;
- collected, awaiting delivery, in review, eligible, and paid as distinct amounts;
- the published payout day and cutoff;
- an exact explanation for any held lesson allocation;
- no wallet or escrow language.

Student or parent:

- the total price, lesson count, schedule, duration and cancellation summary before payment;
- a provider-hosted secure checkout;
- one Program home with the next lesson, preparation, practice and support;
- a receipt only after provider confirmation;
- refund “requested”, “submitted” and “confirmed” as different states.

Operator:

- the payment reference and frozen purchase terms;
- every lesson allocation beside its session evidence;
- complaint and response deadlines;
- human-readable reasons and an append-only history;
- no automatic verdict based on camera, microphone, attendance or whiteboard activity alone.

## Decisions that still block real money

The following must be approved and versioned before a checkout or ledger table is built:

1. Licensed Nepal payment provider and whether it supports marketplace collection/delayed payout.
2. Merchant/supplier of record.
3. Learning Program complaint window.
4. Weekly payout day and cutoff.
5. Flexible fee/commission and Teacher Pro subscription/commission.
6. Student service fee, whether it is fixed or percentage-based, and when it is refundable.
7. Gateway-fee and tax/TDS/VAT treatment.
8. Chargeback, reserve and negative-balance rules.
9. Parent/guardian contracting for minors.
10. Treatment of already-purchased Monthly classes during migration.

Until those are answered, production must continue to say that joining a Learning Program is not
open. Existing Single Class and Monthly purchases keep their current contracts.

## Recommended launch shape for owner approval

This is the smallest offer likely to be understandable and operable at launch. It is a proposal,
not a live rule:

1. Launch **Flexible** first: no teacher subscription to understand, one disclosed percentage from
   eligible tuition. Add Teacher Pro only after real teachers teach enough volume for its discount
   to have a clear break-even point.
2. Show the student one total before checkout. Do not surprise them with a fee on the last screen.
   If Fadko needs a service fee, include it in the displayed total and state its refund treatment.
3. Give students **48 hours after each lesson** to report a delivery problem. A report freezes only
   that lesson's allocation, not the entire Program.
4. Make undisputed allocations eligible after that window and publish one weekly payout day. A
   Wednesday payout is operationally safer than promising a weekend settlement, but the provider
   must confirm the actual bank timetable before the weekday is promised.
5. A teacher-cancelled lesson becomes “replacement needed”. Offer a mutually agreed make-up first;
   if none is accepted inside the published remedy window, refund the affected lesson allocation.
6. A Fadko-wide outage is funded by Fadko. A teacher non-delivery is funded from that teacher's
   unpaid allocation. Mixed connectivity goes to human review; no camera/board counter decides it.
7. Do not market Fadko as having no refund responsibility. The contractual/provider position may
   make the merchant responsible to the payer even when the teacher caused the failure. Fadko can
   recover the cost from an unpaid teacher allocation only when its agreements and provider allow
   that—it cannot erase the student's remedy with app copy.

The 48-hour window and Wednesday cadence are recommended defaults only. Commission, subscription,
student fee, refundability and provider remain deliberately blank.

## Current Nepal provider facts checked on 2026-09-10

- Nepal Rastra Bank's Payment Systems Department licenses and supervises PSOs/PSPs, and its July
  2026 licensed list includes IME Khalti and eSewa. A provider's existence is not proof it supports
  marketplace/submerchant settlement.
- Khalti's public gateway documentation supports hosted payment methods, transaction confirmation,
  merchant reporting and refunds. Its merchant terms say merchant KYC requires a registered
  business and tax documents, charges include a one-time API fee plus per-transaction percentage,
  and service-quality disputes remain the merchant's responsibility.
- Khalti separately publishes a consumer escrow service with its own sender/receiver release flow
  and dispute fees. Nothing public proves that product can be embedded as Fadko's multi-lesson,
  multi-teacher marketplace settlement. Ask Khalti in writing; do not model the app around the word
  “escrow” from that page.
- eSewa's public ePay v2 documentation exposes provider states including pending, complete, full
  refund, partial refund, ambiguous, not found and cancelled, plus a status enquiry endpoint. It
  does not publicly establish teacher split-settlement or delayed submerchant payouts.

Primary sources:

- https://www.nrb.org.np/departments/psd/
- https://docs.khalti.com/
- https://khalti.com/info/terms/merchant/
- https://khalti.com/info/khalti-escrow-service/
- https://developer.esewa.com.np/pages/Epay-V2

The required provider question is therefore precise: “Can Fadko collect one student Program
payment, retain lesson-specific allocations through a complaint window, refund one allocation, and
pay multiple KYC-verified independent teachers on a weekly batch—with API reconciliation and no
Fadko wallet?” A generic “Do you support payments?” answer is insufficient.

## Next engineering slice after owner approval

Build new additive tables for frozen Program purchase terms, enrolments and lesson allocations;
mirror simulated/test purchases first; render statements and reconciliation for teachers and
operators; then use a licensed provider's sandbox. Do not retrofit columns onto existing payment or
Monthly tables and do not enable production collection as part of a schema deployment.
