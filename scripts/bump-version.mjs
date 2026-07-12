#!/usr/bin/env node
// Zentrales Versions-Bump-Skript — die EINE Stelle, um die App-Version zu erhöhen.
//
// Quelle der Wahrheit ist shared/src/version.ts (APP_VERSION). Dieses Skript liest
// sie, erhöht sie und schreibt die neue Nummer synchron in ALLE Orte, an denen eine
// Version steht — damit nie irgendwo eine veraltete Zahl hängen bleibt:
//   • shared/src/version.ts        (APP_VERSION)
//   • package.json (root + shared + client + server)
//   • SPRINTS.md                   (Kopf-Badge + Versions-Historie-Tabelle)
//
// Aufruf:
//   node scripts/bump-version.mjs patch            → 3.1.0 → 3.1.1
//   node scripts/bump-version.mjs minor            → 3.1.0 → 3.2.0
//   node scripts/bump-version.mjs major            → 3.1.0 → 4.0.0
//   node scripts/bump-version.mjs 3.4.2            → exakt setzen
//   node scripts/bump-version.mjs minor "Notiz…"   → Historie-Zeile mit Notiz
//   node scripts/bump-version.mjs --print          → nur aktuelle Version ausgeben
//
// npm-Shortcuts: npm run bump:patch | bump:minor | bump:major
//
// Danach: Änderung committen — die Version gehört IN DEN COMMIT-TITEL, z. B.
//   git commit -m "v3.2.0 — <Kurzbeschreibung>"

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_TS = join(ROOT, 'shared/src/version.ts');
const SPRINTS = join(ROOT, 'SPRINTS.md');
const PKG_FILES = ['package.json', 'shared/package.json', 'client/package.json', 'server/package.json'];

const VERSION_RE = /^\d+\.\d+\.\d+$/;

function readCurrent() {
  const src = readFileSync(VERSION_TS, 'utf8');
  const m = src.match(/APP_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
  if (!m) {
    console.error('✗ Konnte APP_VERSION nicht aus shared/src/version.ts lesen.');
    process.exit(1);
  }
  return m[1];
}

function nextVersion(current, arg) {
  const [maj, min, pat] = current.split('.').map(Number);
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  if (arg === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (VERSION_RE.test(arg)) return arg;
  console.error(`✗ Ungültiges Argument: "${arg}". Erlaubt: patch | minor | major | x.y.z`);
  process.exit(1);
}

function today() {
  // Lokales Datum (nicht UTC) im Format YYYY-MM-DD.
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function writeVersionTs(next) {
  const src = readFileSync(VERSION_TS, 'utf8');
  const out = src.replace(/(APP_VERSION\s*=\s*['"])\d+\.\d+\.\d+(['"])/, `$1${next}$2`);
  writeFileSync(VERSION_TS, out);
}

function writePkg(file, next) {
  const path = join(ROOT, file);
  const src = readFileSync(path, 'utf8');
  // Nur das erste "version"-Feld ersetzen (steht im Kopf des Manifests).
  const out = src.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`);
  writeFileSync(path, out);
}

function updateSprints(next, note) {
  let src = readFileSync(SPRINTS, 'utf8');
  const date = today();

  // 1) Kopf-Badge „**App-Version:** `x.y.z`" aktualisieren oder direkt unter den H1 einfügen.
  if (/\*\*App-Version:\*\*\s*`\d+\.\d+\.\d+`/.test(src)) {
    src = src.replace(/(\*\*App-Version:\*\*\s*`)\d+\.\d+\.\d+(`)/, `$1${next}$2`);
  } else {
    src = src.replace(/^(# .*\n)/, `$1\n**App-Version:** \`${next}\`\n`);
  }

  // 2) Historie-Zeile in die Tabelle zwischen den Markern einfügen (neueste zuerst).
  const row = `| ${next} | ${date} | ${note} |`;
  const START = '<!-- versions:start -->';
  const END = '<!-- versions:end -->';
  if (src.includes(START) && src.includes(END)) {
    src = src.replace(
      new RegExp(`(${START}[\\s\\S]*?\\|\\s*[-]+\\s*\\|[^\\n]*\\n)`),
      `$1${row}\n`,
    );
  } else {
    // Historie-Sektion anlegen (ans Ende hängen).
    src = src.replace(/\n*$/, '\n');
    src +=
      `\n## Versions-Historie\n` +
      `> Automatisch gepflegt von \`scripts/bump-version.mjs\`. Neueste Version oben.\n\n` +
      `${START}\n` +
      `| Version | Datum | Änderung |\n` +
      `| ------- | ----- | -------- |\n` +
      `${row}\n` +
      `${END}\n`;
  }

  writeFileSync(SPRINTS, src);
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const current = readCurrent();

if (args[0] === '--print' || args.length === 0) {
  console.log(current);
  if (args.length === 0) {
    console.log('\nNutzung: node scripts/bump-version.mjs <patch|minor|major|x.y.z> ["Notiz"]');
  }
  process.exit(0);
}

const next = nextVersion(current, args[0]);
const note = args[1] && args[1].trim() ? args[1].trim() : 'Version erhöht';

if (next === current) {
  console.log(`Version bleibt ${current} (nichts zu tun).`);
  process.exit(0);
}

writeVersionTs(next);
for (const f of PKG_FILES) writePkg(f, next);
updateSprints(next, note);

console.log(`✓ Version ${current} → ${next}`);
console.log('  aktualisiert: shared/src/version.ts, package.json ×4, SPRINTS.md');
console.log('');
console.log('  Nächster Schritt — Version gehört in den Commit-Titel:');
console.log(`    git commit -m "v${next} — ${note}"`);
