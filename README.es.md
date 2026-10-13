# rg-seo-geo-skill

Una skill de [Claude Code](https://claude.com/claude-code) y CLI sin dependencias que audita la calidad de **SEO** y **búsqueda con IA (GEO)** de cualquier sitio y genera un reporte para compartir con el equipo. Revisiones profundas para proyectos **Next.js (App Router)**.

[Read in English](README.md)

## Por qué existe

La mayoría de herramientas califican páginas con un LLM (no reproducible) o repiten consejos sin evidencia. Esta se basa en tres reglas:

1. **Determinista.** Lee tus páginas como un rastreador y tus archivos de código. Misma entrada, misma salida.
2. **Estándar transparente.** Los 61 checks viven en [`catalog.mjs`](skills/rg-seo-geo-skill/scripts/lib/catalog.mjs), cada uno con nivel (bloqueante / importante / consejo), base (**oficial** / **medido** / **heurística**) y enlace a la fuente. [Lee el estándar](skills/rg-seo-geo-skill/references/standard.es.md).
3. **Honesta con GEO.** Las heurísticas están etiquetadas y nunca bloquean un lanzamiento. llms.txt es solo informativo: Google dice que no tiene efecto en Search.

A propósito **no hay un puntaje 0–100**. El veredicto sale de bloqueantes y fallas importantes.

## Inicio rápido

Requiere Node 18+. Sin instalar nada.

```bash
# cualquier sitio publicado
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://ejemplo.com

# un proyecto Next.js + su URL en vivo
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://ejemplo.com --src ../mi-sitio --out ./reporte

# puerta de CI: código de salida 1 si hay bloqueantes
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://staging.ejemplo.com --fail-on blocker --quiet
```

Resultado: `report.html` (reporte para el equipo), `report.md`, `audit.json`.

## Úsala como skill de Claude Code

```bash
cp -R skills/rg-seo-geo-skill ~/.claude/skills/
```

Luego pídele a Claude: *"audita el SEO y GEO de https://… y del proyecto en ~/code/mi-sitio"*. La skill ejecuta el script, explica la evidencia en tu idioma y propone correcciones ([`references/nextjs-fixes.md`](skills/rg-seo-geo-skill/references/nextjs-fixes.md)).

## Qué no hace

No juzga calidad de contenido, intención de búsqueda, E-E-A-T, backlinks ni datos de usuarios reales, y no predice citas de IA. Tampoco mide rendimiento: el reporte enlaza a PageSpeed Insights, Search Console, Rich Results Test y los depuradores de compartir, ya cargados con tu URL. Lee el HTML que envía el servidor y no ejecuta JavaScript; las páginas que se renderizan en el navegador se marcan en el reporte. El modo código lee archivos con expresiones regulares; estructuras inusuales pueden quedar como *no evaluadas*.

## Calibrada con sitios reales

Los checks están ajustados contra un corpus de 27 sitios reales ([`test/corpus.txt`](test/corpus.txt)): WordPress, Shopify, Wix, Webflow, Next.js, Astro, Nuxt, SvelteKit, Laravel, Django, medios con protección anti-bots y más. Esa prueba encontró bugs reales (un crash con un sitemap de 118 mil URLs, cabeceras de 16 KB, bloqueos anti-bots leídos como errores del sitio) y checks más estrictos que el propio Google (canonical, H1 o JSON-LD ausentes no son requisitos). Cada hallazgo quedó como prueba de regresión. Ejecútala con `npm run corpus`.

## Seguridad

La herramienta consulta las URLs que le das, por eso bloquea por defecto direcciones privadas, loopback y link-local (verificado al conectar, para resistir DNS rebinding) y revalida cada redirección. Para auditar un servidor local necesitas `--allow-local`. Nunca ejecuta código del proyecto. No hace llamadas a terceros: solo contacta tu sitio.

## Desarrollo

```bash
npm test        # pruebas unitarias e integración
npm run corpus  # audita el corpus real y lista los hallazgos más frecuentes (detecta falsos positivos)
npm run docs    # regenera references/standard.*.md desde el catálogo
```

## Licencia

MIT
