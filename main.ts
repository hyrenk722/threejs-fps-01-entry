// PORTFALL — make.fun threejs-fps-01 entry program (Node 22, stdlib only).
//
// What it hands in: game/ (the playable game as static ES modules, three.js
// 0.187.0 vendored from the kit), screenshots/ (4 renders of the game's own
// code), and dossier.json written by the kit's buildDossier. The program is
// deterministic: it copies files and writes the dossier, nothing in it reads
// the clock or a random source, so two runs write byte-identical output.
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});

// Fail fast instead of handing in a dossier the scorer would refuse: the
// text must fit the 160 KiB the judge reads (buildDossier truncates past
// the cap, so a cut dossier would hide source from the judge), and every
// screenshot must be present and under 256 KiB. (Dimensions are enforced
// where the shots are taken: the capture viewport is exactly 1280x480.)
const summary = JSON.parse(new TextDecoder().decode(dossier));
const problems = [];
const textBytes = Buffer.byteLength(summary.text, 'utf8');
if (textBytes > 163840) problems.push(`source text ${textBytes} bytes exceeds 163840`);
if (summary.images.length < 3 || summary.images.length > 4) problems.push(`${summary.images.length} screenshots (need 3-4)`);
for (const img of summary.images) {
  const bytes = Buffer.from(img.base64, 'base64').length;
  if (bytes > 262144) problems.push(`screenshot ${img.name} is ${bytes} bytes (over 262144)`);
}
if (problems.length) {
  console.error(`PORTFALL: dossier rejected:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
writeFileSync(join(out, 'dossier.json'), dossier);

// A short human-readable receipt on stdout (the grader ignores it).
console.log(`PORTFALL: dossier ${dossier.length} bytes, text ${summary.text.length} bytes, ${summary.images.length} screenshots`);
