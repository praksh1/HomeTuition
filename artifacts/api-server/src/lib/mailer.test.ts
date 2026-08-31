import assert from "node:assert/strict";
import test from "node:test";

import { isEmailConfigured, sendEmail } from "./mailer.ts";

const ENV_NAMES = ["BREVO_API_KEY", "RESEND_API_KEY", "EMAIL_FROM"] as const;

async function withMailEnvironment(
  values: Partial<Record<(typeof ENV_NAMES)[number], string>>,
  run: () => Promise<void> | void,
) {
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const name of ENV_NAMES) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("mail stays honestly unavailable when no complete provider is configured", async () => {
  await withMailEnvironment({ EMAIL_FROM: "Sikshya <accounts@example.com>" }, () => {
    assert.equal(isEmailConfigured(), false);
  });
});

test("the free Brevo path uses its API shape and keeps its key in the header", async () => {
  await withMailEnvironment({ BREVO_API_KEY: "brevo-secret", EMAIL_FROM: "Sikshya <accounts@example.com>" }, async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ messageId: "test" }), { status: 201 });
    };
    try {
      assert.equal(isEmailConfigured(), true);
      assert.equal(await sendEmail({ to: "student@example.net", subject: "Verify", text: "Open the link" }), true);
      const request = requests[0];
      assert.equal(request?.url, "https://api.brevo.com/v3/smtp/email");
      assert.equal((request?.init?.headers as Record<string, string>)["api-key"], "brevo-secret");
      const body = JSON.parse(String(request?.init?.body));
      assert.deepEqual(body.sender, { email: "accounts@example.com", name: "Sikshya" });
      assert.deepEqual(body.to, [{ email: "student@example.net" }]);
      assert.equal(JSON.stringify(body).includes("brevo-secret"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("an existing Resend configuration keeps priority during a staged migration", async () => {
  await withMailEnvironment({
    BREVO_API_KEY: "brevo-secret",
    RESEND_API_KEY: "resend-secret",
    EMAIL_FROM: "accounts@example.com",
  }, async () => {
    const originalFetch = globalThis.fetch;
    let endpoint = "";
    globalThis.fetch = async (url) => {
      endpoint = String(url);
      return new Response("{}", { status: 200 });
    };
    try {
      assert.equal(await sendEmail({ to: "student@example.net", subject: "Reset", text: "Open the link" }), true);
      assert.equal(endpoint, "https://api.resend.com/emails");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
