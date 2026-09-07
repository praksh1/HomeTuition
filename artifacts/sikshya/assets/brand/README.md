# Fadko brand assets

The owner selected the blue **threshold** mark with its small crimson milestone on 6 September
2026. `fadko-threshold-icon.svg` is the vector master and `fadko-threshold-1024.png` is installed
as `../images/icon.png`. The earlier ascent, board and book concepts remain here as design
history; they are not runtime assets.

| File | What it is |
|---|---|
| `fadko-threshold-icon.svg` | Selected full icon master — warm ground, royal-blue mark, crimson milestone. |
| `fadko-threshold-mark.svg` | Selected mark alone for use on light surfaces inside the app. |
| `fadko-threshold-1024.png` | Selected 1024px icon raster installed as `../images/icon.png`. |
| `fadko-<older-name>-*` | Rejected design candidates retained only as design history. |

The welcome screen uses `../images/hero_fadko_live_learning.jpg`, a text-free responsive hero.
All wording and controls remain native UI so they scale, translate and remain accessible.

## Runtime treatment

One raster serves four jobs: iOS icon, splash image, Android adaptive foreground and favicon.
The selected file has a warm-paper ground; splash and adaptive backgrounds use the same ground
in `app.json`, so there is no visible square around it while it loads.

## To regenerate the installed raster

Rasterise `fadko-threshold-icon.svg` to `fadko-threshold-1024.png`, copy it to
`artifacts/sikshya/assets/images/icon.png`, then run the app build. `app.json` already points at
that path for every platform.

The installed PNG is about 6 KB because it is flat geometry. On the connections this app is
designed for, that difference is worth having.
