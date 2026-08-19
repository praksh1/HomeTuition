---
name: Setting PAYMENT_WEBHOOK_SECRET will break every booking
description: Payment mode is inferred from configuration, not a flag. Setting any provider variable switches to gateway mode, and with no real provider wired up every booking is then declined.
---

`lib/payments.ts` chooses its mode from what exists in the environment:

- **simulated** — no provider configured. The server approves charges itself and warns on every
  one. This is what production runs in today, and it is why booking works at all.
- **gateway** — `PAYMENT_WEBHOOK_SECRET`, `ESEWA_MERCHANT_ID` or `KHALTI_SECRET_KEY` is set.
  Only a signed provider callback can settle a booking.

**The trap:** no payment provider is actually integrated yet. `chargeForSession` has no gateway
branch — it returns a decline with "Online payment isn't available yet." So setting any of those
variables, which looks like progress, immediately makes **every booking fail** with a 402.

Nothing is left half-done when that happens — booking is atomic, so a decline writes no
enrolment and consumes no seat — but the product stops being able to sell classes.

**Why:** the asymmetry is deliberate and worth preserving. Configuring a real provider must
close the free door permanently, so real payments can never be switched on while the server is
still approving its own charges. The cost of that safety is this trap in the other direction.

**How to apply:**
- Leave those variables **unset** in Railway until a provider is genuinely integrated.
- To check which mode production is in without touching data: `POST /api/payments/webhook`
  with no signature. `503` means simulated (bookings work); `401` means gateway (bookings are
  being declined).
- The server logs its mode at boot — a `WARN` line naming simulated mode, or `INFO` for gateway.
- Integrating a provider means implementing the gateway branch of `chargeForSession` to return
  their redirect URL, and pointing their callback at `POST /api/payments/webhook`. The
  signature check and the atomic booking around it already work.
- Before launch this must be resolved. Simulated mode means anyone can book paid classes for
  free.
