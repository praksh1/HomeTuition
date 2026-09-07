import assert from "node:assert/strict";
import { test } from "node:test";
import { WHERE, describeReachFailure, diagnoseVideo, inspectSettings, settingsUsable } from "./diagnose.ts";

/**
 * A diagnostic is only worth having if it is right about *which* thing is wrong.
 *
 * The failure this whole module exists to prevent is not a missing check — it is a check that
 * confidently names the wrong cause and sends somebody to fix something that was already fine.
 * That has happened here twice: a blocked proxy reported as bad credentials, and settings
 * already known wrong blamed on LiveKit. Both are tested below.
 *
 * The secret-handling assertions matter as much as the logic ones. This output is read in a
 * browser at the moment something is broken, which is exactly when people screenshot a screen
 * and paste it into a chat.
 */

const GOOD = {
  LIVEKIT_API_KEY: "APIabc123def",
  LIVEKIT_API_SECRET: "a".repeat(43),
  LIVEKIT_URL: "wss://fadko-test.livekit.cloud",
};

test("complete, well-formed settings pass every settings check", () => {
  const findings = inspectSettings(GOOD);
  assert.equal(settingsUsable(findings), true);
  assert.deepEqual(
    findings.map((f) => f.id),
    ["key", "secret", "url"],
  );
});

test("the secret is never returned, at any length, in any verdict", () => {
  /*
    Values chosen so they cannot occur in English. An earlier version of this test used the word
    "short" and failed against the message "too short to be a real one" — a substring check for
    a leak is only meaningful when the needle could not have come from the prose.
  */
  for (const secret of ["Xq7z2", "Xq7z2".repeat(9)]) {
    const text = JSON.stringify(inspectSettings({ ...GOOD, LIVEKIT_API_SECRET: secret }));
    assert.ok(!text.includes(secret), `the whole secret leaked at length ${secret.length}`);
    // And no run of it long enough to be worth having.
    assert.ok(!text.includes("Xq7z2"), `a fragment leaked at length ${secret.length}`);
  }
});

test("a truncated secret is called truncated, not wrong", () => {
  const [finding] = inspectSettings({ ...GOOD, LIVEKIT_API_SECRET: "abc" }).filter((f) => f.id === "secret");
  assert.equal(finding?.verdict, "wrong");
  // The advice must be "paste it again", not "generate a new one" — they are different evenings.
  assert.match(finding!.fix!, /cut off|copy it again/i);
});

test("an https address is corrected to the wss one it should have been", () => {
  const [finding] = inspectSettings({ ...GOOD, LIVEKIT_URL: "https://fadko-test.livekit.cloud" }).filter(
    (f) => f.id === "url",
  );
  assert.equal(finding?.verdict, "wrong");
  assert.match(finding!.fix!, /wss:\/\/fadko-test\.livekit\.cloud/);
});

test("the remedy names the place the reader is actually standing", () => {
  const onServer = inspectSettings({}, WHERE.deployed).find((f) => f.id === "key");
  const onLaptop = inspectSettings({}, WHERE.local).find((f) => f.id === "key");
  assert.match(onServer!.fix!, /Railway/);
  assert.match(onLaptop!.fix!, /\.env/);
  // Same problem, same verdict — only the route differs.
  assert.equal(onServer!.title, onLaptop!.title);
});

test("a blocked network is not reported as a credentials problem", () => {
  /*
    The case that produced this rule. This repository's own build environment answers on
    LiveKit's behalf with a proxy error; calling that "wrong key" sends somebody to regenerate
    a key that was fine, and they then have two problems.
  */
  for (const message of ["fetch failed", "connect ETIMEDOUT 1.2.3.4:443", "403 blocked by egress allowlist"]) {
    const finding = describeReachFailure(message);
    assert.equal(finding.verdict, "unknown", `"${message}" should not be a verdict on the credentials`);
  }
});

test("a refusal from LiveKit is reported as a credentials problem", () => {
  for (const message of ["401 unauthorized", "invalid API key"]) {
    assert.equal(describeReachFailure(message).verdict, "wrong");
  }
});

test("a bad hostname is separated from a bad key", () => {
  const finding = describeReachFailure("getaddrinfo ENOTFOUND fadko-tset.livekit.cloud");
  assert.equal(finding.verdict, "wrong");
  assert.match(finding.fix!, /LIVEKIT_URL/);
});

test("nothing is asked of LiveKit while a setting is already known to be wrong", async () => {
  /*
    Order matters here, not just coverage. Asking about credentials that are already wrong
    produces a second, vaguer error underneath the specific one, and the reader is left holding
    two problems with no idea which caused which. No `reach` finding may appear.
  */
  const result = await diagnoseVideo({ VIDEO_PROVIDER: "livekit", LIVEKIT_API_KEY: "APIabc" });
  assert.equal(result.healthy, false);
  assert.ok(!result.findings.some((f) => f.id === "reach"));
  assert.ok(!result.findings.some((f) => f.id === "sign"));
});

test("correct settings that are not switched on yet say exactly that", async () => {
  const result = await diagnoseVideo({ ...GOOD, VIDEO_PROVIDER: "daily" });
  const provider = result.findings.find((f) => f.id === "provider");
  assert.equal(provider?.verdict, "unknown");
  assert.match(provider!.fix!, /VIDEO_PROVIDER/);
  // Not "wrong": nothing is broken, and a red screen over a switch nobody flipped is a lie.
  assert.ok(!result.findings.some((f) => f.verdict === "wrong" && f.id === "provider"));
});

test("an unset provider reads as daily rather than as blank", async () => {
  const result = await diagnoseVideo({});
  assert.equal(result.provider, "daily");
  assert.match(result.summary, /\S/);
});

test("the summary leads on failures, and counts them rather than picking one", async () => {
  // The provider finding comes first and is only "unknown"; three broken settings must lead.
  const result = await diagnoseVideo({ VIDEO_PROVIDER: "daily" });
  assert.match(result.summary, /3 things need fixing/);
});

test("the summary never repeats a finding word for word", async () => {
  /*
    Caught by looking at the rendered card, not by a test: the headline returned the first
    failing finding's own title, so the same sentence appeared twice within four lines. On a
    phone that is a third of the card spent saying one thing twice.
  */
  for (const env of [
    { VIDEO_PROVIDER: "livekit", ...GOOD, LIVEKIT_API_SECRET: "abc" },
    { VIDEO_PROVIDER: "daily", ...GOOD },
    {},
  ]) {
    const result = await diagnoseVideo(env);
    assert.ok(
      !result.findings.some((f) => f.title === result.summary),
      `the headline repeats a finding: ${result.summary}`,
    );
  }
});

test("a switch that is still off outranks a server that could not double-check", async () => {
  /*
    Both are "unknown", and the order between them decides what the reader sees first. Being on
    the wrong provider is something they must act on; being unable to reach LiveKit from here is
    this server admitting it could not confirm. Leading with the second buried the first.
  */
  const result = await diagnoseVideo({ ...GOOD, VIDEO_PROVIDER: "daily", LIVEKIT_URL: "wss://127.0.0.1:1" });
  assert.match(result.summary, /still on Daily/);
  // The variable holds "daily"; the sentence must not.
  assert.ok(!/still on daily/.test(result.summary));
  // And it must not claim confirmation LiveKit never gave.
  assert.match(result.summary, /look right/);
  assert.ok(!/are confirmed/.test(result.summary));
});
