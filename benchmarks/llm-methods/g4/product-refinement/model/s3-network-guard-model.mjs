/**
 * H1 Source→Model refinement of the original xDownload S3-lane public-HTTPS
 * guard stack, ported from the merged #163 source snapshot
 *   original/packages/direct-acquisition/src/pinned-public-https.ts
 * (original repo kaicreator-mm/xDownload @ e904f08c478b15147b1c07fbe53c610d2d81851f,
 *  Git Blob 8beebadf701883e3ae5ccf669485bc5c1ba1dde0).
 *
 * GUARDS MODELLED (pure, executable): strict media HTTPS URL grammar,
 * DNS A-answer all-public classification over the frozen reserved-CIDR table,
 * per-hop TLS peer identity (encrypted + authorized + exact pinned IP), the
 * bounded redirect loop (initial-vs-redirect admission, echo check, visited
 * loop detection, redirect bound) and reader bounds validation.
 *
 * HOST I/O SEAMS (explicitly NOT modelled): the real DNS lookup
 * (`resolvePublicViaDns`, shipped for completeness, never invoked by tests)
 * and the byte transport hop. `createPinnedPublicS3HttpsReader` REQUIRES
 * injected `resolvePublic`/`hop` seams, so every reachable test path is
 * network-free. This mirrors the original header: a bounded network BYTE
 * port is NOT a Core command, installed selection authority, or
 * Media/COMPLETE proof; an installed Core composer must later provide
 * trusted policy and persisted authority before ever calling read().
 */

import { resolve4 } from 'node:dns/promises';
import { performance } from 'node:perf_hooks';

/** Frozen reserved/special-purpose IPv4 CIDR table (publicIpv4 rejects all). */
const CIDRS = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc01fc400, 24],
  [0xc034c100, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc0af3000, 24],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];
const MEDIA_PATH = /^\/media\/[A-Za-z0-9_-]{1,64}\.(mp4|m4a|mp3|webm)$/u;
const HOST =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_MS = 30_000;
export const MAX_REDIRECTS = 3;

export function failure(reason) {
  return { ok: false, reason };
}

/** Public-IPv4 classification: dotted-quad syntax + no reserved/special CIDR. */
export function publicIpv4(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return false;
  const parts = value.split('.');
  if (parts.some((part) => (part.length > 1 && part.startsWith('0')) || Number(part) > 255)) {
    return false;
  }
  const [a, b, c, d] = parts.map(Number);
  const ip = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  return !CIDRS.some(([network, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((ip & mask) >>> 0) === ((network & mask) >>> 0);
  });
}

/** Strict media HTTPS URL grammar; returns {href, hostname} or undefined. */
export function mediaUrl(raw) {
  if (
    typeof raw !== 'string' ||
    raw.length < 25 ||
    raw.length > 2048 ||
    !/^[\x21-\x7e]+$/u.test(raw) ||
    /[%?#@\\]/u.test(raw)
  )
    return undefined;
  const candidate = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(\/.*)$/u.exec(raw);
  if (
    !candidate ||
    !HOST.test(candidate[1]) ||
    !candidate[1].includes('.') ||
    candidate[1].endsWith('.') ||
    !MEDIA_PATH.test(candidate[3])
  )
    return undefined;
  const port = candidate[2];
  if (port !== undefined && (String(Number(port)) !== port || Number(port) < 1 || Number(port) > 65535)) {
    return undefined;
  }
  try {
    const parsed = new URL(raw);
    if (
      parsed.href !== raw ||
      parsed.protocol !== 'https:' ||
      parsed.hostname !== candidate[1] ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.pathname !== candidate[3]
    )
      return undefined;
    return { href: raw, hostname: parsed.hostname };
  } catch {
    return undefined;
  }
}

/**
 * Post-DNS classification factored out of the original `resolvePublic`:
 * deadline must not have passed; the A-answer list must be 1..16 entries and
 * EVERY answer public; exactly the first answer is pinned.
 */
export function classifyDnsAnswers(answers, withinDeadline) {
  if (!withinDeadline) return undefined;
  if (
    !Array.isArray(answers) ||
    answers.length < 1 ||
    answers.length > 16 ||
    answers.some((ip) => !publicIpv4(ip))
  )
    return undefined;
  return answers[0];
}

/**
 * Real DNS-fused resolver, shipped for completeness exactly like the original
 * `resolvePublic` (resolve4 under the remaining deadline, then the same
 * classification). NEVER invoked by the witness/test suite — tests inject a
 * deterministic `resolvePublic` seam so no model path touches the network.
 */
export async function resolvePublicViaDns(hostname, deadline) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) return undefined;
  const answers = await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(undefined), remaining);
    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    Promise.resolve()
      .then(() => resolve4(hostname))
      .then(
        (values) => finish(values),
        () => finish(undefined),
      );
  });
  return classifyDnsAnswers(answers, performance.now() < deadline);
}

/**
 * Per-hop TLS peer identity predicate: the connected socket must be encrypted,
 * pass CA/hostname authorization, and its remote address must EQUAL the
 * independently pinned public IP (no hostname-trust shortcut).
 */
export function tlsPeerOkay(socket, pinnedIp) {
  return socket.encrypted === true && socket.authorized === true && socket.remoteAddress === pinnedIp;
}

/** Validate trusted reader bounds exactly like the original factory. */
export function validateReaderBounds(bounds) {
  const maxBytes = bounds.maxBytes;
  const timeoutMs = bounds.timeoutMs;
  const maxRedirects = bounds.maxRedirects;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BYTES ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_MS ||
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > MAX_REDIRECTS
  )
    throw new Error('S3 HTTPS reader requires bounded trusted configuration');
}

/**
 * The bounded read loop with the redirect admission policy. Identical control
 * flow to the original factory, except `resolvePublic` and `hop` are REQUIRED
 * injected seams (no default), so the loop itself is pure and network-free:
 *   parse mediaUrl -> initial/redirect admission + echo + visited check ->
 *   pin one public IP -> one hop -> body | redirect | failure.
 * A redirect received on the last allowed index is `HTTP_REJECTED`; a policy
 * refusal, echo mismatch or cycle is `SOURCE_REJECTED`; an unresolvable or
 * non-public DNS answer is `DNS_REJECTED`.
 */
export function createPinnedPublicS3HttpsReader(policy, bounds, seams) {
  validateReaderBounds(bounds);
  const maxBytes = bounds.maxBytes;
  const timeoutMs = bounds.timeoutMs;
  const maxRedirects = bounds.maxRedirects;
  const resolvePublic = seams?.resolvePublic;
  const hop = seams?.hop;
  if (typeof resolvePublic !== 'function' || typeof hop !== 'function') {
    throw new Error(
      'S3 HTTPS reader model requires injected resolvePublic/hop seams; DNS lookup and byte transport are Host I/O obligations outside the pure guard model',
    );
  }
  return Object.freeze({
    async read(uri) {
      const deadline = performance.now() + timeoutMs;
      let next = uri;
      const visited = [];
      for (let redirectIndex = 0; redirectIndex <= maxRedirects; redirectIndex += 1) {
        const parsed = mediaUrl(next);
        if (parsed === undefined) return failure('SOURCE_REJECTED');
        // Policy may be an injected test double. Independently verify the
        // HTTPS/URI/public IP constraints; do not treat admission as Core grant.
        const admission = redirectIndex === 0 ? policy.admitInitial(next) : policy.admitRedirect(next);
        if (!admission.ok || admission.uri !== next || visited.includes(next)) {
          return failure('SOURCE_REJECTED');
        }
        const pinnedIp = await resolvePublic(parsed.hostname, deadline);
        if (pinnedIp === undefined) return failure('DNS_REJECTED');
        visited.push(next);
        const reply = await hop(parsed, pinnedIp, maxBytes, deadline);
        if (reply.kind === 'failure') return failure(reply.reason);
        if (reply.kind === 'body') {
          return {
            ok: true,
            bytes: reply.bytes,
            contentType: reply.contentType,
            visited: Object.freeze([...visited]),
          };
        }
        if (redirectIndex === maxRedirects) return failure('HTTP_REJECTED');
        next = reply.location;
      }
      return failure('HTTP_REJECTED');
    },
  });
}

export const S3_GUARD_FACTS = {
  redirectCodes: [...REDIRECTS].sort((a, b) => a - b),
  mediaPathPattern: MEDIA_PATH.source,
  hostPattern: HOST.source,
  reservedCidrs: CIDRS.map(([network, bits]) => ({ network: `0x${network.toString(16).padStart(8, '0')}`, bits })),
};
