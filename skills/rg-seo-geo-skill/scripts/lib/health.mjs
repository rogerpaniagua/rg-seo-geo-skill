// Pure helpers for the "site health" checks. Kept free of I/O so they are trivial to test.

/** Subresources loaded over http:// from an https:// page (browsers block or warn: "mixed content"). */
export function findMixedContent(resources, pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return []; }
  if (page.protocol !== 'https:') return [];
  return resources.filter((r) => /^http:\/\//i.test(r.url));
}

/** Images without width AND height attributes can shift the layout while loading (CLS). data: URIs are ignored. */
export function imageDimensionIssues(images) {
  const real = images.filter((i) => !(i.src || '').startsWith('data:'));
  const missing = real.filter((i) => !(i.width && i.height)).length;
  return { total: real.length, missing };
}

const TRUST = {
  about: /(^|[/_.-])(about|acerca|nosotros|quienes|quiénes|sobre|equipo|team|company|empresa)([/_.-]|$)/i,
  contact: /(^|[/_.-])(contact|contacto|contactanos|contáctanos|contato)([/_.-]|$)/i,
  privacy: /(^|[/_.-])(privacy|privacidad|privacidade|datenschutz|politica-de-privacidad|cookies?)([/_.-]|$)/i,
  terms: /(^|[/_.-])(terms|terminos|términos|condiciones|conditions|legal|tos)([/_.-]|$)/i,
};

/** Which "who is behind this site" pages does the homepage link to? Based on link paths only (heuristic). */
export function trustSignals(anchors) {
  const out = { about: false, contact: false, privacy: false, terms: false };
  for (const a of anchors) {
    if (!a.href) continue;
    let path = a.href;
    try { path = new URL(a.href, 'https://x.invalid').pathname; } catch { /* keep raw */ }
    if (path.length > 300) continue;
    for (const k of Object.keys(TRUST)) if (!out[k] && TRUST[k].test(path)) out[k] = true;
  }
  return out;
}
