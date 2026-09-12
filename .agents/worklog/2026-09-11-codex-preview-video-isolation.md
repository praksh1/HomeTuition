# Prepare isolated preview video (not activated)

- Branch: codex/preview-video-isolation, based on booking preview 8b704a6.
- Owner wants actual no-charge classroom tests. Staging is still echo with no attached Daily key.
- NO provider/account/config changes made here. NO call minutes consumed or purchase made.

## Why

The two databases can both have session 1. Default provider naming uses sikshya1. Attaching the
same Daily account to staging without namespacing can put unrelated users in the same room.

## Implemented

Opt-in server-only VIDEO_ROOM_NAMESPACE, validated strictly, shared by Daily, LiveKit and the
provider evidence inverse. Default production names stay unchanged. Invalid values fail closed.
Daily rooms in an explicit namespace are private, knocking disabled, and tokens remain bound to
that exact room and authenticated user/owner role. Missing key/token, failed settings repair,
public existing room, or concurrent creation collision cannot fall back to an anonymous URL.
Collision asks for a retry; it does not delete, rename or modify a production room. No recording
or transcription enabled. This is room isolation, NOT complete cost controls or revocation design.

## Verification

28 focused checks passed, including actual Daily source bundled and executed in an isolated VM
with recorded HTTP responses. Covers production defaults, isolated private creation/token/evidence,
bad namespace, missing key, public room, failed repair, collision, empty/failed token. No real HTTP.
API typecheck and all 534 API unit tests passed. Full CI 34667743528 SUCCESS at 388ad4e:
4-workspace typecheck, API/app units, ratchet, program API 601, batch bookings 40, video contract 42,
provider evidence 125, teacher grants 26, student access 108, class setup UI 75, booking UI 24.
Actual Daily media, account allowance and real-device checks remain unverified. Not deployed.
An initial apply_patch attempt used delete/add on the same file and was rejected atomically;
reissued as normal updates. No user file was lost.

## Sources / unverified boundaries

Read Daily official room and meeting-token documentation on 12 Sep UTC:
https://docs.daily.co/reference/rest-api/rooms/create-room
https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token
Private rooms + room-bound tokens documented. Pricing page alone cannot verify this user's
remaining allowance. Asked owner to sign in to https://dashboard.daily.co/ to inspect their account.

Do not attach shared production credentials until the owner confirms that specific access change,
the namespace has been deployed/verified, and billing allowance is known. Do not expose keys in
chat/logs. Existing token lifetime, production room privacy, real provider use, provider webhook
activation and account billing unchanged. No cheap Android/iPhone media measurements yet.
