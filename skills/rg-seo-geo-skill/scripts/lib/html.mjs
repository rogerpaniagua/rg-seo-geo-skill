// Minimal, dependency-free HTML extraction for audit purposes.
// Not a full HTML parser: it reads tags with regexes on a copy of the document where
// comments, <script> and <style> bodies are removed. That is enough for head metadata,
// headings, links, images and JSON-LD. The whole document is scanned (not just <head>)
// because Next.js may stream metadata into <body> for unrecognised user agents.

export function parseAttrs(str) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const k = m[1].toLowerCase();
    if (!(k in attrs)) attrs[k] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function strip(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

function allTags(html, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(html))) out.push(parseAttrs(m[1]));
  return out;
}

function textOf(fragment) {
  return decode(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function flattenJsonLd(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => flattenJsonLd(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  if (node['@graph']) flattenJsonLd(node['@graph'], out);
  if (node['@type']) out.push(node);
}

export function extractJsonLd(rawHtml) {
  const blocks = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(rawHtml))) {
    const text = m[1].trim();
    try {
      const data = JSON.parse(text);
      const nodes = [];
      flattenJsonLd(data, nodes);
      blocks.push({ ok: true, data, nodes, hasContext: JSON.stringify(data).includes('schema.org'), });
    } catch (e) {
      blocks.push({ ok: false, error: e.message, nodes: [] });
    }
  }
  return blocks;
}

export function parseHtml(rawHtml) {
  const html = strip(rawHtml);
  const metas = allTags(html, 'meta');
  const links = allTags(html, 'link');
  const metaByName = (n) => metas.find((m) => (m.name || '').toLowerCase() === n);
  const metaByProp = (p) => metas.find((m) => (m.property || '').toLowerCase() === p);
  const content = (m) => (m && m.content !== undefined ? m.content.trim() : undefined);

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const htmlTag = html.match(/<html\b([^>]*)>/i);

  const headings = [];
  const hre = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm;
  while ((hm = hre.exec(html))) headings.push({ level: Number(hm[1]), text: textOf(hm[2]) });

  const anchors = allTags(html, 'a');
  const images = allTags(html, 'img');

  // Text for word counts: drop non-content containers.
  const body = html.replace(/<(noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = textOf(body);

  const og = {};
  const metaMap = {};
  for (const m of metas) {
    const p = (m.property || m.name || m['http-equiv'] || '').toLowerCase();
    if (!p) continue;
    if (!(p in metaMap)) metaMap[p] = m.content;
    if (p.startsWith('og:') || p.startsWith('twitter:')) og[p] = m.content;
  }

  return {
    title: titleMatch ? textOf(titleMatch[1]) : undefined,
    lang: htmlTag ? parseAttrs(htmlTag[1]).lang : undefined,
    description: content(metaByName('description')),
    robotsMeta: (content(metaByName('robots')) || '').toLowerCase(),
    googlebotMeta: (content(metaByName('googlebot')) || '').toLowerCase(),
    viewport: content(metaByName('viewport')),
    charset: metas.some((m) => m.charset),
    canonical: (links.find((l) => (l.rel || '').toLowerCase().split(/\s+/).includes('canonical')) || {}).href,
    icons: links.filter((l) => /\bicon\b/i.test(l.rel || '')).map((l) => ({ rel: l.rel, href: l.href })),
    hreflang: links.filter((l) => (l.rel || '').toLowerCase() === 'alternate' && l.hreflang).map((l) => ({ lang: l.hreflang, href: l.href })),
    og,
    metaMap,
    ogImageWidth: content(metaByProp('og:image:width')),
    ogImageHeight: content(metaByProp('og:image:height')),
    headings,
    anchors,
    images,
    text,
    wordCount: text ? text.split(/\s+/).length : 0,
    listCount: (body.match(/<(ul|ol)\b/gi) || []).length,
    tableCount: (body.match(/<table\b/gi) || []).length,
    timeTags: (body.match(/<time\b/gi) || []).length,
    jsonLd: extractJsonLd(rawHtml),
  };
}

/** Parse image dimensions from PNG / JPEG / GIF / WebP headers. Returns {width,height} or null. */
export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fmt = buf.toString('ascii', 12, 16);
    if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (fmt === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (fmt === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

/** robots.txt parser: returns groups [{agents:[], rules:[{type,path}]}] and sitemaps[]. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (cur) cur.rules.push({ type: key, path: val });
      lastWasAgent = false;
    } else if (key === 'sitemap') {
      sitemaps.push(val);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

/** Is the homepage ("/") crawlable by `agent` under robots groups? Longest-match wins, allow wins ties. */
export function robotsAllows(parsed, agent, path = '/') {
  const a = agent.toLowerCase();
  let group = parsed.groups.find((g) => g.agents.includes(a));
  if (!group) group = parsed.groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = { len: -1, allow: true };
  for (const r of group.rules) {
    if (r.path === '' ) continue;
    const pattern = r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (new RegExp('^' + pattern).test(path)) {
      const len = r.path.length;
      const allow = r.type === 'allow';
      if (len > best.len || (len === best.len && allow)) best = { len, allow };
    }
  }
  return best.allow;
}

/** Extract <loc> values (and lastmod) from sitemap XML. */
export function parseSitemap(xml) {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const entries = [];
  const re = new RegExp(`<${isIndex ? 'sitemap' : 'url'}\\b[^>]*>([\\s\\S]*?)</${isIndex ? 'sitemap' : 'url'}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) {
    const loc = (m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
    const lastmod = (m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1];
    if (loc) entries.push({ loc: decode(loc.trim()), lastmod });
  }
  return { isIndex, entries, valid: /<(urlset|sitemapindex)\b/i.test(xml) };
}
