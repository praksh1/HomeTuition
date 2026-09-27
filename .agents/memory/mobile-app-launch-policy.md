# Laptop web and installed mobile-app launch — 27 September 2026

The owner clarified that Fadko is for laptops and phones (Android and iOS). Laptop web must remain fully usable. Phone browsers are the current testing route because the installed apps have not been released through their stores. Once the apps are published and working, the owner wants phone users directed to the installed app rather than continuing ordinary use in a phone browser.

This is a future release requirement, **not permission to block phone browsers now**. Before any app-directed/mobile-web gate, verify store availability, actual iOS and Android builds, universal/app links and shared teacher/class links, sign-in recovery, classroom audio/video/whiteboard, and a safe fallback when the app cannot be installed or opened. A phone browser must not be mistaken for an installed native app just because both run on a phone. Desktop/laptop web must not be downgraded to a stretched phone layout.

Current code still routes installed native classroom calls to Daily while web browsers use LiveKit when configured. Do not remove Daily or enable final account closure based only on successful phone-browser tests. Native media revocation and physical-device checks remain launch gates; see `docs/IDENTITY-RELEASE-CHECKLIST.md`.
