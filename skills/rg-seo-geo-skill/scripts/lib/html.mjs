// Dependency-free HTML / robots / sitemap extraction for audit purposes.
//
// SECURITY NOTE: this code parses documents written by third parties, up to several MB. Every
// routine is a single linear pass. There are deliberately no regular expressions with nested or
// lazy `[\s\S]*?` quantifiers over the document: those backtrack quadratically on hostile input
// (e.g. 700k unclosed "<a " tags hang a lazy-regex parser for minutes). The key technique is a
// memoised forward search: because the scan position only moves forward, "needle not found after
// position p" stays true for every later position, so each needle is searched for at most once
// per document region.
//
// It is not a spec-compliant HTML parser. It reads start tags, skips comments / <script> /
// <style>, and is accurate enough for head metadata, headings, links, images and JSON-LD. The
// whole document is scanned (not just <head>) because Next.js may stream metadata into <body>.

const MAX_TAG = 1_000_000;     // inline data: URIs make legitimate tags tens of KB long; only absurd tags are skipped
const MAX_TEXT = 1000;         // chars kept for a title or heading
const CAPS = { metas: 3000, links: 3000, anchors: 30000, images: 30000, headings: 300, ld: 50, resources: 30000 };
const RESOURCE_RELS = new Set(['stylesheet', 'preload', 'modulepreload', 'prefetch', 'icon', 'shortcut', 'apple-touch-icon', 'manifest']);
const MAX_LD = 1_000_000;

const isNameChar = (c) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 58 || c === 46 || c === 95;
const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;

/** Lower-cases ASCII only, so offsets stay identical to the original string. */
function asciiLower(s) {
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) { out += s.slice(last, i) + String.fromCharCode(c + 32); last = i + 1; }
  }
  return out + s.slice(last);
}

/** Forward-only memoised indexOf. `from` must be non-decreasing per needle. */
function makeFinder(hay) {
  const memo = new Map();
  return (needle, from) => {
    const m = memo.get(needle);
    if (m) {
      if (m.pos === -1) return -1;           // not found after an earlier start => not found after this one
      if (m.pos >= from) return m.pos;       // earliest occurrence >= earlier start and >= from
    }
    const pos = hay.indexOf(needle, from);
    memo.set(needle, { pos });
    return pos;
  };
}

/** Linear attribute parser (no regex backtracking). Names are lower-cased; first occurrence wins. */
export function parseAttrs(str) {
  const attrs = {};
  const n = str.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isSpace(str.charCodeAt(i)) || str[i] === '/')) i++;
    const start = i;
    while (i < n && !isSpace(str.charCodeAt(i)) && str[i] !== '=' && str[i] !== '>' && str[i] !== '/') i++;
    if (i === start) { i++; continue; }
    const name = str.slice(start, i).toLowerCase();
    while (i < n && isSpace(str.charCodeAt(i))) i++;
    let value = '';
    if (str[i] === '=') {
      i++;
      while (i < n && isSpace(str.charCodeAt(i))) i++;
      const q = str[i];
      if (q === '"' || q === "'") {
        const end = str.indexOf(q, i + 1);
        if (end === -1) { value = str.slice(i + 1); i = n; } else { value = str.slice(i + 1, end); i = end + 1; }
      } else {
        const vs = i;
        while (i < n && !isSpace(str.charCodeAt(i)) && str[i] !== '>') i++;
        value = str.slice(vs, i);
      }
    }
    if (!(name in attrs)) attrs[name] = decode(value);
  }
  return attrs;
}

export function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d{1,7});/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => safeCodePoint(parseInt(n, 16)));
}
function safeCodePoint(n) { return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�'; }

/** Visible text of a short fragment: strips tags with a linear scan. */
function textOf(fragment) {
  let out = '';
  let i = 0;
  while (i < fragment.length) {
    const lt = fragment.indexOf('<', i);
    if (lt === -1) { out += fragment.slice(i); break; }
    out += fragment.slice(i, lt) + ' ';
    const gt = fragment.indexOf('>', lt);
    if (gt === -1) break;
    i = gt + 1;
  }
  return decode(out).replace(/\s+/g, ' ').trim();
}

function flattenJsonLd(node, out, depth = 0) {
  if (depth > 20) return;
  if (Array.isArray(node)) { for (const n of node) flattenJsonLd(n, out, depth + 1); return; }
  if (!node || typeof node !== 'object') return;
  if (node['@graph']) flattenJsonLd(node['@graph'], out, depth + 1);
  if (node['@type']) out.push(node);
}

function parseLdBodies(bodies) {
  return bodies.map((text) => {
    try {
      const data = JSON.parse(text.trim());
      const nodes = [];
      flattenJsonLd(data, nodes);
      return { ok: true, data, nodes, hasContext: JSON.stringify(data).includes('schema.org') };
    } catch (e) {
      return { ok: false, error: e.message, nodes: [] };
    }
  });
}

const APP_ROOT_IDS = new Set(['root', 'app', '__nuxt', '___gatsby']);

/** The single linear pass. */
function scan(raw) {
  const lower = asciiLower(raw);
  const n = raw.length;
  const find = makeFinder(lower);
  const out = {
    metas: [], links: [], anchors: [], images: [], headings: [], ld: [], text: [], resources: [],
    htmlAttrs: null, title: undefined, timeTags: 0, listCount: 0, tableCount: 0,
    emptyAppRoot: false, noscriptJsHint: false,
  };
  let inHead = false;
  let noscriptEnd = -1;   // text inside <noscript> is a fallback, not page content; its tags still count (non-JS crawlers see them)
  let i = 0;
  const addRes = (tag, url) => { if (url && out.resources.length < CAPS.resources) out.resources.push({ tag, url: url.trim() }); };

  const addText = (a, b) => { if (!inHead && a >= noscriptEnd && b > a) out.text.push(raw.slice(a, b)); };
  /** Index just after the '>' that ends the end-tag starting at `closeStart`, or n. */
  const afterTag = (closeStart) => { const g = find('>', closeStart); return g === -1 ? n : g + 1; };

  while (i < n) {
    const lt = raw.indexOf('<', i);
    if (lt === -1) { addText(i, n); break; }
    addText(i, lt);

    if (lower.startsWith('<!--', lt)) {
      const e = find('-->', lt + 4);
      if (e === -1) break;                       // unterminated comment swallows the rest, like a browser
      i = e + 3;
      continue;
    }
    const c = lower.charCodeAt(lt + 1);
    if (c === 47 || c === 33 || c === 63) {      // end tag, <!doctype>, <?xml ?>
      if (c === 47 && lower.startsWith('</head', lt)) inHead = false;
      const g = find('>', lt + 1);
      if (g === -1) break;
      i = g + 1;
      continue;
    }
    let j = lt + 1;
    while (j < n && isNameChar(lower.charCodeAt(j))) j++;
    if (j === lt + 1) { addText(lt, lt + 1); i = lt + 1; continue; }   // a bare "<" is text
    const name = lower.slice(lt + 1, j);
    const g = find('>', j);
    if (g === -1) break;                         // no more '>' anywhere: the rest is not a tag
    const skipAttrs = g - j > MAX_TAG;           // absurd tag: ignore it rather than count it as attribute-less
    const attrStr = skipAttrs ? '' : raw.slice(j, g);
    i = g + 1;

    switch (name) {
      case 'script': {
        const attrs = parseAttrs(attrStr);
        addRes('script', attrs.src);
        const close = find('</script', i);
        const bodyEnd = close === -1 ? n : close;
        if (/ld\+json/i.test(attrs.type || '') && out.ld.length < CAPS.ld && bodyEnd - i <= MAX_LD) out.ld.push(raw.slice(i, bodyEnd));
        i = close === -1 ? n : afterTag(close);
        break;
      }
      case 'style': {
        const close = find('</style', i);
        i = close === -1 ? n : afterTag(close);
        break;
      }
      case 'title': {
        const close = find('</title', i);
        if (close !== -1) {
          if (out.title === undefined) out.title = textOf(raw.slice(i, Math.min(close, i + MAX_TEXT)));
          i = afterTag(close);
        }
        break;
      }
      case 'noscript': {
        const close = find('</noscript', i);
        if (close !== -1) {
          if (/(enable|habilit)\w*[^<]{0,80}javascript/i.test(raw.slice(i, Math.min(close, i + 400)))) out.noscriptJsHint = true;
          noscriptEnd = close;                    // keep scanning: links inside still count, text does not
        }
        break;
      }
      case 'svg': case 'template': {
        const close = find(`</${name}`, i);
        if (close !== -1) i = afterTag(close);    // skip the element: inline SVG titles/labels and templates are not page content
        break;
      }
      case 'head': inHead = true; break;
      case 'html': if (!out.htmlAttrs) out.htmlAttrs = parseAttrs(attrStr); break;
      case 'meta': if (!skipAttrs && out.metas.length < CAPS.metas) out.metas.push(parseAttrs(attrStr)); break;
      case 'link': {
        if (!skipAttrs && out.links.length < CAPS.links) {
          const a = parseAttrs(attrStr);
          out.links.push(a);
          if ((a.rel || '').toLowerCase().split(/\s+/).some((r) => RESOURCE_RELS.has(r))) addRes('link', a.href);
        }
        break;
      }
      case 'a': if (!skipAttrs && out.anchors.length < CAPS.anchors) out.anchors.push(parseAttrs(attrStr)); break;
      case 'img': {
        if (!skipAttrs && out.images.length < CAPS.images) { const a = parseAttrs(attrStr); out.images.push(a); addRes('img', a.src); }
        break;
      }
      case 'iframe': case 'embed': case 'source': case 'audio': case 'video': case 'track': case 'object': {
        if (skipAttrs) break;
        const a = parseAttrs(attrStr);
        addRes(name, a.src || a.data);
        addRes(name, a.poster);
        break;
      }
      case 'time': if (lt >= noscriptEnd) out.timeTags++; break;
      case 'ul': case 'ol': if (lt >= noscriptEnd) out.listCount++; break;   // structure inside a <noscript> fallback is not content structure
      case 'table': if (lt >= noscriptEnd) out.tableCount++; break;
      case 'div':
        if (!out.emptyAppRoot && attrStr.includes('id')) {
          const a = parseAttrs(attrStr);
          if (APP_ROOT_IDS.has(a.id)) {
            let k = i;
            while (k < n && k - i < 64 && isSpace(lower.charCodeAt(k))) k++;
            if (lower.startsWith('</div', k)) out.emptyAppRoot = true;
          }
        }
        break;
      default:
        if (name.length === 2 && name[0] === 'h' && name[1] >= '1' && name[1] <= '6' && out.headings.length < CAPS.headings) {
          const close = find(`</h${name[1]}`, i);
          if (close !== -1) out.headings.push({ level: Number(name[1]), text: textOf(raw.slice(i, Math.min(close, i + MAX_TEXT))) });
        }
    }
  }
  return out;
}

/** JSON-LD blocks of a document, parsed. */
export function extractJsonLd(rawHtml) {
  return parseLdBodies(scan(rawHtml).ld);
}

export function parseHtml(rawHtml) {
  const s = scan(rawHtml);
  const metas = s.metas;
  const metaByName = (nm) => metas.find((m) => (m.name || '').toLowerCase() === nm);
  const metaByProp = (p) => metas.find((m) => (m.property || '').toLowerCase() === p);
  const content = (m) => (m && m.content !== undefined ? m.content.trim() : undefined);

  const og = {};
  const metaMap = {};
  for (const m of metas) {
    const p = (m.property || m.name || m['http-equiv'] || '').toLowerCase();
    if (!p) continue;
    if (!(p in metaMap)) metaMap[p] = m.content;
    if (p.startsWith('og:') || p.startsWith('twitter:')) og[p] = m.content;
  }
  const text = decode(s.text.join(' ')).replace(/\s+/g, ' ').trim();

  return {
    title: s.title,
    lang: s.htmlAttrs ? s.htmlAttrs.lang : undefined,
    description: content(metaByName('description')),
    robotsMeta: (content(metaByName('robots')) || '').toLowerCase(),
    googlebotMeta: (content(metaByName('googlebot')) || '').toLowerCase(),
    viewport: content(metaByName('viewport')),
    charset: metas.some((m) => m.charset),
    canonical: (s.links.find((l) => (l.rel || '').toLowerCase().split(/\s+/).includes('canonical')) || {}).href,
    icons: s.links.filter((l) => /\bicon\b/i.test(l.rel || '')).map((l) => ({ rel: l.rel, href: l.href })),
    hreflang: s.links.filter((l) => (l.rel || '').toLowerCase() === 'alternate' && l.hreflang).map((l) => ({ lang: l.hreflang, href: l.href })),
    og,
    metaMap,
    ogImageWidth: content(metaByProp('og:image:width')),
    ogImageHeight: content(metaByProp('og:image:height')),
    headings: s.headings,
    anchors: s.anchors,
    images: s.images,
    resources: s.resources,
    text,
    wordCount: text ? text.split(' ').length : 0,
    listCount: s.listCount,
    tableCount: s.tableCount,
    timeTags: s.timeTags,
    emptyAppRoot: s.emptyAppRoot,
    noscriptJsHint: s.noscriptJsHint,
    jsonLd: parseLdBodies(s.ld),
  };
}

/** Parse image dimensions from PNG / JPEG / GIF / WebP headers. Returns {width,height} or null. */
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return buf.length >= 10 ? { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) } : null;
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + Math.max(len, 2);                 // a zero length must never stall the loop
    }
    return null;
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8 ') return buf.length >= 30 ? { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff } : null;
    if (fmt === 'VP8L') {
      if (buf.length < 25) return null;
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fmt === 'VP8X') return buf.length >= 30 ? { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) } : null;
  }
  return null;
}

/** robots.txt parser: returns groups [{agents:[], rules:[{type,path}]}] and sitemaps[]. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasAgent = false;
  let rules = 0;
  for (const raw of text.split(/\r?\n/)) {
    const hash = raw.indexOf('#');
    const line = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (!line || line.length > 2048) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (cur && rules++ < 20000) cur.rules.push({ type: key, path: val });
      lastWasAgent = false;
    } else if (key === 'sitemap') {
      if (sitemaps.length < 50) sitemaps.push(val);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

/** Does a robots path pattern (with * and $) match `path`? Linear-time matcher, no RegExp built from site input. */
function robotsPatternMatches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  let pos = 0;
  if (!path.startsWith(parts[0])) return false;
  pos = parts[0].length;
  for (let k = 1; k < parts.length; k++) {
    const part = parts[k];
    if (k === parts.length - 1 && anchored) return path.length - pos >= part.length && path.endsWith(part);
    const at = path.indexOf(part, pos);
    if (at === -1) return false;
    pos = at + part.length;
  }
  return anchored ? parts.length === 1 && pos === path.length : true;
}

/** Is `path` crawlable by `agent` under robots groups? Longest-match wins, allow wins ties. */
export function robotsAllows(parsed, agent, path = '/') {
  const a = agent.toLowerCase();
  let group = parsed.groups.find((g) => g.agents.includes(a));
  if (!group) group = parsed.groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = { len: -1, allow: true };
  for (const r of group.rules) {
    if (r.path === '') continue;
    if (robotsPatternMatches(r.path, path)) {
      const len = r.path.length;
      const allow = r.type === 'allow';
      if (len > best.len || (len === best.len && allow)) best = { len, allow };
    }
  }
  return best.allow;
}

/** Extract <loc> / <lastmod> from sitemap XML in one linear pass. */
export function parseSitemap(xml) {
  const lower = asciiLower(xml);
  const find = makeFinder(lower);
  const isIndex = lower.includes('<sitemapindex');
  const tag = isIndex ? 'sitemap' : 'url';
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const entries = [];
  let pos = 0;
  while (entries.length < 500_000) {
    const o = find(open, pos);
    if (o === -1) break;
    const after = lower.charCodeAt(o + open.length);
    if (!(after === 62 || isSpace(after) || after === 47)) { pos = o + open.length; continue; }   // e.g. <urlset, <urlfoo
    const gt = find('>', o);
    if (gt === -1) break;
    const e = find(close, gt);
    if (e === -1) break;                          // unterminated entry: nothing more can be read
    const body = xml.slice(gt + 1, e);
    const loc = between(body, lower.slice(gt + 1, e), 'loc');
    if (loc) entries.push({ loc: decode(loc.trim()), lastmod: between(body, lower.slice(gt + 1, e), 'lastmod')?.trim() });
    pos = e + close.length;
  }
  return { isIndex, entries, valid: lower.includes('<urlset') || isIndex };
}

function between(body, lowerBody, tag) {
  const a = lowerBody.indexOf(`<${tag}>`);
  if (a === -1) return undefined;
  const b = lowerBody.indexOf(`</${tag}>`, a);
  if (b === -1) return undefined;
  return body.slice(a + tag.length + 2, b);
}
