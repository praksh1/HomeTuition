import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectHost, plannedListeners, validatePlan } from './preflight.mjs';
import { newDirectoryPath, readOrdinaryFile } from './ordinary-path.mjs';

const bundle = dirname(fileURLToPath(import.meta.url));
const assignedIpv4 = '203.0.113.25';
const secret = 'synthetic-value-must-stay-out-of-diagnostics';
const temp = () => mkdtempSync(join(tmpdir(), 'fadko-livekit-'));
const json = (directory, name) => JSON.parse(readFileSync(join(directory, name), 'utf8'));

function render(profile, directory) {
  const input = join(directory, 'profile.json');
  const output = join(directory, 'candidate');
  writeFileSync(input, JSON.stringify(profile), { flag: 'wx' });
  const result = spawnSync(process.execPath, [join(bundle, 'render-config.mjs'), input, output], {
    encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL',
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
  assert.equal(result.status, 0, result.stderr);
  return output;
}

function samplePlan() {
  return json(render(json(bundle, 'profile.example.json'), temp()), 'network-plan.json');
}

function observations() {
  const calls = [];
  return {
    calls,
    command(program, args) {
      calls.push([program, ...args]);
      if (program === '/reviewed/livekit') return { status: 0, stdout: 'livekit-server version 1.13.11' };
      if (program === '/reviewed/caddy' && args[0] === 'version') return { status: 0, stdout: 'v2.11.9' };
      if (program === '/reviewed/caddy' && args[0] === 'list-modules') {
        return { status: 0, stdout: 'layer4.handlers.proxy\nlayer4.handlers.tls\nlayer4.matchers.tls' };
      }
      assert.equal(program, 'ss');
      assert.deepEqual(args, ['-H', '-lntu']);
      return { status: 0, stdout: '' };
    },
    async lookup() { return [{ values: [assignedIpv4] }, { error: 'ENODATA' }]; },
    capacity() { return { logicalCpus: 2, memoryAvailableMiB: 1200 }; },
  };
}
function options(plan = samplePlan()) {
  return { plan, assignedIpv4, livekitBinary: '/reviewed/livekit', caddyBinary: '/reviewed/caddy', directory: '/synthetic' };
}

test('Portable configuration covers Dallas, India and Singapore', () => {
  for (const region of ['dallas-pilot', 'mumbai-pilot', 'singapore-pilot']) {
    const output = render({
      region,
      signalingHost: 'media-' + region + '.example.net',
      turnHost: 'turn-' + region + '.example.net',
      advertisedIpv4: region === 'mumbai-pilot' ? assignedIpv4 : null,
    }, temp());
    const config = json(output, 'livekit.json');
    const network = json(output, 'network-plan.json');
    assert.equal(config.rtc.require_ipv4, true);
    assert.equal(config.room.auto_create, false);
    assert.equal(network.applicationEnvironment.VIDEO_ROOM_NAMESPACE, 'fadko-' + region);
    assert.equal(config.rtc.use_external_ip, region !== 'mumbai-pilot');
    if (region === 'mumbai-pilot') assert.equal(config.rtc.node_ip, assignedIpv4);
    else assert.equal(Object.hasOwn(config.rtc, 'node_ip'), false);
    assert.equal(network.signalingUrl, 'wss://media-' + region + '.example.net');
    assert.deepEqual(network.privateTcp, [7880, 17880, 5349]);
    assert.deepEqual(config.bind_addresses, ['127.0.0.1']);
    assert.equal(config.turn.proxy_protocol, true);
    assert.deepEqual(config.turn.proxy_protocol_trusted_cidrs, ['127.0.0.1/32']);
    const proxy = json(output, 'caddy.json');
    assert.equal(proxy.admin.disabled, true);
    const signaling = proxy.apps.http.servers.signaling;
    assert.deepEqual(signaling.listen, ['127.0.0.1:17880']);
    assert.deepEqual(signaling.routes[1].handle, [{ handler: 'static_response', status_code: 404 }]);
    assert.deepEqual(signaling.routes[0].match[0].path, [
      '/rtc', '/rtc/validate', '/rtc/v1', '/rtc/v1/validate', '/twirp/livekit.RoomService/*',
    ]);
    assert.equal(proxy.apps.layer4.servers.public.routes[0].handle[1].proxy_protocol, 'v2');
    assert.deepEqual(proxy.apps.layer4.servers.public.routes.map((route) => route.match[0].tls.sni), [
      ['turn-' + region + '.example.net'], ['media-' + region + '.example.net'],
    ]);
  }
});

test('Invalid plans fail before host observations', async () => {
  const plan = samplePlan();
  for (const edit of [
    (value) => { value.extra = secret; },
    (value) => { value.dns[0].extra = secret; },
    (value) => { value.publicTcp = [80, 444, 7881]; },
    (value) => { value.dns[0].proxied = true; },
    (value) => { value.applicationEnvironment.extra = secret; },
    (value) => { value.signalingUrl = 'wss://user:secret@media.example.net'; },
  ]) {
    const invalid = structuredClone(plan);
    edit(invalid);
    const probes = observations();
    await assert.rejects(inspectHost(options(invalid), probes));
    assert.equal(probes.calls.length, 0);
  }
  assert.throws(() => validatePlan(plan, '2001:db8::25'));
});

test('IPv4 and IPv6 listeners expose planned port conflicts', () => {
  assert.deepEqual(plannedListeners([
    'tcp LISTEN 0 128 [::]:443 [::]:*',
    'udp UNCONN 0 0 0.0.0.0:7884 0.0.0.0:*',
    'tcp LISTEN 0 128 127.0.0.1:29999 0.0.0.0:*',
  ].join('\n')), [
    { protocol: 'tcp', address: '::', port: 443 },
    { protocol: 'udp', address: '0.0.0.0', port: 7884 },
  ]);
  assert.throws(() => plannedListeners(secret));
});

test('Clean mocked host retains TLS and media verification requirements', async () => {
  const probes = observations();
  const report = await inspectHost(options(), probes);
  assert.equal(report.status, 'CHECKS_PASSED');
  assert.deepEqual(probes.calls, [
    ['/reviewed/livekit', '--version'], ['/reviewed/caddy', 'version'],
    ['/reviewed/caddy', 'list-modules'], ['ss', '-H', '-lntu'],
  ]);
  assert(report.remainingVerification.some((item) => item.includes('TURN/TLS')));
});

test('DNS failures stay unknown and observed mismatches block', async () => {
  for (const [answers, expected] of [
    [[{ values: [assignedIpv4] }, { error: 'ETIMEOUT' }], 'UNKNOWN'],
    [[{ values: [assignedIpv4] }, { error: secret }], 'UNKNOWN'],
    [[{ values: ['203.0.113.26'] }, { error: 'ENODATA' }], 'BLOCKED'],
    [[{ values: [assignedIpv4] }, { values: ['2001:db8::25'] }], 'BLOCKED'],
  ]) {
    const probes = observations();
    probes.lookup = async () => answers;
    const report = await inspectHost(options(), probes);
    assert.equal(report.status, 'ACTION_REQUIRED');
    assert(report.checks.filter((item) => item.name.startsWith('recursiveDns:'))
      .every((item) => item.status === expected));
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});

test('Profile and output reject linked ancestors', () => {
  const root = temp();
  const target = join(root, 'ordinary');
  const linked = join(root, 'linked');
  mkdirSync(target);
  writeFileSync(join(target, 'profile.json'), '{}', { flag: 'wx' });
  symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readOrdinaryFile(join(linked, 'profile.json')), /ordinary path/);
  assert.throws(() => newDirectoryPath(join(linked, 'candidate')), /ordinary path/);
  assert.equal(existsSync(join(target, 'candidate')), false);
});

test('Existing outputs and oversized profiles are protected', () => {
  const root = temp();
  const output = render(json(bundle, 'profile.example.json'), root);
  const original = readFileSync(join(output, 'network-plan.json'));
  const repeated = spawnSync(process.execPath, [
    join(bundle, 'render-config.mjs'), join(root, 'profile.json'), output,
  ], {
    encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL',
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
  assert.equal(repeated.status, 1);
  assert.deepEqual(readFileSync(join(output, 'network-plan.json')), original);
  const oversized = join(root, 'oversized.json');
  writeFileSync(oversized, ' '.repeat(65537), { flag: 'wx' });
  assert.throws(() => readOrdinaryFile(oversized), /size limit/);
});
