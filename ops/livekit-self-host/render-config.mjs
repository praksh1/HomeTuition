import { mkdirSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { join } from 'node:path';
import { newDirectoryPath, readOrdinaryFile } from './ordinary-path.mjs';

const ports = Object.freeze({
  https: 443,
  acme: 80,
  api: 7880,
  signalingFilter: 17880,
  iceTcp: 7881,
  iceUdp: '7882-7885',
  turnUdp: 3478,
  turnUpstream: 5349,
});
const serverVersion = '1.13.11';
const keysPath = '/etc/fadko-livekit/keys.yaml';
const loopback = '127.0.0.1';
const profileFields = ['region', 'signalingHost', 'turnHost', 'advertisedIpv4'];

function readProfile(path) {
  let body;
  try {
    body = readOrdinaryFile(path);
  } catch {
    throw new Error('Could not read the profile file.');
  }

  let input;
  try {
    input = JSON.parse(body.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Profile must be valid UTF-8 JSON.');
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((field) => !profileFields.includes(field))) {
    throw new Error('Profile must contain only region, signalingHost, turnHost and optional advertisedIpv4.');
  }
  if (typeof input.region !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(input.region)) {
    throw new Error('Region must start with a lowercase letter and use at most 24 letters, digits or hyphens.');
  }

  const signalingHost = readHostname(input.signalingHost, 'signalingHost');
  const turnHost = readHostname(input.turnHost, 'turnHost');
  if (signalingHost === turnHost) throw new Error('Signaling and TURN need separate hostnames.');

  const advertisedIpv4 = input.advertisedIpv4 ?? null;
  if (advertisedIpv4 !== null && (typeof advertisedIpv4 !== 'string' || !isIPv4(advertisedIpv4))) {
    throw new Error('advertisedIpv4 must be null for automatic detection or an IPv4 address.');
  }
  return { region: input.region, signalingHost, turnHost, advertisedIpv4 };
}

function readHostname(value, field) {
  if (typeof value !== 'string' || value.length > 253) {
    throw new Error(field + ' must be a DNS hostname.');
  }
  const hostname = value.toLowerCase();
  const labels = hostname.split('.');
  if (labels.length < 2 || !/^[a-z]/.test(labels.at(-1))
      || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error(field + ' must be a DNS hostname with no scheme, port, path or wildcard.');
  }
  return hostname;
}

function liveKitConfig(profile) {
  const rtc = {
    tcp_port: ports.iceTcp,
    udp_port: ports.iceUdp,
    require_ipv4: true,
    use_external_ip: profile.advertisedIpv4 === null,
  };
  if (profile.advertisedIpv4 !== null) rtc.node_ip = profile.advertisedIpv4;

  return {
    port: ports.api,
    bind_addresses: [loopback],
    region: profile.region,
    key_file: keysPath,
    rtc,
    room: { auto_create: false, max_participants: 4 },
    turn: {
      enabled: true,
      domain: profile.turnHost,
      external_tls: true,
      tls_port: ports.turnUpstream,
      udp_port: ports.turnUdp,
      proxy_protocol: true,
      proxy_protocol_trusted_cidrs: [loopback + '/32'],
    },
  };
}

function caddyConfig({ signalingHost, turnHost }) {
  const layer4 = {
    listen: [':' + ports.https],
    routes: [
      {
        match: [{ tls: { sni: [turnHost] } }],
        handle: [
          { handler: 'tls' },
          {
            handler: 'proxy',
            proxy_protocol: 'v2',
            upstreams: [{ dial: [loopback + ':' + ports.turnUpstream] }],
          },
        ],
      },
      {
        match: [{ tls: { sni: [signalingHost] } }],
        handle: [
          { handler: 'tls', connection_policies: [{ alpn: ['http/1.1'] }] },
          { handler: 'proxy', upstreams: [{ dial: [loopback + ':' + ports.signalingFilter] }] },
        ],
      },
    ],
  };

  return {
    admin: { disabled: true },
    storage: { module: 'file_system', root: '/var/lib/fadko-livekit/caddy' },
    apps: {
      tls: {
        certificates: { automate: [signalingHost, turnHost] },
        automation: {
          policies: [{
            subjects: [signalingHost, turnHost],
            issuers: [{
              module: 'acme',
              ca: 'https://acme-v02.api.letsencrypt.org/directory',
              challenges: { 'tls-alpn': { disabled: true } },
            }],
          }],
        },
      },
      layer4: { servers: { public: layer4 } },
      http: {
        servers: {
          signaling: {
            listen: [loopback + ':' + ports.signalingFilter],
            automatic_https: { disable: true },
            routes: [
              {
                match: [{
                  host: [signalingHost],
                  path: [
                    '/rtc',
                    '/rtc/validate',
                    '/rtc/v1',
                    '/rtc/v1/validate',
                    '/twirp/livekit.RoomService/*',
                  ],
                }],
                handle: [{
                  handler: 'reverse_proxy',
                  upstreams: [{ dial: loopback + ':' + ports.api }],
                }],
              },
              { handle: [{ handler: 'static_response', status_code: 404 }] },
            ],
          },
        },
      },
    },
  };
}

function networkPlan(profile) {
  return {
    livekitVersion: serverVersion,
    region: profile.region,
    signalingUrl: 'wss://' + profile.signalingHost,
    turnTlsUrl: 'turns:' + profile.turnHost + ':' + ports.https + '?transport=tcp',
    dns: [profile.signalingHost, profile.turnHost].map((name) => ({
      name,
      type: 'A',
      target: profile.advertisedIpv4,
      proxied: false,
    })),
    publicTcp: [ports.acme, ports.https, ports.iceTcp],
    publicUdp: [String(ports.turnUdp), ports.iceUdp],
    privateTcp: [ports.api, ports.signalingFilter, ports.turnUpstream],
    applicationEnvironment: {
      LIVEKIT_URL: 'wss://' + profile.signalingHost,
      VIDEO_ROOM_NAMESPACE: 'fadko-' + profile.region,
    },
  };
}

function writeBundle(directory, profile) {
  try {
    directory = newDirectoryPath(directory);
    mkdirSync(directory);
  } catch {
    throw new Error('Could not create the output directory. Use a new directory in an existing parent.');
  }
  try {
    const files = [
      ['livekit.json', liveKitConfig(profile)],
      ['caddy.json', caddyConfig(profile)],
      ['network-plan.json', networkPlan(profile)],
    ];
    for (const [name, data] of files) {
      writeFileSync(join(directory, name), JSON.stringify(data, null, 2) + '\n', {
        encoding: 'utf8', flag: 'wx', mode: 0o644,
      });
    }
  } catch {
    throw new Error('Rendering stopped before completion. Use a new output directory for another attempt.');
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error('Usage: node render-config.mjs <profile.json> <new-output-directory>');
  const [profilePath, outputDirectory] = args;
  writeBundle(outputDirectory, readProfile(profilePath));
  console.log('Rendered livekit.json, caddy.json and network-plan.json.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
