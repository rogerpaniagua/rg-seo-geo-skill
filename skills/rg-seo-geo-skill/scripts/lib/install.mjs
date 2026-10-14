// One-command installation of this skill for Claude Code:
//   npx github:rogerpaniagua/rg-seo-geo-skill --install-skill
//
// Copies the skill folder (SKILL.md + references + scripts) to <target>/rg-seo-geo-skill, where target defaults to
// ~/.claude/skills. It replaces the manual "git clone + cp -R" steps, which fail in quiet ways: `cp -R` into a folder
// that does not exist yet creates a folder with the wrong name, and the skill is never loaded.
//
// Safe by construction: only regular files are copied (symlinks and node_modules are skipped), nothing is ever written
// through a symlink, an existing installation is left alone unless --force is given, and the target cannot be inside
// the skill itself.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'rg-seo-geo-skill';

const isSymlink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

/** Where the running copy of the skill lives (…/skills/rg-seo-geo-skill). */
export function skillSourceDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function defaultTarget() {
  return path.join(os.homedir(), '.claude', 'skills');
}

/**
 * @returns {{ status: 'installed' | 'updated' | 'exists' | 'in-place', dest: string }}
 */
export function installSkill({ target, force = false } = {}) {
  const src = skillSourceDir();
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw new Error('cannot find SKILL.md next to the running tool; install from the repository folder');

  let targetDir = target || defaultTarget();
  if (targetDir === '~' || targetDir.startsWith('~/')) targetDir = path.join(os.homedir(), targetDir.slice(1));
  targetDir = path.resolve(targetDir);
  if (isSymlink(targetDir)) throw new Error(`the target folder is a symlink: ${targetDir}. Pass its real location with --target (nothing is written through symlinks)`);

  const dest = path.join(targetDir, SKILL_NAME);
  if (isSymlink(dest)) throw new Error(`${dest} is a symlink; refusing to install through it. Remove it first`);

  const realSrc = real(src);
  const realDest = fs.existsSync(dest) ? real(dest) : path.join(real(fs.existsSync(targetDir) ? targetDir : path.dirname(targetDir)), fs.existsSync(targetDir) ? SKILL_NAME : path.join(path.basename(targetDir), SKILL_NAME));
  if (realDest === realSrc) return { status: 'in-place', dest };
  if (inside(realDest, realSrc) || inside(realSrc, realDest)) throw new Error('the target cannot be inside the skill folder (or contain it)');

  const existed = fs.existsSync(dest);
  if (existed && !force) return { status: 'exists', dest };

  fs.mkdirSync(targetDir, { recursive: true });
  if (existed) {
    const st = fs.lstatSync(dest);
    if (!st.isDirectory()) throw new Error(`${dest} exists and is not a folder`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, {
    recursive: true,
    dereference: false,
    filter: (s) => {
      const name = path.basename(s);
      if (name === 'node_modules' || name === '.git' || name === '.DS_Store') return false;
      return !isSymlink(s);
    },
  });
  if (!fs.existsSync(path.join(dest, 'SKILL.md'))) throw new Error('installation did not complete: SKILL.md is missing in the destination');
  return { status: existed ? 'updated' : 'installed', dest };
}

const TEXT = {
  es: {
    installed: (d) => `✅ Skill instalada en ${d}\n\nSiguiente paso: cierra y vuelve a abrir Claude Code, y escribe:\n  /rg-seo-geo-skill audita https://tu-sitio.com\n`,
    updated: (d) => `✅ Skill actualizada en ${d}\n\nCierra y vuelve a abrir Claude Code para que cargue la versión nueva.\n`,
    exists: (d) => `ℹ️  La skill ya está instalada en ${d}.\nPara actualizarla a esta versión, ejecuta de nuevo el comando con --force.\n`,
    inPlace: (d) => `ℹ️  Estás ejecutando la copia que ya está instalada (${d}). No hay nada que copiar.\n`,
  },
  en: {
    installed: (d) => `✅ Skill installed in ${d}\n\nNext step: close and reopen Claude Code, then type:\n  /rg-seo-geo-skill audit https://your-site.com\n`,
    updated: (d) => `✅ Skill updated in ${d}\n\nClose and reopen Claude Code so it loads the new version.\n`,
    exists: (d) => `ℹ️  The skill is already installed in ${d}.\nTo update it to this version, run the command again with --force.\n`,
    inPlace: (d) => `ℹ️  You are running the copy that is already installed (${d}). Nothing to copy.\n`,
  },
};

export function installMessage(result, lang = 'es') {
  const t = TEXT[lang] || TEXT.es;
  return { installed: t.installed, updated: t.updated, exists: t.exists, 'in-place': t.inPlace }[result.status](result.dest);
}
