---
name: The Daily API key must be rotated before any public launch
description: The key was pasted into a chat transcript early in this project, so it is compromised. Anyone holding it can create and join rooms on the owner's account and bill them. The owner asked to be reminded before shipping to the App Store, Play Store or a real web launch.
---

`DAILY_API_KEY` was included in a chat transcript early in this project's life. Treat it as
public. Whoever has it can create rooms, join any room, and run up charges on the owner's Daily
account.

It has not been rotated because rotating it now would break the running app until the new value
reaches Railway, and the project is still being tested by one person. That trade stops being
reasonable the moment anyone else can reach it.

**The owner asked, explicitly, to be reminded of this before launching to iOS, Android or as a
public web app.** Raise it when any of these come up:

- preparing a store build (`expo prebuild`, EAS, a signed APK/IPA)
- pointing a real domain at the site, or sharing the URL beyond testing
- anything described as launch, going live, or real users

The steps, so the reminder is actionable rather than a worry: Daily dashboard → Developers →
rotate the key → update `DAILY_API_KEY` in Railway's Variables → Railway redeploys on its own.
The app needs no change; the key is only ever read server-side.

Recorded in three places on purpose, because a reminder that lives only in a chat is not a
reminder: the checklist at the top of `ISSUES.md`, a note at the top of `DEPLOY.md`, and here.
