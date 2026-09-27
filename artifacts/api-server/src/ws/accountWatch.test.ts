import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { watchSocketAccount } from "./accountWatch.ts";

class Socket extends EventEmitter {
  readyState = 1;
  terminated = 0;
  terminate() { this.terminated++; this.readyState = 3; this.emit("close"); }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test("open socket loses access after account revocation", async () => {
  const ws = new Socket(); let permitted = true;
  const stop = watchSocketAccount(ws, async () => permitted, 5, 100);
  try {
    await sleep(25); assert.equal(ws.terminated, 0);
    permitted = false; await sleep(30); assert.equal(ws.terminated, 1);
  } finally { stop(); }
});
test("access errors and stalled checks fail closed", async () => {
  for (const check of [async () => { throw Error("unavailable"); }, () => new Promise<boolean>(() => {})]) {
    const ws = new Socket(); const stop = watchSocketAccount(ws, check, 5, 10);
    try { await sleep(40); assert.equal(ws.terminated, 1); } finally { stop(); }
  }
});
test("checks never overlap and closed sockets stop querying", async () => {
  const ws = new Socket(); let calls = 0; let finish!: (v: boolean) => void;
  const stop = watchSocketAccount(ws, () => { calls++; return new Promise(resolve => { finish = resolve; }); }, 5, 1000);
  try {
    await sleep(30); assert.equal(calls, 1);
    ws.readyState = 3; ws.emit("close"); finish(true);
    await sleep(25); assert.equal(calls, 1); assert.equal(ws.terminated, 0);
  } finally { stop(); }
});
