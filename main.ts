// Glasshouse Breach — entry program for the make.fun threejs-fps-02 bounty.
//
// The game itself is the static site under game/ (plain ES modules, three.js
// vendored beside it, no build step). This program is only the courier: it
// carries game/ and screenshots/ from this repository into the output folder
// and writes the dossier the judge reads, using the kit's own library so the
// bytes match what the gate rebuilds on its side.
//
// Run it the way the grader does, from the repository root:
//   node main.ts                       (writes /output)
//   MAKEFUN_OUTPUT_DIR=out node main.ts (writes ./out, for local checks)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const target = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's published caps, mirrored so a local run refuses anything the
// scorer would refuse: the judge's source text budget, at most four
// screenshots of at most 256 KiB, and game/ within its file and byte caps.
const GATE_CAPS = {
  text_max_bytes: 163_840,
  screenshots: { max: 4, max_bytes: 262_144 },
  game_max_files: 993,
  game_max_bytes: 50_331_648,
} as const;

mkdirSync(target, { recursive: true });
cpSync(join(repoRoot, 'game'), join(target, 'game'), { recursive: true });

const shotsFrom = join(repoRoot, 'screenshots');
if (existsSync(shotsFrom)) {
  cpSync(shotsFrom, join(target, 'screenshots'), { recursive: true });
} else {
  mkdirSync(join(target, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(target, GATE_CAPS);
writeFileSync(join(target, 'dossier.json'), dossier);
console.log(`glasshouse-breach: game + screenshots copied, dossier written (${dossier.length} bytes) to ${target}`);
