# LiveKit's server runs on this machine, so "we cannot test a real call" is no longer true

For most of the LiveKit trial, `VIDEO.md` said **no media has ever flowed** — no camera opened,
no packet sent, no token presented to a server. Every green suite tested the interface over a
fake provider, or minted tokens nobody used. The stated blocker was that a real call needs
credentials and two browsers.

It does not. **LiveKit's SFU is open source, and it is the same binary LiveKit Cloud runs.**

```
git clone --depth 1 --branch v1.13.6 https://github.com/livekit/livekit-server.git
cd livekit-server && go build -o ~/go/bin/livekit-server ./cmd/server
```

Notes that cost time:

- The Go module path is `github.com/livekit/livekit-server`, not `livekit/livekit`.
- `go install …@version` **fails** — the go.mod has `replace` directives. Clone and `go build`.
- It needs Go ≥ 1.26; Go 1.24 downloads the newer toolchain by itself if the module proxy is
  reachable. In this environment `proxy.golang.org` is in the proxy's `noProxy` list, so it is.
- `livekit-server --dev` uses the published pair `devkey` / `secret`. Nothing outside the
  machine accepts them, so they are safe to hardcode in a suite.

`artifacts/sikshya/scripts/livekit-live` uses it for a genuine two-person call and skips itself,
loudly, when the binary is absent.

## Two things it taught that no amount of reading would have

**A LiveKit join token is a door key, not a heartbeat.** Expiry is checked when the signal
connection is established and never again — a participant on a twenty-second token stayed
connected for two hundred seconds past expiry with no `Disconnected` and no `Reconnecting`.
Joining or rejoining with an expired token is refused. This is why the token TTL could safely be
shortened from eight hours to the class's own cutoff, which had sat unfixed as a known security
finding precisely because the answer was unknown and guessing wrong would drop students
mid-lesson.

**The join check allows roughly sixty seconds of clock-skew leeway.** A token expired by 2.5
seconds is *accepted*, in dev and production mode alike; one expired by 75 seconds gets a clean
401. A first experiment tested inside that window and looked like proof that LiveKit ignores
expiry entirely — which would have been a fabricated finding had it been written down. Any
expiry test must wait well past a minute. The five-minute floor on the token TTL exists for the
same reason.

## And one about testing video at all

**A rendered tile proves nothing.** `framesDecoded` on the inbound RTP stream proves packets
arrive; drawing the live `<video>` into a canvas and reading the pixels back proves a person
sees something. A black tile and a working one are identical to a DOM query, and **headless
Chromium does not composite video into a screenshot** — the saved screenshots from that suite
show black tiles and that is expected, not a bug.
