/** Preview-only, single Linux VM. No cloud account, DNS, Railway or production writes. */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
export const versions = Object.freeze({ livekit: 'v1.13.6', caddy: 'v2.11.3' });
export const namespace = 'fadko-selfhost-preview';

export function previewDomain(input) {
  const domain = String(input ?? '').trim().toLowerCase();
  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 3 || !labels.every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^[a-z]{2,63}$/.test(labels.at(-1))) {
    throw new Error('Use a full subdomain only, without https://, a port, a path or spaces.');
  }
  if (!/(?:^|-)(?:preview|staging)(?:-|$)/.test(labels[0])) {
    throw new Error('The first subdomain must include preview or staging, for example livekit-preview.your-domain.com.');
  }
  if (/(?:^|\.)(livekit\.cloud|workers\.dev|railway\.app)$/.test(domain)) {
    throw new Error('Use a domain you control, not a managed Cloud/Workers/Railway address.');
  }
  return domain;
}

export function buildBundle({ domain: rawDomain, turnDomain: rawTurnDomain }) {
  const domain = previewDomain(rawDomain);
  const turnDomain = previewDomain(rawTurnDomain);
  if (domain === turnDomain) throw new Error('Video and TURN need different preview subdomains.');
  const key = `API${randomBytes(12).toString('hex')}`;
  const secret = randomBytes(48).toString('base64url');
  // Same SNI/TLS routing as livekit/deploy's VM generator. JSON is valid YAML;
  // no interpolation of user input into shell or YAML scalar syntax.
  const route = (host, port, signalling = false) => ({
    match: [{ tls: { sni: [host] } }],
    handle: [
      { handler: 'tls', ...(signalling ? { connection_policies: [{ alpn: ['http/1.1'] }] } : {}) },
      { handler: 'proxy', upstreams: [{ dial: [`127.0.0.1:${port}`] }] },
    ],
  });
  const caddy = {
    admin: { listen: '127.0.0.1:2019' },
    logging: { logs: { default: { level: 'WARN' } } },
    storage: { module: 'file_system', root: '/data' },
    apps: {
      tls: {
        certificates: { automate: [domain, turnDomain] },
        automation: { policies: [{ issuers: [{ module: 'acme' }] }] },
      },
      layer4: { servers: { main: { listen: [':443'], routes: [route(turnDomain, 5349), route(domain, 7880, true)] } } },
    },
  };
  const livekit = {
    port: 7880,
    bind_addresses: ['0.0.0.0'],
    rtc: { tcp_port: 7881, port_range_start: 50000, port_range_end: 60000, use_external_ip: true },
    turn: { enabled: true, domain: turnDomain, tls_port: 5349, udp_port: 3478, external_tls: true },
    keys: { [key]: secret },
    logging: { level: 'info', json: true },
  };
  const service = (image, command, volumes) => ({
    image, command, network_mode: 'host', restart: 'unless-stopped',
    volumes, security_opt: ['no-new-privileges:true'],
    logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } },
  });
  const compose = {
    name: 'fadko-livekit-preview',
    services: {
      caddy: service(`livekit/caddyl4:${versions.caddy}`, ['run', '--config', '/etc/caddy.json'],
        ['./caddy.json:/etc/caddy.json:ro', './caddy-data:/data']),
      livekit: { ...service(`livekit/livekit-server:${versions.livekit}`, ['--config', '/etc/livekit.yaml'],
        ['./livekit.yaml:/etc/livekit.yaml:ro']),
        stop_grace_period: '5m', ulimits: { nofile: { soft: 65535, hard: 65535 } } },
    },
  };
  const json = value => JSON.stringify(value, null, 2) + '\n';
  return {
    'compose.yaml': json(compose),
    'caddy.json': json(caddy),
    'livekit.yaml': json(livekit),
    // Deliberately no database, payment, production or frontend environment settings.
    'railway-staging.env': `VIDEO_PROVIDER=livekit\nLIVEKIT_URL=wss://${domain}\nLIVEKIT_API_KEY=${key}\nLIVEKIT_API_SECRET=${secret}\nVIDEO_ROOM_NAMESPACE=${namespace}\n`,
    'preview.json': json({ environment: 'preview', domain, turnDomain, namespace, versions }),
    '.gitignore': '*\n',
  };
}

export function writeBundle(parent, settings) {
  const bundle = buildBundle(settings);
  const domain = previewDomain(settings.domain);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const destination = path.join(parent, domain);
  // An existing directory (including a symlink) is never reused: do not rotate a live key accidentally.
  mkdirSync(destination, { mode: 0o700 });
  for (const [name, contents] of Object.entries(bundle)) {
    writeFileSync(path.join(destination, name), contents, { mode: 0o600, flag: 'wx' });
  }
  writeFileSync(path.join(destination, 'previewctl.sh'), readFileSync(path.join(here, 'previewctl.sh'), 'utf8').replace(/\r\n/g, '\n'),
    { mode: 0o700, flag: 'wx' });
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      domain: { type: 'string' }, 'turn-domain': { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help || !values.domain || !values['turn-domain']) {
      console.log('Preview setup only. No deployments or purchases.\n' +
        'node infra/livekit-preview/generate.mjs --domain livekit-preview.YOUR-DOMAIN --turn-domain turn-preview.YOUR-DOMAIN\n' +
        'Writes a NEW private folder under .local/livekit-preview/. Keys are never printed.');
      if (!values.help) process.exitCode = 1;
    } else {
      const destination = writeBundle(path.resolve(here, '../../.local/livekit-preview'), {
        domain: values.domain, turnDomain: values['turn-domain'],
      });
      console.log(`Prepared preview bundle: ${destination}\nNo service was started or switched. Treat this folder as a secret; do not upload it to Git or chat.\nRead infra/livekit-preview/README.md before deployment.`);
    }
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'That preview bundle already exists. It was not overwritten; reuse its keys.' : error.message);
    process.exitCode = 1;
  }
}
