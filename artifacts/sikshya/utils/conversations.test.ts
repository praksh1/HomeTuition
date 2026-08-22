import assert from "node:assert/strict";
import { test } from "node:test";
import { unreadTotal } from "./conversations.ts";

test("nothing unread is nothing to show", () => {
  assert.equal(unreadTotal([{ unreadCount: 0 }, { unreadCount: 0 }]), 0);
});

test("unread messages are counted, not unread conversations", () => {
  // Two from one person and three from another is five waiting messages, which is what the
  // badge on the tab bar says. The two must not disagree.
  assert.equal(unreadTotal([{ unreadCount: 2 }, { unreadCount: 3 }]), 5);
});

test("read conversations add nothing", () => {
  assert.equal(unreadTotal([{ unreadCount: 4 }, { unreadCount: 0 }]), 4);
});

test("an empty list is zero, not an error", () => {
  assert.equal(unreadTotal([]), 0);
});

test("a missing or nonsense count is treated as none", () => {
  // Rather than rendering a badge that says "NaN", which is what an unguarded sum does.
  assert.equal(unreadTotal([{} as never, { unreadCount: "x" } as never, { unreadCount: 2 }]), 2);
});

test("a negative count cannot subtract from the total", () => {
  assert.equal(unreadTotal([{ unreadCount: -5 }, { unreadCount: 3 }]), 3);
});
