---
name: A rebuild can silently ship the previous API URL
description: Metro inlines EXPO_PUBLIC_API_URL and the app.json manifest during transform and caches the result without either value in the cache key, so changing the API address or renaming the app and rebuilding produces a build that succeeds and still carries the old one.
---

`EXPO_PUBLIC_API_URL` is substituted into the JavaScript at build time (see
`deploy-url-baked-in.md`). What was not known until it was reproduced: **the substitution is
cached, and the cache key does not include the value.**

So this happens:

```
EXPO_PUBLIC_API_URL=http://127.0.0.1:8080 pnpm run build   # bundle says 8080
EXPO_PUBLIC_API_URL=http://127.0.0.1:9999 pnpm run build   # succeeds — bundle still says 8080
```

Reproduced deliberately, twice. The build prints no warning, exits 0, and produces a site that
points at the previous backend. This is the same failure mode as a wrong URL in the docs, and
it is harder to spot: the value you typed is correct.

**How to apply:**

- `artifacts/sikshya/scripts/build.js` now handles it. It records the target in
  `node_modules/.cache/sikshya-build-target` and passes `--clear` to `expo export` whenever the
  target has changed. A changed URL costs about 75 seconds; an unchanged one still takes 12.
- The same script then reads the address back out of the files it just produced and **fails the
  build** if it is not there. That catches the symptom whatever the cause, including causes
  nobody has found yet.
- Do not remove either guard to make builds faster. The whole point is that this failure is
  invisible: the build passes, the site loads, and only requests fail.
- If a build ever does ship the wrong address, `rm -rf node_modules/.cache` and rebuild — or on
  Windows, `Remove-Item -Recurse -Force node_modules\.cache`.

## The app's own name travels the same route

`expo-constants` has the whole of `app.json` baked into it at transform time — the manifest is
a string literal inside the bundle. So the manifest is cached exactly like the API URL is, and
renaming the app can produce a build that still calls itself the old name.

That matters because the name is not only decoration. `expo.name` (or `expo.web.name`) becomes
the browser tab title *and* the label under the icon when a student adds the site to an Android
home screen. The project was generated as "Guru" and shipped under that name on the web for
months after every screen inside it said Sikshya.

The stamp in `build.js` therefore records name, slug and scheme alongside the API target:

```
api:https://…up.railway.app|name:Sikshya|slug:sikshya|scheme:sikshya
```

and `assertBuildIdentity()` reads the `<title>` back out of `web-build/index.html` and fails the
build if it disagrees with `app.json`. It looks the expected name up rather than hardcoding it,
so it keeps being a check on the rename instead of quietly becoming a check that the app is
still called Sikshya. The deploy workflow does the same against the live URL after publishing.
