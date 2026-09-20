# A diagnostic the owner has to type is not a diagnostic

**Decided by evidence, three times, across two features. Do not build a fourth one as a command.**

The owner is non-technical, develops on Windows, and moves between machines and branches. Every
time this project has answered "is X configured correctly?" with a command to run, the *delivery*
failed rather than the check:

1. **The storage check.** They were told to open `GET /admin/storage/check` in their phone's
   browser. It answered `{"error":"Missing or invalid Authorization header"}` — the only thing it
   could ever have said, because this API takes a Bearer token the app holds and a browser tab
   has none.
2. **The LiveKit preflight, first attempt.** `pnpm run livekit:check` gave
   `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. The script existed — on the branch it was written on, which
   was not the branch their checkout was on. The instruction was incomplete, not the command.
3. **The LiveKit preflight, second attempt.** A `cmd.exe` one-liner using `&&` and `cd /d` was
   pasted into PowerShell, where `&&` is not a statement separator and `cd /d` does not exist.

Their own words after the third: *"please don't make me work any more cmd lines - i know you have
the capabilities to do all of that- I keep getting errors like these."*

## The shape that works

**A button on a screen they are already signed in to.** Both checks now live at the top of the
support desk (`app/(admin)/index.tsx`): *Check file uploads* and *Check video calls*. No shell, no
branch, no `pnpm.cmd`, and the token comes from the session the app already holds.

It also answers a question a local command cannot. The settings that decide whether a real class
works live on the **deployed** server, not in anybody's checkout — so a green terminal on a laptop
proves nothing about the live site, and the button asks the machine that actually serves users.

## Four rules for the next one

1. **One module holds the judgement; the surfaces only print.** `lib/video/diagnose.ts` is called
   by both the route and the script. Two copies of a diagnostic eventually disagree, and one that
   disagrees with itself is worse than none.
2. **Three verdicts, not two.** `ok` / `wrong` / `unknown`. "The settings are right but this
   server cannot reach the provider" is not a verdict on the credentials, and painting it red
   sends somebody to regenerate a key that was fine. This repository's own egress policy produces
   exactly that case.
3. **Every remedy names the place, per finding.** Not "check your settings" — "in Railway → your
   api-server service → Variables". The location differs by surface, so pass it in (`WHERE`);
   a browser reader and a laptop reader need different routes to the same fix.
4. **Never return a secret, in the response or on the screen.** Report a length. "You pasted 12
   characters" is the failure people actually hit, and this is read at the moment something is
   broken — which is exactly when a screen gets screenshotted into a chat.

## The one thing that cannot be automated away

Nobody but the owner can enter their own secret. That step stays theirs — but the cheapest place
for it is a provider's own Variables tab in a browser, never a shell.
