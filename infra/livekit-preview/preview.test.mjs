import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBundle, previewDomain, writeBundle, versions, namespace } from './generate.mjs';
import { readPreviewSettings, probe } from './probe.mjs';

const settings = { domain: 'livekit-preview.fadko.example', turnDomain: 'turn-preview.fadko.example' };
for (const domain of ['production.fadko.com', 'livekit.fadko.com', 'preview.evil.com/path',
  'preview.evil.com:443', 'https://preview.evil.com', 'preview.evil.com\nkeys:',
  'preview.$(whoami).com', 'preview..com', 'preview.127.0.0.1', '-preview.fadko.com',
  'preview.livekit.cloud', 'preview.workers.dev', 'preview.up.railway.app']) {
  test(`reject unsafe/non-preview hostname: ${JSON.stringify(domain)}`, () => assert.throws(() => previewDomain(domain)));
}
test('normalize only DNS casing and surrounding whitespace', () => {
  assert.equal(previewDomain(' LIVEKIT-Preview.Fadko.example '), settings.domain);
});
test('separate TURN SNI is mandatory', () => assert.throws(() => buildBundle({ ...settings, turnDomain: settings.domain })));
test('independent strong credentials and staging namespace; no unrelated variables', () => {
  const a = buildBundle(settings), b = buildBundle(settings);
  const env = readPreviewSettings(a['railway-staging.env']);
  assert.notEqual(a['railway-staging.env'], b['railway-staging.env']);
  assert.deepEqual(Object.keys(env).sort(), ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL', 'VIDEO_PROVIDER', 'VIDEO_ROOM_NAMESPACE']);
  assert.equal(env.VIDEO_ROOM_NAMESPACE, namespace);
  assert.equal(JSON.parse(a['livekit.yaml']).keys[env.LIVEKIT_API_KEY], env.LIVEKIT_API_SECRET);
  for (const name of ['compose.yaml', 'caddy.json', 'preview.json']) assert.ok(!a[name].includes(env.LIVEKIT_API_SECRET));
});
test('pinned single-node services, bounded logs, read-only configs, no dev mode or recording', () => {
  const compose = JSON.parse(buildBundle(settings)['compose.yaml']);
  assert.deepEqual(Object.keys(compose.services).sort(), ['caddy', 'livekit']);
  assert.equal(compose.services.livekit.image, `livekit/livekit-server:${versions.livekit}`);
  assert.equal(compose.services.caddy.image, `livekit/caddyl4:${versions.caddy}`);
  for (const service of Object.values(compose.services)) {
    assert.equal(service.network_mode, 'host');
    assert.equal(service.restart, 'unless-stopped');
    assert.equal(service.logging.options['max-size'], '10m');
    assert.ok(!service.command.includes('--dev'));
    assert.ok(service.volumes[0].endsWith(':ro'));
  }
});
test('TLS 443 routes TURN and signalling independently; admin loopback only', () => {
  const bundle = buildBundle(settings);
  const caddy = JSON.parse(bundle['caddy.json']);
  assert.equal(caddy.admin.listen, '127.0.0.1:2019');
  assert.deepEqual(caddy.apps.tls.certificates.automate, [settings.domain, settings.turnDomain]);
  const routes = caddy.apps.layer4.servers.main.routes;
  assert.deepEqual(routes[0].handle[1].upstreams[0].dial, ['127.0.0.1:5349']);
  assert.deepEqual(routes[1].handle[1].upstreams[0].dial, ['127.0.0.1:7880']);
  assert.equal(JSON.parse(bundle['livekit.yaml']).turn.external_tls, true);
});
test('write NEW private bundle and refuse accidental regeneration/key rotation', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'fadko-preview-test-'));
  try {
    const destination = writeBundle(parent, settings);
    const original = readFileSync(path.join(destination, 'livekit.yaml'), 'utf8');
    assert.throws(() => writeBundle(parent, settings), { code: 'EEXIST' });
    assert.equal(readFileSync(path.join(destination, 'livekit.yaml'), 'utf8'), original);
    assert.equal(readFileSync(path.join(destination, '.gitignore'), 'utf8'), '*\n');
    assert.ok(!readFileSync(path.join(destination, 'previewctl.sh'), 'utf8').includes('\r'));
    if (process.platform !== 'win32') assert.equal(statSync(path.join(destination, 'livekit.yaml')).mode & 0o777, 0o600);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
test('probe cannot accidentally use production, Cloud keys, or insecure/credential-bearing URLs', () => {
  const source = buildBundle(settings)['railway-staging.env'];
  for (const text of [source.replace(namespace, 'production'), source.replace('wss:', 'ws:'),
    source.replace(settings.domain, 'production.fadko.example'), source.replace(settings.domain, `user:secret@${settings.domain}`),
    source.replace(settings.domain, `${settings.domain}/rtc`), source.replace(settings.domain, `${settings.domain}?key=private`)]) {
    assert.throws(() => readPreviewSettings(text));
  }
});
test('probe is read-only, bounded, redirects forbidden, and does not expose room names or secrets', async () => {
  const originalFetch = globalThis.fetch;
  const env = readPreviewSettings(buildBundle(settings)['railway-staging.env']);
  try {
    globalThis.fetch = async (url, request) => {
      assert.ok(url.endsWith('/twirp/livekit.RoomService/ListRooms'));
      assert.equal(request.redirect, 'error');
      assert.ok(request.signal instanceof AbortSignal);
      const claims = JSON.parse(Buffer.from(request.headers.Authorization.split('.')[1], 'base64url'));
      assert.deepEqual(claims.video, { roomList: true });
      return Response.json({ rooms: [{ name: 'private-test-room' }] });
    };
    const result = await probe(env);
    assert.equal(result.ok, true);
    assert.match(result.message, /Open rooms: 1/);
    assert.ok(!result.message.includes('private-test-room'));
    globalThis.fetch = async () => { throw new Error(env.LIVEKIT_API_SECRET); };
    const failed = await probe(env);
    assert.equal(failed.ok, false);
    assert.ok(!failed.message.includes(env.LIVEKIT_API_SECRET));
    globalThis.fetch = async () => new Response('secret-error-body', { status: 401 });
    assert.match((await probe(env)).message, /rejected authentication/);
  } finally { globalThis.fetch = originalFetch; }
});
