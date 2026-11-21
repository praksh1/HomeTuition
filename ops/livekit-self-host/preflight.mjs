import { spawnSync } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { readFileSync, statfsSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { availableParallelism, loadavg, platform, totalmem } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ordinaryPath, readOrdinaryFile } from './ordinary-path.mjs';

const requiredModules = [
  'layer4.handlers.proxy',
  'layer4.handlers.tls',
  'layer4.matchers.tls',
];
const publicTcp = [80, 443, 7881];
const privateTcp = [7880, 17880, 5349];
const publicUdp = [3478, 7882, 7883, 7884, 7885];

function hasKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

export function validatePlan(plan, assignedIpv4) {
  if (!isIPv4(assignedIpv4)) throw new Error('Supply the server’s assigned IPv4 address.');
  if (!hasKeys(plan, ['livekitVersion', 'region', 'signalingUrl', 'turnTlsUrl', 'dns',
    'publicTcp', 'privateTcp', 'publicUdp', 'applicationEnvironment']) || plan.livekitVersion !== '1.13.11'
      || typeof plan.region !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(plan.region)) {
    throw new Error('Use a network plan from the portable renderer.');
  }
  let signal;
  try { signal = new URL(plan.signalingUrl); } catch { throw new Error('Invalid signaling origin.'); }
  const hosts = [signal.hostname, plan.dns?.[1]?.name];
  if (signal.protocol !== 'wss:' || signal.port || signal.username || signal.password
      || signal.pathname !== '/' || signal.search || signal.hash
      || hosts[0] === hosts[1] || hosts.some((host) => typeof host !== 'string'
        || host.length > 253 || host.split('.').length < 2
        || !/^[a-z]/.test(host.split('.').at(-1))
        || host.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))) {
    throw new Error('Use distinct DNS hostnames and a WSS origin.');
  }
  const expected = {
    publicTcp,
    privateTcp,
    publicUdp: ['3478', '7882-7885'],
  };
  for (const field of Object.keys(expected)) {
    if (JSON.stringify(plan[field]) !== JSON.stringify(expected[field])) {
      throw new Error('Network ports differ from this reviewed pilot.');
    }
  }
  if (!Array.isArray(plan.dns) || plan.dns.length !== 2
      || plan.dns.some((record, index) => !hasKeys(record, ['name', 'type', 'target', 'proxied'])
        || record.name !== hosts[index] || record.type !== 'A'
        || record.proxied !== false || (record.target !== null && record.target !== assignedIpv4))
      || plan.turnTlsUrl !== 'turns:' + hosts[1] + ':443?transport=tcp'
      || !hasKeys(plan.applicationEnvironment, ['LIVEKIT_URL', 'VIDEO_ROOM_NAMESPACE'])
      || plan.applicationEnvironment?.LIVEKIT_URL !== plan.signalingUrl
      || plan.applicationEnvironment?.VIDEO_ROOM_NAMESPACE !== 'fadko-' + plan.region) {
    throw new Error('Network plan fields do not describe one matching candidate.');
  }
  return hosts;
}

export function plannedListeners(text) {
  if (typeof text !== 'string') throw new Error('Listener inventory is unavailable.');
  const collisions = [];
  for (const line of text.trim().split(/\r?\n/).filter(Boolean)) {
    const columns = line.trim().split(/\s+/);
    const transport = columns[0];
    const local = columns[4];
    if (!['tcp', 'udp', 'tcp6', 'udp6'].includes(transport) || columns.length < 6 || !local) {
      throw new Error('Listener inventory could not be interpreted.');
    }
    const split = local.lastIndexOf(':');
    const port = Number(local.slice(split + 1));
    if (split < 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Listener address could not be interpreted.');
    }
    const protocol = transport.startsWith('tcp') ? 'tcp' : 'udp';
    const planned = protocol === 'tcp' ? [...publicTcp, ...privateTcp] : publicUdp;
    if (planned.includes(port)) {
      collisions.push({
        protocol,
        address: local.slice(0, split).replace(/^\[|\]$/g, ''),
        port,
      });
    }
  }
  return collisions;
}

function command(program, args) {
  return spawnSync(program, args, {
    encoding: 'utf8',
    shell: false,
    timeout: 8000,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' },
  });
}

function successful(result) {
  return result && !result.error && !result.signal && result.status === 0;
}

async function lookup(hostname) {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  let deadline;
  try {
    const query = Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    const expiration = new Promise((done) => {
      deadline = setTimeout(() => {
        resolver.cancel();
        done([
          { status: 'rejected', reason: { code: 'ETIMEOUT' } },
          { status: 'rejected', reason: { code: 'ETIMEOUT' } },
        ]);
      }, 4500);
    });
    const answers = await Promise.race([query, expiration]);
    return answers.map((answer) => answer.status === 'fulfilled'
      ? { values: answer.value }
      : { error: answer.reason?.code ?? 'DNS_ERROR' });
  } finally {
    clearTimeout(deadline);
    resolver.cancel();
  }
}

function capacity(directory) {
  const memory = readFileSync('/proc/meminfo', 'utf8');
  const available = memory.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  const disk = statfsSync(directory);
  return {
    logicalCpus: availableParallelism(),
    memoryTotalMiB: Math.floor(totalmem() / 1048576),
    memoryAvailableMiB: available ? Math.floor(Number(available[1]) / 1024) : null,
    loadAverage: loadavg(),
    candidateDiskFreeMiB: Math.floor(disk.bavail * disk.bsize / 1048576),
  };
}

export async function inspectHost({ plan, assignedIpv4, livekitBinary, caddyBinary, directory }, probes = {}) {
  const hosts = validatePlan(plan, assignedIpv4);
  const run = probes.command ?? command;
  const dns = probes.lookup ?? lookup;
  const measure = probes.capacity ?? capacity;
  const checks = [];
  const record = (name, status, detail) => checks.push({ name, status, detail });

  const livekit = run(livekitBinary, ['--version']);
  const version = successful(livekit) && livekit.stdout?.match(/\b(?:v)?(1\.\d+\.\d+)\b/)?.[1];
  record('livekitVersion', version === plan.livekitVersion ? 'PASS' : 'BLOCKED',
    version ? { installed: version, expected: plan.livekitVersion } : { reason: 'Version command failed or was unrecognized.' });

  const caddy = run(caddyBinary, ['version']);
  const caddyVersion = successful(caddy) && caddy.stdout?.match(/\bv(\d+\.\d+\.\d+)\b/)?.[1];
  record('caddyVersion', caddyVersion ? 'PASS' : 'BLOCKED',
    caddyVersion ? { installed: caddyVersion } : { reason: 'Version command failed or was unrecognized.' });
  const modules = run(caddyBinary, ['list-modules']);
  const moduleIds = successful(modules) && new Set(modules.stdout.trim().split(/\r?\n/).map((line) => line.trim()));
  const missing = requiredModules.filter((name) => !moduleIds || !moduleIds.has(name));
  record('caddyLayer4', missing.length ? 'BLOCKED' : 'PASS', { missing });

  const listeners = run('ss', ['-H', '-lntu']);
  try {
    if (!successful(listeners)) throw new Error('Listener command failed.');
    const collisions = plannedListeners(listeners.stdout);
    record('plannedPortsAvailable', collisions.length ? 'BLOCKED' : 'PASS', { collisions });
  } catch {
    record('plannedPortsAvailable', 'UNKNOWN', { reason: 'Could not inspect the planned listener ports.' });
  }

  await Promise.all(hosts.map(async (hostname) => {
    try {
      const [ipv4, ipv6] = await dns(hostname);
      const matches = Array.isArray(ipv4?.values) && ipv4.values.length > 0
        && ipv4.values.every((address) => address === assignedIpv4);
      const noIpv6 = Array.isArray(ipv6?.values) ? ipv6.values.length === 0 : ipv6?.error === 'ENODATA';
      const aBlocked = Array.isArray(ipv4?.values) ? !matches : ['ENODATA', 'ENOTFOUND'].includes(ipv4?.error);
      const aaaaBlocked = Array.isArray(ipv6?.values) ? ipv6.values.length > 0 : ipv6?.error === 'ENOTFOUND';
      const status = aBlocked || aaaaBlocked ? 'BLOCKED' : matches && noIpv6 ? 'PASS' : 'UNKNOWN';
      record('recursiveDns:' + hostname, status, {
        a: matches ? 'matches assigned IPv4' : aBlocked ? 'missing or mismatched IPv4' : 'unavailable',
        aaaa: noIpv6 ? 'absent' : aaaaBlocked ? 'unexpected IPv6 or missing hostname' : 'unavailable',
      });
    } catch {
      record('recursiveDns:' + hostname, 'UNKNOWN', { reason: 'DNS observation failed.' });
    }
  }));

  try {
    record('capacitySnapshot', 'OBSERVED', measure(directory));
  } catch {
    record('capacitySnapshot', 'UNKNOWN', { reason: 'Could not collect the narrow capacity snapshot.' });
  }

  return {
    classification: 'READ_ONLY_HOST_PREFLIGHT',
    status: checks.every((check) => ['PASS', 'OBSERVED'].includes(check.status)) ? 'CHECKS_PASSED' : 'ACTION_REQUIRED',
    observedUtc: new Date().toISOString(),
    nodeVersion: process.version,
    region: plan.region,
    checks,
    remainingVerification: [
      'Verify the installed Caddy build and render with the deployment owner.',
      'Verify privilege to bind TCP 80/443, external firewalls and trusted TLS for both hostnames.',
      'Verify public media IP, direct UDP and forced TURN/TLS from an external client.',
      'Measure two-way audio/video, screen share and network interruption recovery.',
      'Qualify classroom End, old-token reuse and supported Android/web builds separately.',
    ],
  };
}

async function main() {
  try {
    const [directoryInput, livekitBinary, caddyBinary, assignedIpv4, ...extra] = process.argv.slice(2);
    if (!directoryInput || !livekitBinary || !caddyBinary || !assignedIpv4 || extra.length) {
      throw new Error('Usage: node preflight.mjs <candidate-directory> <livekit-binary> <caddy-binary> <assigned-IPv4>');
    }
    const directory = ordinaryPath(directoryInput, 'directory');
    const plan = JSON.parse(readOrdinaryFile(join(directory, 'network-plan.json')));
    validatePlan(plan, assignedIpv4);
    if (platform() !== 'linux') throw new Error('Run this observational preflight on the Linux candidate host.');
    const installed = new Set();
    for (const executable of [livekitBinary, caddyBinary]) {
      if (!isAbsolute(executable)) throw new Error('Provide absolute paths to the installed binaries.');
      try {
        ordinaryPath(executable, 'file');
        installed.add(executable);
      } catch {
        // Report missing or non-ordinary binaries without attempting to execute them.
      }
    }
    const checkedCommand = (program, args) => program === 'ss' || installed.has(program)
      ? command(program, args)
      : { status: null, error: true };
    const report = await inspectHost(
      { plan, assignedIpv4, livekitBinary, caddyBinary, directory },
      { command: checkedCommand },
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'CHECKS_PASSED' ? 0 : 1;
  } catch {
    console.error('Preflight could not inspect this candidate. Check the four arguments, ordinary file paths, generated plan, installed binaries and Linux host.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
