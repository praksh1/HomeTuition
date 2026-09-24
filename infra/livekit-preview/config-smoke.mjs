/** CI ONLY: boot the actual generated SFU config (not --dev), then authenticated API checks. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeBundle } from './generate.mjs';
import { readPreviewSettings, probe } from './probe.mjs';

assert.ok(process.env.LIVEKIT_SERVER_BIN, 'LIVEKIT_SERVER_BIN is required; this test must not silently skip.');
const require = createRequire(new URL('../../artifacts/api-server/package.json', import.meta.url));
const { RoomServiceClient } = require('livekit-server-sdk');
const parent = mkdtempSync(path.join(tmpdir(), 'fadko-sfu-config-'));
let server, stop;
try {
  const directory = writeBundle(parent, { domain: 'livekit-preview.fadko.example', turnDomain: 'turn-preview.fadko.example' });
  const env = readPreviewSettings(readFileSync(path.join(directory, 'railway-staging.env'), 'utf8'));
  const configFile = path.join(directory, 'livekit.yaml');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  // CI has no public IP or certificate. Only network discovery/bind differ from the VM bundle.
  config.bind_addresses = ['127.0.0.1'];
  config.rtc.use_external_ip = false;
  config.rtc.node_ip = '127.0.0.1';
  writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  server = spawn(process.env.LIVEKIT_SERVER_BIN, ['--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', launchError;
  server.stdout.on('data', data => { output = (output + data.toString()).slice(-6000); });
  server.stderr.on('data', data => { output = (output + data.toString()).slice(-6000); });
  server.on('error', err => { launchError = err; });
  stop = new Promise(resolve => server.once('close', resolve));
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (launchError || server.exitCode !== null) break;
    try { ready = (await fetch('http://127.0.0.1:7880/', { signal: AbortSignal.timeout(400) })).ok; } catch {}
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw new Error(`Generated LiveKit config failed to start: ${output.replaceAll(env.LIVEKIT_API_SECRET, '[redacted]').replaceAll(env.LIVEKIT_API_KEY, '[redacted]')}`);
  const rooms = new RoomServiceClient('http://127.0.0.1:7880', env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  assert.deepEqual(await rooms.listRooms(), []);
  const nativeFetch = globalThis.fetch;
  try {
    // Exercise the real probe against the local SFU. Only this disposable test rewrites
    // transport; the shipping probe always requires public, certificate-verified HTTPS.
    globalThis.fetch = (url, options) => nativeFetch(`http://127.0.0.1:7880${new URL(url).pathname}`, options);
    const result = await probe(env);
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /Open rooms: 0/);
  } finally { globalThis.fetch = nativeFetch; }
  const wrong = new RoomServiceClient('http://127.0.0.1:7880', 'devkey', 'secret');
  await assert.rejects(() => wrong.listRooms());
  const name = 'fadko-selfhost-preview-smoke';
  await rooms.createRoom({ name, emptyTimeout: 10 });
  assert.ok((await rooms.listRooms()).some(room => room.name === name));
  await rooms.deleteRoom(name);
  assert.equal((await rooms.listRooms()).length, 0);
  console.log('PASS: generated non-dev SFU starts, accepts its separate key, rejects dev credentials, and manages an isolated room. Public TLS/media/TURN not covered here.');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await stop;
    clearTimeout(timer);
  }
  rmSync(parent, { recursive: true, force: true });
}
