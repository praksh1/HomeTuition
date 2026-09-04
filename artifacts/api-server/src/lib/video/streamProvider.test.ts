import assert from "node:assert/strict";
import { test } from "node:test";
import { streamProvider } from "./streamProvider.ts";
import { STREAM_STUDENT_ROLE, STREAM_TEACHER_ROLE, streamTokenTtlSeconds } from "./streamCall.ts";
import { VideoNotConfiguredError } from "./types.ts";

/**
 * The provider, with fake credentials and no network.
 *
 * `globalThis.fetch` is replaced for the tests that need a configured provider, so nothing here
 * can reach Stream even by accident. The secret is the string "test-secret"; the tokens it signs
 * are real HS256 JWTs and are decoded here to check what they actually claim, because a comment
 * saying "the token is scoped to one call" is not evidence that it is.
 */

const ENV = ["STREAM_API_KEY", "STREAM_API_SECRET", "STREAM_CALL_TYPE"] as const;

async function withEnv(
  values: Partial<Record<(typeof ENV)[number], string>>,
  run: () => Promise<void> | void,
) {
  const previous = Object.fromEntries(ENV.map((n) => [n, process.env[n]]));
  for (const n of ENV) delete process.env[n];
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const n of ENV) {
      const v = previous[n];
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

/** Records what the provider tried to send, and answers without leaving the process. */
function fakeStream(reply: { ok: boolean; status?: number; body?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return {
      ok: reply.ok,
      status: reply.status ?? (reply.ok ? 201 : 500),
      text: async () => reply.body ?? "",
      json: async () => JSON.parse(reply.body ?? "{}"),
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/** Reads a JWT's payload without verifying it — this is a test, not the coordinator. */
function claimsOf(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

function headerOf(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

test("it is registered under its own name and says it brings no chat", () => {
  assert.equal(streamProvider.name, "stream");
  // The provider's chat is not the app's chat and never will be — see
  // .agents/memory/one-chat-per-class.md. Stream Video ships none at all, which is convenient.
  assert.equal(streamProvider.capabilities.builtInChat, false);
  assert.equal(streamProvider.capabilities.screenShare, true);
});

test("with no credentials it is not configured", async () => {
  await withEnv({}, () => {
    assert.equal(streamProvider.configured(), false);
  });
});

test("with both credentials it is configured", async () => {
  await withEnv({ STREAM_API_KEY: "k", STREAM_API_SECRET: "s" }, () => {
    assert.equal(streamProvider.configured(), true);
  });
});

test("half-configured is not configured", async () => {
  await withEnv({ STREAM_API_KEY: "k" }, () => assert.equal(streamProvider.configured(), false));
  await withEnv({ STREAM_API_SECRET: "s" }, () => assert.equal(streamProvider.configured(), false));
});

test("with no credentials it refuses a room, typed, and names the variable in the detail", async () => {
  await withEnv({}, async () => {
    // Typed so the room route can answer 503 "this server was never set up" rather than 502
    // "try again", and so the variable names stay in the log rather than in the response.
    await assert.rejects(
      () => streamProvider.ensureRoom(42),
      (err: Error) => err instanceof VideoNotConfiguredError,
    );
    // The one behaviour that matters most today. There is no Stream account yet, so the only
    // honest outcome is a refusal somebody can act on — not a plausible-looking locator that
    // becomes a black rectangle on a phone.
    await assert.rejects(
      () => streamProvider.ensureRoom(42),
      (err: Error) => {
        assert.match(err.message, /STREAM_API_KEY and STREAM_API_SECRET/);
        assert.match(err.message, /not set on the server/);
        return true;
      },
    );
  });
});

test("with no credentials it refuses a token too, rather than minting an unsigned one", async () => {
  await withEnv({}, async () => {
    await assert.rejects(
      () => streamProvider.joinToken(42, { isOwner: true, userName: "Ram", userId: "1", durationMinutes: 60 }),
      /STREAM_API_KEY and STREAM_API_SECRET/,
    );
  });
});

test("it never reaches the network when it is not configured", async () => {
  const stream = fakeStream({ ok: true, body: "{}" });
  try {
    await withEnv({}, async () => {
      await streamProvider.ensureRoom(42).catch(() => {});
    });
    assert.equal(stream.calls.length, 0);
  } finally {
    stream.restore();
  }
});

test("a configured provider asks Stream to get-or-create exactly the session's call", async () => {
  const stream = fakeStream({ ok: true, body: JSON.stringify({ created: true }) });
  try {
    await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
      const room = await streamProvider.ensureRoom(42);
      assert.equal(room, "stream:call/default/sikshya-42?api_key=pubkey");

      assert.equal(stream.calls.length, 1);
      const { url, init } = stream.calls[0];
      assert.equal(
        url,
        "https://video.stream-io-api.com/api/v2/video/call/default/sikshya-42?api_key=pubkey",
      );
      assert.equal(init.method, "POST");
      const headers = init.headers as Record<string, string>;
      assert.equal(headers["stream-auth-type"], "jwt");
      // The call is created with a server token, whose one claim is that it is the server.
      assert.equal(claimsOf(headers.Authorization).server, true);
      assert.equal(headerOf(headers.Authorization).alg, "HS256");
    });
  } finally {
    stream.restore();
  }
});

test("the call is created with the settings the pricing model depends on", async () => {
  const stream = fakeStream({ ok: true, body: "{}" });
  try {
    await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
      await streamProvider.ensureRoom(7);
      const body = JSON.parse(String(stream.calls[0].init.body));
      assert.deepEqual(body.data.settings_override.video.target_resolution, {
        width: 640,
        height: 480,
        bitrate: 600_000,
      });
      assert.equal(body.data.settings_override.video.camera_default_on, false);
      assert.equal(body.data.settings_override.recording.mode, "disabled");
    });
  } finally {
    stream.restore();
  }
});

test("a Stream refusal fails loudly rather than returning a room that is not there", async () => {
  const stream = fakeStream({ ok: false, status: 403, body: '{"message":"no"}' });
  try {
    await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
      await assert.rejects(() => streamProvider.ensureRoom(42), /Stream call setup failed: 403/);
    });
  } finally {
    stream.restore();
  }
});

test("the teacher's token and the student's differ only in what the server decided", async () => {
  await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
    const teacher = await streamProvider.joinToken(42, {
      isOwner: true,
      userName: "Ram",
      userId: "11",
      durationMinutes: 90,
    });
    const student = await streamProvider.joinToken(42, {
      isOwner: false,
      userName: "Sita",
      userId: "12",
      durationMinutes: 90,
    });

    const t = claimsOf(String(teacher));
    const s = claimsOf(String(student));

    assert.equal(t.role, STREAM_TEACHER_ROLE);
    assert.equal(s.role, STREAM_STUDENT_ROLE);
    assert.equal(t.user_id, "11");
    assert.equal(s.user_id, "12");
    // Both are locked to the one class they were minted for.
    assert.deepEqual(t.call_cids, ["default:sikshya-42"]);
    assert.deepEqual(s.call_cids, ["default:sikshya-42"]);
  });
});

test("a token is bound to one call, so it cannot open the next one", async () => {
  await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
    const forOne = claimsOf(
      String(await streamProvider.joinToken(1, { isOwner: false, userName: "S", userId: "5", durationMinutes: 60 })),
    );
    assert.deepEqual(forOne.call_cids, ["default:sikshya-1"]);
    assert.ok(!forOne.call_cids.includes("default:sikshya-2"));
  });
});

test("a ninety-minute class gets a token that outlives it", async () => {
  await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
    const claims = claimsOf(
      String(
        await streamProvider.joinToken(1, {
          isOwner: true,
          userName: "T",
          userId: "5",
          durationMinutes: 90,
        }),
      ),
    );
    // The lifetime the class needs, not a round number somebody liked: a flat hour would have
    // dropped a ninety-minute lesson at the hour mark and refused the rejoin.
    assert.equal(claims.exp - claims.iat, streamTokenTtlSeconds(90));
    assert.equal(claims.exp - claims.iat, (10 + 90 + 10) * 60);
    assert.ok(claims.exp > Math.floor(Date.now() / 1000) + 90 * 60);
  });
});

test("a class's length is what decides its token's lifetime", async () => {
  await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
    const forLength = async (durationMinutes: number) => {
      const c = claimsOf(
        String(
          await streamProvider.joinToken(1, {
            isOwner: false,
            userName: "S",
            userId: "5",
            durationMinutes,
          }),
        ),
      );
      return c.exp - c.iat;
    };
    assert.ok((await forLength(180)) > (await forLength(90)));
    assert.equal(await forLength(180), streamTokenTtlSeconds(180));
  });
});

test("a token is signed, so a client cannot write itself one", async () => {
  await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret" }, async () => {
    const token = String(
      await streamProvider.joinToken(1, { isOwner: true, userName: "T", userId: "5", durationMinutes: 60 }),
    );
    assert.equal(headerOf(token).alg, "HS256");
    assert.equal(token.split(".").length, 3);
    // The signature is over the claims, so flipping the role invalidates it. Checked here by
    // signing the same claims with a different secret and seeing a different signature.
    const jwtMod = (await import("jsonwebtoken")).default;
    const other = jwtMod.sign(claimsOf(token), "not-the-secret", {
      algorithm: "HS256",
      noTimestamp: true,
    });
    assert.notEqual(other.split(".")[2], token.split(".")[2]);
  });
});

test("the secret never appears in the locator handed to the app", async () => {
  const stream = fakeStream({ ok: true, body: "{}" });
  try {
    await withEnv({ STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "super-secret-value" }, async () => {
      const room = await streamProvider.ensureRoom(42);
      // The API key is publishable and travels with the room on purpose. The secret is what
      // signs tokens and must never leave this process.
      assert.ok(room.includes("pubkey"));
      assert.ok(!room.includes("super-secret-value"));
    });
  } finally {
    stream.restore();
  }
});

test("the call type can be pointed at a configured one without touching code", async () => {
  const stream = fakeStream({ ok: true, body: "{}" });
  try {
    await withEnv(
      { STREAM_API_KEY: "pubkey", STREAM_API_SECRET: "test-secret", STREAM_CALL_TYPE: "sikshya-class" },
      async () => {
        const room = await streamProvider.ensureRoom(42);
        assert.equal(room, "stream:call/sikshya-class/sikshya-42?api_key=pubkey");
        const claims = claimsOf(
          String(await streamProvider.joinToken(42, { isOwner: true, userName: "T", userId: "1", durationMinutes: 60 })),
        );
        // The token's scope follows the call type, or it would authorise the wrong call.
        assert.deepEqual(claims.call_cids, ["sikshya-class:sikshya-42"]);
      },
    );
  } finally {
    stream.restore();
  }
});

test("the identity the token is signed for is the one the app is told to use", () => {
  assert.equal(streamProvider.identityFor?.("17"), "17");
  // Nothing exotic reaches Stream as a user id, and an empty one becomes a name rather than "".
  assert.equal(streamProvider.identityFor?.("a b/c"), "abc");
  assert.equal(streamProvider.identityFor?.("///"), "guest");
});
