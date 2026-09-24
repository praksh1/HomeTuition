/** Read-only authenticated control-plane check. No room creation, tokens or secrets in output. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { namespace, previewDomain } from './generate.mjs';

export function readPreviewSettings(text) {
  const env = Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1).trim()];
  }));
  if (env.VIDEO_PROVIDER !== 'livekit' || env.VIDEO_ROOM_NAMESPACE !== namespace) throw new Error('Not this preview bundle. Refusing to check another environment.');
  let url;
  try { url = new URL(env.LIVEKIT_URL); } catch { throw new Error('Invalid preview server URL.'); }
  if (url.protocol !== 'wss:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the generated secure preview address without credentials, port, path or query.');
  previewDomain(url.hostname);
  if (!/^API[a-f0-9]{24}$/.test(env.LIVEKIT_API_KEY ?? '') || !/^[A-Za-z0-9_-]{64}$/.test(env.LIVEKIT_API_SECRET ?? '')) throw new Error('The generated preview key pair is missing or malformed. Values have not been displayed.');
  return env;
}

export async function probe(env) {
  const require = createRequire(new URL('../../artifacts/api-server/package.json', import.meta.url));
  const { AccessToken } = require('livekit-server-sdk');
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { ttl: 60 });
  token.addGrant({ roomList: true });
  try {
    const result = await fetch(env.LIVEKIT_URL.replace('wss:', 'https:') + '/twirp/livekit.RoomService/ListRooms', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token.toJwt()}` },
      body: '{}',
    });
    if (!result.ok) return { ok: false, message: result.status === 401 || result.status === 403
      ? 'The preview server rejected authentication. Check that Railway staging and this VM use the SAME generated pair.'
      : `The preview API returned HTTP ${result.status}. Check the private VM logs and TLS routing.` };
    const data = await result.json();
    if (!Array.isArray(data.rooms)) return { ok: false, message: 'The endpoint did not return a LiveKit room list. Check the Caddy route.' };
    return { ok: true, message: `Preview TLS and authenticated LiveKit API work. Open rooms: ${data.rooms.length}. Media/UDP/TURN are NOT verified by this check.` };
  } catch {
    // Deliberately never echo a provider error body, signed token or request headers.
    return { ok: false, message: 'Could not confirm the preview API within 10 seconds. Check DNS, certificates, VM availability and TCP 443. Do not switch staging yet.' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { file: { type: 'string' } } });
    if (!values.file) throw new Error('Specify --file with the generated railway-staging.env path. No root .env is loaded.');
    const result = await probe(readPreviewSettings(readFileSync(values.file, 'utf8')));
    console.log(result.message);
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    console.error('Cannot read a valid preview-only settings file. Nothing was changed; no credentials were printed.');
    process.exitCode = 1;
  }
}
