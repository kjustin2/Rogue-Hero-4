// Download curated CC0 assets (Kenney starter kits) into public/assets/.
// All source assets are CC0 1.0 (public domain) — see public/assets/CREDITS.md.
// Run: npm run assets
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets');
const FPS = 'https://raw.githubusercontent.com/KenneyNL/Starter-Kit-FPS/main';
const PLAT = 'https://raw.githubusercontent.com/KenneyNL/Starter-Kit-3D-Platformer/main';

// [destination relative to public/assets, source url]
const MANIFEST = [
  // --- 3D models (glTF binary) ---
  ['models/player.glb', `${PLAT}/models/character.glb`],
  ['models/enemy-flyer.glb', `${FPS}/models/enemy-flying.glb`],
  ['models/orb.glb', `${PLAT}/models/coin.glb`],
  // GLBs reference this texture by the relative path "Textures/colormap.png"
  ['models/Textures/colormap.png', `${PLAT}/models/Textures/colormap.png`],
  // --- particle sprites ---
  ['sprites/burst.png', `${FPS}/sprites/burst.png`],
  ['sprites/hit.png', `${FPS}/sprites/hit.png`],
  ['sprites/particle.png', `${PLAT}/sprites/particle.png`],
  ['sprites/shadow.png', `${FPS}/sprites/blob_shadow.png`],
  // --- sound effects (Ogg Vorbis) ---
  ['sounds/shoot.ogg', `${FPS}/sounds/blaster.ogg`],
  ['sounds/shoot2.ogg', `${FPS}/sounds/blaster_repeater.ogg`],
  ['sounds/hit.ogg', `${FPS}/sounds/enemy_hurt.ogg`],
  ['sounds/kill.ogg', `${FPS}/sounds/enemy_destroy.ogg`],
  ['sounds/enemy-attack.ogg', `${FPS}/sounds/enemy_attack.ogg`],
  ['sounds/swap.ogg', `${FPS}/sounds/weapon_change.ogg`],
  ['sounds/pickup.ogg', `${PLAT}/sounds/coin.ogg`],
  ['sounds/dash.ogg', `${PLAT}/sounds/jump.ogg`],
  ['sounds/land.ogg', `${PLAT}/sounds/land.ogg`],
  ['sounds/crash.ogg', `${PLAT}/sounds/break.ogg`],
];

async function get(dest, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = join(OUT, dest);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  return buf.length;
}

let total = 0;
for (const [dest, url] of MANIFEST) {
  const n = await get(dest, url);
  total += n;
  console.log(`  ${dest}  (${(n / 1024).toFixed(1)} KiB)`);
}

const credits = `# Asset credits

All bundled assets are **CC0 1.0 Universal (public domain)** — free for any use, no attribution required.
We credit the source anyway because it's the decent thing to do.

## 3D models, sprites & sound effects — Kenney (kenney.nl)
- Sourced from Kenney's CC0 "Starter Kit" repositories on GitHub:
  - https://github.com/KenneyNL/Starter-Kit-FPS
  - https://github.com/KenneyNL/Starter-Kit-3D-Platformer
- License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
- Files: models/*.glb, sprites/*.png, sounds/*.ogg (downloaded via scripts/assets.mjs)

## Music
- Procedurally synthesized at runtime via Web Audio (original work, released CC0).

Re-fetch all assets any time with: \`npm run assets\`
`;
await writeFile(join(OUT, 'CREDITS.md'), credits);
console.log(`\nDone: ${MANIFEST.length} files, ${(total / 1024).toFixed(0)} KiB total.`);
