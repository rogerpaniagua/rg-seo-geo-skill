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

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
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
  const l = ip.toLowerCase();
  if (l === '::' || l === '::1') return true;
  if (l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb')) return true;
  if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
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

function once(url, { method, headers, allowLocal, timeout, maxBytes, binary }) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error(`Invalid URL: ${url}`)); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error(`Unsupported protocol: ${u.protocol}`));
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(bare) && !allowLocal && isPrivateIp(bare)) {
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
    req = lib.request(u, { method, headers, lookup: guardedLookup(allowLocal), timeout }, (res) => {
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
    method = 'GET', ua = DEFAULT_UA, allowLocal = false, timeout = 15000,
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
        allowLocal, timeout, maxBytes, binary,
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
      const next = new URL(loc, current).toString();
      redirects.push({ from: current, to: next, status: r.status });
      current = next;
      continue;
    }
    return { url, finalUrl: current, ...r, redirects, ms: Date.now() - started };
  }
  return { url, finalUrl: current, status: 0, headers: {}, body: '', redirects, ms: Date.now() - started, error: `Too many redirects (>${maxRedirects})` };
}
