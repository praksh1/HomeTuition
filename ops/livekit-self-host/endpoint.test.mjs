import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';

const source = new URL('../../artifacts/api-server/src/lib/video/', import.meta.url);
const providerUrl = new URL('livekitProvider.ts', source).href;
const diagnosisUrl = new URL('diagnose.ts', source).href;
const endpointUrl = new URL('livekitEndpoint.ts', source).href;
const identityUrl = new URL('participantIdentity.ts', source).href;
const roomUrl = new URL('roomName.ts', source).href;
const stateKey = Symbol.for('fadko.livekit.endpoint.synthetic');
const state = globalThis[stateKey] = { calls: [], logs: [], participants: [], signingError: false, reachError: null };
const sdkUrl = 'data:text/javascript,' + encodeURIComponent(`
  const state = globalThis[Symbol.for('fadko.livekit.endpoint.synthetic')];
  export const TrackSource = { CAMERA: 1, MICROPHONE: 2, SCREEN_SHARE: 3, SCREEN_SHARE_AUDIO: 4 };
  export class AccessToken {
    constructor(key, secret, options) { state.calls.push(['token', key, secret, options]); }
    addGrant(grant) { this.grant = grant; state.calls.push(['grant', grant]); }
    async toJwt() {
      if (state.signingError) throw new Error('synthetic-signing-secret-do-not-show');
      return 'synthetic.' + Buffer.from(JSON.stringify({ video: this.grant })).toString('base64url') + '.unsigned';
    }
  }
  export class RoomServiceClient {
    constructor(origin, key, secret) { state.calls.push(['client', origin, key, secret]); }
    async updateParticipant(...args) { state.calls.push(['update', ...args]); }
    async listParticipants(...args) { state.calls.push(['participants', ...args]); return state.participants; }
    async mutePublishedTrack(...args) { state.calls.push(['mute', ...args]); }
    async listRooms() {
      state.calls.push(['rooms']);
      if (state.reachError) throw new Error(state.reachError);
      return [];
    }
  }
`);
const loggerUrl = 'data:text/javascript,' + encodeURIComponent(`
  const state = globalThis[Symbol.for('fadko.livekit.endpoint.synthetic')];
  const record = (...args) => state.logs.push(args);
  export const logger = { warn: record, error: record };
`);

// Exact import closure. No installed SDK/logger, application entrypoint or network is loaded.
const parents = new Set([providerUrl, diagnosisUrl, endpointUrl, identityUrl, roomUrl]);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (parents.has(context.parentURL)) {
      if (specifier === 'livekit-server-sdk' && [providerUrl, diagnosisUrl].includes(context.parentURL)) {
        return { url: sdkUrl, shortCircuit: true };
      }
      if (specifier === '../logger' && context.parentURL === providerUrl) {
        return { url: loggerUrl, shortCircuit: true };
      }
      const local = new Map([
        ['./livekitEndpoint.ts', endpointUrl],
        ['./participantIdentity', identityUrl],
        ['./roomName', roomUrl],
      ]);
      if (local.has(specifier)) return { url: local.get(specifier), shortCircuit: true };
      throw new Error('Unexpected dependency in the reviewed LiveKit test closure');
    }
    return nextResolve(specifier, context);
  },
});
after(() => { hooks.deregister(); delete globalThis[stateKey]; });

const { parseLiveKitEndpoint } = await import(endpointUrl);
const { inspectSettings, settingsUsable, diagnoseVideo, describeReachFailure } = await import(diagnosisUrl);
const { livekitProvider } = await import(providerUrl);
const synthetic = {
  VIDEO_PROVIDER: 'livekit',
  LIVEKIT_API_KEY: 'synthetic-key',
  LIVEKIT_API_SECRET: 'synthetic-only-not-a-real-secret-123456',
  LIVEKIT_URL: 'wss://dallas.example.test',
};
beforeEach(() => {
  Object.assign(process.env, synthetic, { VIDEO_ROOM_NAMESPACE: 'pilot-dallas' });
  state.calls.length = 0;
  state.logs.length = 0;
  state.participants = [];
  state.signingError = false;
  state.reachError = null;
});

test('Cloud, self-hosted and loopback origins share one canonical address rule', () => {
  for (const [input, socketUrl, apiOrigin] of [
    [' WSS://Example.LiveKit.Cloud:443/ ', 'wss://example.livekit.cloud', 'https://example.livekit.cloud'],
    ['wss://singapore.example.test:8443', 'wss://singapore.example.test:8443', 'https://singapore.example.test:8443'],
    ['wss://[2001:db8::1]:8443/', 'wss://[2001:db8::1]:8443', 'https://[2001:db8::1]:8443'],
    ['ws://127.0.0.1:7880/', 'ws://127.0.0.1:7880', 'http://127.0.0.1:7880'],
    ['ws://LOCALHOST:80', 'ws://localhost', 'http://localhost'],
    ['ws://[::1]:7880', 'ws://[::1]:7880', 'http://[::1]:7880'],
  ]) assert.deepEqual(parseLiveKitEndpoint(input), { socketUrl, apiOrigin }, input);
});

const invalid = [
  undefined, '', ' ', 'https://example.test', 'wss://', 'wss://user:password@example.test',
  'wss://@example.test', 'wss://example.test/path', 'wss://example.test/a/..',
  'wss://example.test/./', 'wss://example.test/%2e', 'wss://example.test//',
  'wss://example.test?', 'wss://example.test#', 'wss://example.test?key=private',
  'wss://example.test#private', 'wss://%65xample.test', 'wss://example.test\\path',
  'wss://example.\ntest', '\twss://example.test', 'wss://example.test\r',
  'wss://example.test:0', 'wss://example.test:00000', 'wss://example.test:',
  'wss://example.test:65536', 'wss://example.test:abc', 'wss://example .test',
  'ws://public.example.test', 'ws://localhost.example.test', 'ws://127.0.0.1.example.test',
  'ws://127.1:7880', 'ws://[::ffff:127.0.0.1]:7880',
];

test('malformed and insecure remote endpoints fail before any SDK operation', async () => {
  for (const input of invalid) {
    assert.equal(parseLiveKitEndpoint(input), null, String(input));
    if (input === undefined) delete process.env.LIVEKIT_URL;
    else process.env.LIVEKIT_URL = input;
    assert.equal(livekitProvider.configured(), false);
    assert.equal(await livekitProvider.ensureRoom(42), '');
    assert.equal(await livekitProvider.joinToken(42, { userId: 7, userName: 'Synthetic student', isOwner: false }), null);
    assert.equal((await livekitProvider.setPublishing(42, 7, { canPublish: true, mic: true, camera: false })).reason, 'failed');
    assert.equal((await livekitProvider.silence(42, 7)).reason, 'failed');
    const result = await diagnoseVideo({ ...synthetic, LIVEKIT_URL: input });
    assert.equal(result.healthy, false);
    assert.equal(result.findings.find(f => f.id === 'url').verdict, 'wrong');
    assert.deepEqual(state.calls, []);
  }
});

test('safe diagnostics redact malformed URL credentials and unexpected provider errors', () => {
  for (const value of [
    'wss://username:synthetic-url-password@example.test',
    'https://example.test/?secret=synthetic-url-password',
    'wss://example.test/#synthetic-url-password',
    'https://username:synthetic-url-password@example.test',
  ]) {
    const findings = inspectSettings({ ...synthetic, LIVEKIT_URL: value });
    assert.equal(settingsUsable(findings), false);
    assert.equal(JSON.stringify(findings).includes('synthetic-url-password'), false);
    assert.equal(JSON.stringify(findings).includes(synthetic.LIVEKIT_API_SECRET), false);
  }
  const correction = inspectSettings({ ...synthetic, LIVEKIT_URL: 'HTTPS://Dallas.Example.Test:443/' });
  assert.match(correction.find(f => f.id === 'url').fix, /wss:\/\/dallas\.example\.test$/);
  for (const message of ['unexpected synthetic-error-secret', '401 synthetic-error-secret', 'ENOTFOUND synthetic-error-secret', 'ETIMEDOUT synthetic-error-secret']) {
    assert.equal(JSON.stringify(describeReachFailure(message)).includes('synthetic-error-secret'), false);
  }
  assert.equal(describeReachFailure('401').verdict, 'wrong');
  assert.equal(describeReachFailure('ENOTFOUND').verdict, 'wrong');
  assert.equal(describeReachFailure('ETIMEDOUT').verdict, 'unknown');
});

test('valid server relocation preserves room, identity and audience permissions', async () => {
  process.env.LIVEKIT_URL = ' WSS://Singapore.Example.Test:8443/ ';
  assert.equal(livekitProvider.configured(), true);
  assert.equal(await livekitProvider.ensureRoom(42), 'wss://singapore.example.test:8443');
  assert.deepEqual(state.calls, []);
  const token = await livekitProvider.joinToken(42, { userId: 7, userName: 'Synthetic student', isOwner: false });
  assert.match(token, /^synthetic\./);
  assert.equal(state.calls[0][3].identity, '7');
  assert.equal(state.calls[0][3].ttl, 28800);
  const grant = state.calls.find(call => call[0] === 'grant')[1];
  assert.equal(grant.room, 'pilot-dallas-sikshya42');
  assert.equal(grant.roomJoin, true);
  assert.equal(grant.roomAdmin, false);
  assert.equal(grant.canPublish, false);
  assert.equal(grant.canPublishData, false);
  assert.deepEqual(grant.canPublishSources, []);
  assert.deepEqual(await livekitProvider.setPublishing(42, 7, { canPublish: true, mic: true, camera: false }), { applied: true });
  assert.deepEqual(state.calls.find(call => call[0] === 'client'), ['client', 'https://singapore.example.test:8443', synthetic.LIVEKIT_API_KEY, synthetic.LIVEKIT_API_SECRET]);
  assert.deepEqual(state.calls.find(call => call[0] === 'update'), ['update', 'pilot-dallas-sikshya42', '7', undefined, {
    canSubscribe: true, canPublish: true, canPublishData: false, canPublishSources: [2],
  }]);
  state.participants = [{ identity: '7', tracks: [{ sid: 'synthetic-mic', source: 2, muted: false }] }];
  assert.deepEqual(await livekitProvider.silence(42, 7), { applied: true });
  assert.deepEqual(state.calls.filter(call => call[0] === 'client').map(call => call[1]), Array(2).fill('https://singapore.example.test:8443'));
  assert.deepEqual(state.calls.find(call => call[0] === 'mute'), ['mute', 'pilot-dallas-sikshya42', '7', 'synthetic-mic', true]);
});

test('diagnostics use the same API origin with synthetic SDK responses only', async () => {
  const result = await diagnoseVideo({ ...synthetic, LIVEKIT_URL: 'wss://Singapore.Example.Test:8443/' });
  assert.equal(result.healthy, true);
  assert.equal(result.findings.find(f => f.id === 'url').title, 'Server address is wss://singapore.example.test:8443');
  assert.equal(state.calls.find(call => call[0] === 'client')[1], 'https://singapore.example.test:8443');
  assert.equal(JSON.stringify(result).includes(synthetic.LIVEKIT_API_SECRET), false);
  state.reachError = 'synthetic-unexpected-secret-do-not-show';
  assert.equal(JSON.stringify(await diagnoseVideo(synthetic)).includes(state.reachError), false);
  state.signingError = true;
  const badSigning = await diagnoseVideo(synthetic);
  assert.equal(badSigning.healthy, false);
  assert.equal(badSigning.findings.find(f => f.id === 'sign').verdict, 'wrong');
  assert.equal(JSON.stringify(badSigning).includes('synthetic-signing-secret-do-not-show'), false);
});
