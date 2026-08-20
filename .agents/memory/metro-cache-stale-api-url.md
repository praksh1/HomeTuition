---
name: A rebuild can silently ship the previous API URL
description: Metro inlines EXPO_PUBLIC_API_URL during transform and caches the result without the value in the cache key, so changing the API address and rebuilding produces a build that succeeds and still contains the old address.
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
