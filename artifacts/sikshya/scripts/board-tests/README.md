# Whiteboard tests

The whiteboard is the product, and every serious bug it has had was invisible in the code and
obvious on screen: a stroke the teacher erased that students kept, a class looking at two
different parts of the canvas, a "clear" that cleared one board out of five. So these tests
drive the **real board page in a real browser** and compare **rendered pixels**, rather than
calling functions and trusting the result.

They need no database, no login and no live class: the test rig plays the part of the classroom
WebSocket, carrying the same messages between two board pages that the server carries between
two people.

## Running them

From `C:\Projects\Paathshala\Paathshala\artifacts\sikshya`:

```
pnpm.cmd --filter @workspace/sikshya run build
pnpm.cmd run test:board
```

The first command builds the web app; the second serves that build, runs the tests and tears
the server down. `EXPO_PUBLIC_API_URL` can be anything here — the tests never call the API.

**One-off setup.** Playwright drives the browser and is deliberately *not* a project
dependency: it downloads a browser on every `pnpm install`, on every machine, for a suite most
people will never run. Install it once, globally:

```
npm.cmd i -g playwright
npx.cmd playwright install chromium
```

## What they check

| Test | The failure it guards against |
|---|---|
| an erased stroke disappears for the student too | students kept every mistake the teacher rubbed out, stacked under whatever replaced it |
| the student's view follows the teacher's | students opened on a different part of the infinite canvas and had to hunt for the lesson |
| clearing the board clears it for the class | Excalidraw's own reset empties one screen and leaves everyone else's full |
| a student with no teacher view still lands on the lesson | a student joining before a viewport is published stares at blank canvas |
| the properties panel stays out of the way | the Stroke/Background panel covered a quarter of the board with no way to dismiss it |

A failure prints the assertion that broke and why that property matters, and the run exits
non-zero — so this can gate a deploy.

## Adding one

`tests.mjs` holds a list. Each entry is `{ name, why, run(ctx, baseUrl, assert) }`. Write `why`
as the user-visible failure, not the mechanism: it is what gets printed when the test fails,
possibly to someone who has never seen this code.

`harness.mjs` has the shared parts — opening a board, pumping messages between two of them,
measuring ink, drawing a stroke.

## What they do not cover

- **Native.** These run the board as a web page. The iOS/Android apps load that same page inside
  a WebView, so the board logic is covered, but the bridge between the app and the page is not.
- **Performance on low-end hardware.** The known open risk, and it needs a real cheap Android
  phone. See `WHITEBOARD.md`.
- **The server.** The rig replaces `classroomHub.ts` rather than running it, so the hub's own
  version-wins merge and its access control are not exercised here.
