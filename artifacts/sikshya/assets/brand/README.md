# Fadko brand candidates

**None of these is installed.** The app still uses `../images/icon.png`, the book-and-mountain
mark drawn for Sikshya. These are three proposals for the owner to choose between; see the
identity page linked from the worklog entry for how they read at every size.

| File | What it is |
|---|---|
| `fadko-<name>-icon.svg` | The full icon — crimson field, white mark. This is the one that becomes `icon.png`. |
| `fadko-<name>-mark.svg` | The mark alone, crimson on transparent, for light surfaces inside the app. |
| `fadko-<name>-1024.png` | The icon rasterised at 1024×1024, the size `app.json` expects. |

## Why each carries its own crimson ground

One file serves four jobs: the iOS app icon, the splash image, the Android adaptive-icon
foreground, and the browser favicon. The Android adaptive icon is composited over
`#1A365D` navy (set in `app.json`), while the favicon sits on white. A bare crimson mark
fails the first — `#C41E3A` on `#1A365D` is roughly 2:1 and unreadable. Giving the mark its
own field makes the same file correct on both, which is what the current icon does too.

## To install one

Replace `artifacts/sikshya/assets/images/icon.png` with the chosen `-1024.png`, then
`pnpm --filter @workspace/sikshya run build`. Nothing in `app.json` changes — it already
points at that path for every platform.

The three candidates are 22–30 KB against the current icon's 394 KB, because they are flat
vector shapes rather than a rendered illustration. On the connections this app is designed
for, that difference is worth having.
