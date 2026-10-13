# rg-seo-geo-skill

Una skill de [Claude Code](https://claude.com/claude-code) y CLI sin dependencias que audita la calidad de **SEO** y **búsqueda con IA (GEO)** de cualquier sitio y genera un reporte para compartir con el equipo. Revisiones profundas para proyectos **Next.js (App Router)**.

[Read in English](README.md)

## Por qué existe

La mayoría de herramientas califican páginas con un LLM (no reproducible) o repiten consejos sin evidencia. Esta se basa en tres reglas:

1. **Determinista.** Lee tus páginas como un rastreador y tus archivos de código. Misma entrada, misma salida.
2. **Estándar transparente.** Los 66 checks viven en [`catalog.mjs`](skills/rg-seo-geo-skill/scripts/lib/catalog.mjs), cada uno con nivel (bloqueante / importante / consejo), base (**oficial** / **medido** / **heurística**) y enlace a la fuente. [Lee el estándar](skills/rg-seo-geo-skill/references/standard.es.md).
3. **Honesta con GEO.** Las heurísticas están etiquetadas y nunca bloquean un lanzamiento. llms.txt es solo informativo: Google dice que no tiene efecto en Search.

A propósito **no hay un puntaje 0–100**. El veredicto sale de bloqueantes y fallas importantes.

## Inicio rápido

Requiere Node 18+. Sin instalar nada.

```bash
# cualquier sitio publicado
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://ejemplo.com

# un proyecto Next.js + su URL en vivo
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://ejemplo.com --src ../mi-sitio --out ./reporte

# antes de publicar, cualquier tecnología: audita la carpeta compilada (dist, out, public, _site, build...)
node skills/rg-seo-geo-skill/scripts/audit.mjs --build ./dist

# muestra el progreso frente a la auditoría anterior guardada en la carpeta de salida
node skills/rg-seo-geo-skill/scripts/audit.mjs --url https://ejemplo.com --out ./reporte --compare auto

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

Esta herramienta visita URLs que no controla y lee documentos escritos por desconocidos, así que se atacó antes de publicarse: un revisor independiente intentó explotarla y cada hallazgo confirmado quedó como prueba de regresión ([`test/security.test.mjs`](test/security.test.mjs), [`test/security2.test.mjs`](test/security2.test.mjs)).

- **SSRF:** se rechazan direcciones privadas, loopback, link-local y de metadatos, incluidas las formas IPv6 que esconden una IPv4 (mapeada, NAT64, 6to4, Teredo). La verificación ocurre al conectar (sin DNS rebinding) y en cada salto de redirección. `--allow-local` y `--build` alcanzan **un solo origen**, nunca lo que el contenido auditado señale.
- **Entradas hostiles:** HTML, XML, robots.txt y JSON-LD se leen en una sola pasada lineal. Entradas que colgaban minutos al primer lector (basado en regex), como 700 mil etiquetas `<a ` sin cerrar, ahora toman milisegundos. Las respuestas tienen tope de tamaño (incluidas las bombas de descompresión) y de tiempo.
- **Servidor de `--build`:** solo loopback, solo GET/HEAD, no puede salir de la carpeta (traversal, traversal codificado, symlinks, archivos ocultos) y rechaza cabeceras `Host` ajenas (DNS rebinding).
- **Reportes:** el texto citado del sitio auditado se limpia de caracteres de control e invisibles de Unicode, se acota y se escapa en HTML y Markdown. Los reportes y `audit.json` llevan un aviso de "contenido no confiable", porque puede leerlos un agente de IA.
- **Archivos:** `--out` nunca escribe a través de un symlink; los archivos de `--compare` se tratan como datos no confiables; `--src` no sigue symlinks; los reportes compartibles no contienen rutas locales absolutas.
- **Sin terceros:** solo se contacta el sitio auditado. Nunca se ejecuta código del proyecto.

Límite conocido: un hardlink colocado dentro de una carpeta de build por alguien con acceso local a la máquina se sirve como cualquier archivo. Si auditas una carpeta en la que no confías, hazlo en un entorno desechable.

## Desarrollo

```bash
npm test        # pruebas unitarias e integración
npm run corpus  # audita el corpus real y lista los hallazgos más frecuentes (detecta falsos positivos)
npm run docs    # regenera references/standard.*.md desde el catálogo
```

## Licencia

MIT
