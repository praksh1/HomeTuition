---
name: The board on a phone can do whatever the web board can — it just needs bytes
description: On iOS and Android the whiteboard is a WebView running the deployed web board, so a feature that works on the web already works on phones; what usually blocks it is handing the board a device-local path instead of the file's contents.
---

`SmartBoard.tsx` is not a second whiteboard. It is a bridge: a WebView pointed at
`/board` on our own web deployment, passing messages in and out. All the board logic lives in
`SmartBoard.web.tsx`, on the other side of that bridge, and Metro resolves `.web.tsx` there
because the WebView *is* a browser running the web bundle.

The practical consequence is easy to forget and was forgotten for months:

> A whiteboard feature that works on the web already works on phones. Nothing needs porting.

What actually blocks such a feature is almost always the same thing — the app hands the board a
**path** where it needed **bytes**. Every picker on a phone returns a path: `file://` on both
platforms, `content://` from an Android file provider. Those resolve on the one device and
nowhere else, so a path put on the board gives every student a permanently broken picture, and
nothing tells anyone.

Sharing a PDF sat unbuilt on that misreading. The note in the code said native "could not"
rasterise a PDF, which was true of React Native's own JavaScript and irrelevant: the board was
never going to rasterise it there. Reading the picked file with `expo-file-system`
(`new File(uri).base64()`) and posting a `data:` URL was the whole change. `utils/pickedFile.ts`
holds the rule about which sources may be broadcast, as an allow-list — an unfamiliar scheme
wrongly refused degrades honestly, one wrongly accepted breaks the lesson silently.

**The one thing that does not come free: size.** Everything else crossing this bridge is small.
An 8 MB PDF is about 11 MB once base64-encoded, and the largest thing proven across it is a
compressed photo at roughly 1 MB. A message that big can be *dropped* on the way into the
WebView rather than refused, which from outside is indistinguishable from a board still
thinking. So the board acknowledges a document the moment it arrives (`document_in`), and
`SmartBoard.tsx` warns the teacher when no acknowledgement comes within 15 seconds. Keep that
receipt if you touch this: without it, the failure mode is a teacher watching an empty board in
front of a class with nothing to tell them why.
