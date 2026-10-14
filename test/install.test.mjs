// `--install-skill`: one command that puts the skill where Claude Code looks for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '../skills/rg-seo-geo-skill/scripts/audit.mjs');
const run = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out, err, all: out + err }));
});
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('installs the whole skill into <target>/rg-seo-geo-skill, creating missing folders', async () => {
  const target = path.join(tmp('inst-'), 'does', 'not', 'exist', 'yet');       // the classic trap of `cp -R` into a missing folder
  const r = await run(['--install-skill', '--target', target]);
  assert.equal(r.code, 0, r.all);
  const dest = path.join(target, 'rg-seo-geo-skill');
  for (const f of ['SKILL.md', 'scripts/audit.mjs', 'scripts/lib/catalog.mjs', 'scripts/lib/source/index.mjs', 'references/source-fixes.md']) {
    assert.ok(fs.existsSync(path.join(dest, f)), `${f} missing`);
  }
  assert.match(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), /^---\nname: rg-seo-geo-skill\n/);
  assert.match(r.all, /rg-seo-geo-skill/);
  assert.match(r.all, /Claude Code/i);                                         // tells the person what to do next
});

test('the installed copy is self-contained and runs', async () => {
  const target = tmp('inst-');
  await run(['--install-skill', '--target', target]);
  const installed = path.join(target, 'rg-seo-geo-skill', 'scripts', 'audit.mjs');
  const r = await new Promise((resolve) => { const p = spawn(process.execPath, [installed, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', (c) => resolve({ c, o })); });
  assert.equal(r.c, 0);
  assert.match(r.o, /Usage/);
});

test('an existing install is not overwritten silently; --force updates it', async () => {
  const target = tmp('inst-');
  await run(['--install-skill', '--target', target]);
  const marker = path.join(target, 'rg-seo-geo-skill', 'MY-NOTES.txt');
  fs.writeFileSync(marker, 'local edit');
  const again = await run(['--install-skill', '--target', target, '--lang', 'en']);
  assert.equal(again.code, 0, again.all);
  assert.match(again.all, /already installed/i);
  assert.match(again.all, /--force/);
  const spanish = await run(['--install-skill', '--target', target]);       // Spanish is the default language
  assert.match(spanish.all, /ya está instalada/i);
  assert.ok(fs.existsSync(marker), 'a plain re-run must not touch the existing folder');
  const forced = await run(['--install-skill', '--target', target, '--force']);
  assert.equal(forced.code, 0, forced.all);
  assert.ok(!fs.existsSync(marker), '--force replaces the folder with a clean copy');
  assert.ok(fs.existsSync(path.join(target, 'rg-seo-geo-skill', 'SKILL.md')));
});

test('default target is ~/.claude/skills under the current home folder', async () => {
  const home = tmp('home-');
  const r = await run(['--install-skill'], { HOME: home, USERPROFILE: home });
  assert.equal(r.code, 0, r.all);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'rg-seo-geo-skill', 'SKILL.md')));
});

test('safety: never writes through a symlink, never copies a folder into itself, never follows symlinks inside the source', async () => {
  // target that is a symlink to somewhere else
  const real = tmp('real-'); const link = path.join(tmp('lnk-'), 'skills'); fs.symlinkSync(real, link);
  const r1 = await run(['--install-skill', '--target', link]);
  assert.equal(r1.code, 2, r1.all);
  assert.match(r1.all, /symlink/i);
  assert.deepEqual(fs.readdirSync(real), [], 'nothing may be written through the symlink');
  // destination skill folder is a symlink
  const t2 = tmp('t2-'); const victim = tmp('victim-'); fs.symlinkSync(victim, path.join(t2, 'rg-seo-geo-skill'));
  const r2 = await run(['--install-skill', '--target', t2, '--force']);
  assert.equal(r2.code, 2, r2.all);
  assert.deepEqual(fs.readdirSync(victim), [], 'the symlink target must be untouched');
  // target inside the skill itself
  const inside = path.join(here, '../skills/rg-seo-geo-skill/references');
  const r3 = await run(['--install-skill', '--target', inside]);
  assert.equal(r3.code, 2, r3.all);
  assert.ok(!fs.existsSync(path.join(inside, 'rg-seo-geo-skill')));
});

test('--install-skill does not need --url / --src / --build, and appears in --help', async () => {
  const help = await run(['--help']);
  assert.match(help.out, /--install-skill/);
  const r = await run(['--install-skill', '--target', tmp('inst-')]);
  assert.equal(r.code, 0, r.all);
});
