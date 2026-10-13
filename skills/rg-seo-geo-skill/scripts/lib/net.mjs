// HTTP client for the audit. Zero dependencies.
// Security: the audit fetches user-supplied URLs, so it refuses private/loopback/link-local
// addresses by default (SSRF guard). The check runs at connect time inside `lookup`, so DNS
// rebinding cannot swap the address between validation and connection. Redirects are followed
// manually so every hop is validated again.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';

export const DEFAULT_UA = 'Mozilla/5.0 (compatible; rg-seo-geo-skill/0.1; +https://github.com/rogerpaniagua/rg-seo-geo-skill)';

function privateV4(a, b, c) {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||   // 192.0.0.0/24 and TEST-NET-1 only; 192.0.x.x is otherwise public
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||               // TEST-NET-2
    (a === 203 && b === 0 && c === 113) ||                // TEST-NET-3
    a >= 224
  );
}

/** Parse any IPv6 text form (compressed, expanded, with embedded dotted IPv4) into 8 groups, or null. */
function parseIPv6(text) {
  let ip = text.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const dotted = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    if (o.some((x) => x > 255)) return null;
    ip = ip.slice(0, -dotted[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0 || (halves.length === 2 && fill < 1 && head.length + tail.length === 8)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * True for any address a public-web audit must never contact: loopback, private, link-local,
 * metadata, multicast, reserved, and IPv6 forms that merely *embed* such an IPv4 address
 * (IPv4-mapped/compatible, NAT64, 6to4, Teredo).
 */
export function isPrivateIp(ip) {
  const bare = String(ip).replace(/^\[|\]$/g, '');
  if (net.isIPv4(bare)) { const [a, b, c] = bare.split('.').map(Number); return privateV4(a, b, c); }
  const g = parseIPv6(bare);
  if (!g) return true;                                             // unparseable: refuse
  const v4 = (hi, lo) => privateV4(hi >> 8, hi & 255, lo >> 8);
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6], g[7]);         // ::ffff:a.b.c.d  and  ::a.b.c.d
  if (zeros(0, 4) && g[4] === 0xffff && g[5] === 0) return v4(g[6], g[7]);           // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 0 && zeros(2, 6) ? v4(g[6], g[7]) : true;  // NAT64 (local-use /48 blocked)
  if (g[0] === 0x2002) return v4(g[1], g[2]);                                          // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true;                                      // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                                 // documentation
  if (g[0] === 0x100 && zeros(1, 4)) return true;                                      // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                         // unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;           // link-local, site-local
  if ((g[0] >> 8) === 0xff) return true;                                               // multicast
  return false;
}

function guardedLookup(allowLocal) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { all: true }).then((addrs) => {
      if (!addrs.length) return cb(new Error(`No address for ${hostname}`));
      if (!allowLocal) {
        for (const a of addrs) {
          if (isPrivateIp(a.address)) return cb(new Error(`Blocked: ${hostname} resolves to private address ${a.address} (use --allow-local to audit local/dev servers)`));
        }
      }
      if (options && options.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    }).catch(cb);
  };
}

function once(url, { method, headers, allowLocal, allowedOrigin, timeout, maxBytes, binary }) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error(`Invalid URL: ${url}`)); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error(`Unsupported protocol: ${u.protocol}`));
    // Private addresses are allowed for exactly one origin (the local site being audited), never globally.
    const local = allowLocal || (allowedOrigin !== undefined && u.origin === allowedOrigin);
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(bare) && !local && isPrivateIp(bare)) {
      return reject(new Error(`Blocked private address ${u.hostname} (use --allow-local to audit local/dev servers)`));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const started = Date.now();
    let settled = false;
    let req;
    // Every outcome goes through settle(): a request can never hang or settle twice, even if a
    // decompression stream swallows the close/error after we abort an oversized response.
    const deadline = setTimeout(() => settle(null, new Error(`Timeout after ${timeout * 2}ms: ${url}`)), timeout * 2);
    const settle = (value, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (req) req.destroy();
      if (err) reject(err); else resolve(value);
    };
    // maxHeaderSize: some sites (e.g. webflow.com) send >16 KB of headers, above Node's default limit.
    req = lib.request(u, { method, headers, lookup: guardedLookup(local), timeout, maxHeaderSize: 128 * 1024 }, (res) => {
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let size = 0;
      const build = (truncated) => {
        const buf = Buffer.concat(chunks);
        settle({
          status: res.statusCode, headers: res.headers, body: binary ? buf : buf.toString('utf8'),
          bytes: buf.length, truncated, ms: Date.now() - started,
        });
      };
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { build(true); return; }
        chunks.push(chunk);
      });
      stream.on('end', () => build(false));
      // Only a response cut short counts as a fallback here. A complete response must wait for the
      // decompressor's own 'end', otherwise buffered data is lost.
      res.on('close', () => { if (!res.complete) build(true); });
      stream.on('error', (e) => (chunks.length ? build(true) : settle(null, e)));
    });
    req.on('timeout', () => settle(null, new Error(`Timeout after ${timeout}ms: ${url}`)));
    req.on('error', (e) => settle(null, e));
    req.end();
  });
}

/**
 * Fetch a URL following redirects manually.
 * Returns { url, finalUrl, status, headers, body, redirects: [{from,to,status}], ms, error? }.
 * Never throws: network errors come back as { error }.
 */
export async function fetchUrl(url, opts = {}) {
  const {
    method = 'GET', ua = DEFAULT_UA, allowLocal = false, allowedOrigin, timeout = 15000,
    maxBytes = 3_000_000, maxRedirects = 6, follow = true, binary = false, headers = {}, retries = 2,
  } = opts;
  const redirects = [];
  let attempts = 0;
  let current = url;
  const started = Date.now();
  for (let i = 0; i <= maxRedirects; i++) {
    let r;
    try {
      r = await once(current, {
        method,
        headers: { 'user-agent': ua, accept: binary ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-encoding': 'gzip, deflate, br', ...headers },
        allowLocal, allowedOrigin, timeout, maxBytes, binary,
      });
    } catch (e) {
      return { url, finalUrl: current, status: 0, headers: {}, body: binary ? Buffer.alloc(0) : '', redirects, ms: Date.now() - started, error: e.message };
    }
    // Rate limiting / temporary overload: wait (Retry-After, capped) and try again instead of
    // reporting a transport problem as a site problem.
    if ((r.status === 429 || r.status === 503) && attempts < retries) {
      attempts++;
      const ra = Number(r.headers['retry-after']);
      const wait = Math.min(Number.isFinite(ra) ? ra * 1000 : 1000 * attempts, 5000);
      await new Promise((res) => setTimeout(res, wait));
      i--; // a retry does not consume the redirect budget
      continue;
    }
    const loc = r.headers.location;
    if (follow && r.status >= 300 && r.status < 400 && loc) {
      let next;
      try { next = new URL(loc, current).toString(); } catch { return { url, finalUrl: current, status: 0, headers: r.headers || {}, body: binary ? Buffer.alloc(0) : '', redirects, ms: Date.now() - started, error: 'Invalid redirect Location header' }; }
      redirects.push({ from: current, to: next, status: r.status });
      current = next;
      continue;
    }
    return { url, finalUrl: current, ...r, redirects, ms: Date.now() - started };
  }
  return { url, finalUrl: current, status: 0, headers: {}, body: '', redirects, ms: Date.now() - started, error: `Too many redirects (>${maxRedirects})` };
}
