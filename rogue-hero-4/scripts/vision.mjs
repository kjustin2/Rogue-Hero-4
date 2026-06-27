// Vision QA — the harness that actually SEES the game.
// 1. Capture every scenario at full FX (the real look), well-framed.
// 2. Judge each screenshot with the authed `claude` CLI against docs/GAME_BIBLE.md.
// 3. Emit shots/VISION.md (scored report) + shots/vision-contact.png (annotated sheet).
//
// Why this exists: the luma/console-error harness certified a 90%-black, top-down,
// unreadable game as "✓ healthy". Pixels-are-not-all-black != good. This gives it eyes.
//
// Usage: node scripts/vision.mjs [scenario ...]   (default: a representative set)
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { withGame } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// which criteria apply per screen, + what the screen is supposed to be
const MENU = ['menu_clarity', 'readability', 'appeal', 'environment', 'detail'];
const COMBAT = ['camera', 'readability', 'clarity', 'environment', 'appeal', 'feel', 'detail'];
const SPEC = {
  title:    { crit: MENU,   want: 'Title: game name big, one obvious Play button, one line of what this is.' },
  select:   { crit: MENU,   want: 'Character select: clear vessel cards (name, role, abilities, HP); a working Back; nothing clipped.' },
  howto:    { crit: MENU,   want: 'How-to-play reference: unmissable controls + goal so a new player knows exactly how to play.' },
  tutorial: { crit: MENU,   want: 'Interactive tutorial: a clear instructional prompt banner over the arena teaching ONE mechanic at a time; readable, on-brand, not blocking the view.' },
  combat:   { crit: COMBAT, want: 'Combat: behind-the-shoulder third person, hero large in lower third, readable HUD + 4 ability cards, lit arena.' },
  swarm:    { crit: COMBAT, want: 'Combat vs many foes: still readable and framed; you can tell hero from the swarm.' },
  boss:     { crit: COMBAT, want: 'Boss fight: boss reads as a big threat, boss HP bar visible, telegraphed bullets, good framing.' },
  crit:     { crit: COMBAT, want: 'CRITICAL tempo zone: the TEMPO meter clearly shows the CRITICAL zone; combat readable.' },
  hot:      { crit: COMBAT, want: 'HOT tempo zone: the TEMPO meter clearly shows the HOT zone; combat readable.' },
  draft:    { crit: MENU,   want: 'Relic draft: pick 1 of 3, each with a readable name + effect.' },
  gameover: { crit: MENU,   want: 'Defeat screen: clear outcome, run stats, Run-again + Menu buttons.' },
  win:      { crit: MENU,   want: 'Victory screen: clear win, stats, Run-again + Menu buttons.' },
};

const argv = process.argv.slice(2).filter((a) => SPEC[a]);
const NAMES = argv.length ? argv : ['title', 'select', 'howto', 'tutorial', 'combat', 'swarm', 'boss', 'crit', 'draft', 'gameover', 'win'];

// Anchored criterion definitions — concrete checks are FAR more stable run-to-run than
// open "rate 0-10" vibes (per VideoGameQA-Bench). Each anchor says what 8-10 / 4-6 / 0-3 mean.
const ANCHORS = {
  camera: 'camera: 8-10 = clearly behind/over-the-shoulder, hero large in the lower third; 4-6 = third-person but hero small or mid-frame; 0-3 = top-down OR hero a tiny speck OR cropped.',
  readability: 'readability: 8-10 = every visible label/card/number is crisp and legible; 4-6 = mostly readable, some small/dim text; 0-3 = clipped/overlapping/unreadable text.',
  clarity: 'clarity: 8-10 = hero, enemies, and projectiles are instantly distinguishable by colour+shape; 4-6 = readable with effort; 0-3 = hero blends with enemies/background.',
  menu_clarity: 'menu_clarity: 8-10 = obvious what to do, primary action stands out; 4-6 = workable but unclear CTA; 0-3 = confusing/broken layout.',
  environment: 'environment: 8-10 = a lit, deliberate neon-arcane place with DEPTH and surface detail (textured/paneled floor, structures, atmosphere); 4-6 = lit but a plain flat plane / thin grid; 0-3 = mostly black void or flat monochrome gradient. For MENUS, a clean styled backdrop is 7+.',
  appeal: 'appeal: 8-10 = looks like a polished shipped indie game (cohesive art direction, crafted detail, good contrast/bloom); 4-6 = fine but generic; 0-3 = primitive geometric shapes on flat gradients = PROGRAMMER ART. Be harsh: untextured planes and single-primitive entities are NOT 7+.',
  feel: 'feel: 8-10 = the moment looks dynamic and punchy (fire/projectiles/impact/juice on screen); 4-6 = some action; 0-3 = static/empty.',
  detail: 'detail/craft (be HARSH): 8-10 = entities are multi-part designed models and surfaces have real texture/material detail (paneled/circuit floor, layered models, rim/fresnel); 4-6 = simple but intentional shapes with some accents; 0-3 = single geometric primitives (cones/dice/spheres), flat untextured planes, featureless blobs — programmer art.',
};

async function judge(name) {
  const spec = SPEC[name];
  const prompt = `You are the visual-QA judge for a 3D neon-arcane roguelike. The full design intent is in @docs/GAME_BIBLE.md — read it; the screenshot must match that intent.

Judge ONE screenshot of the "${name}" screen: @shots/vision-${name}.png
What this screen SHOULD be: ${spec.want}

Score these criteria using these ANCHORS (apply them literally and consistently):
${spec.crit.map((c) => '- ' + ANCHORS[c]).join('\n')}

Return ONLY one minified JSON object, no markdown, no prose around it:
{"reasoning":"<2-3 blunt sentences>","scores":{${spec.crit.map((c) => `"${c}":<0-10>`).join(',')}},"top_issues":["<concrete fix>","<concrete fix>"],"verdict":"<pass|fail>"}`;

  const once = () => new Promise((resolve) => {
    // prompt via stdin (not argv) — a multi-line arg gets mangled by shell:true on Windows
    const p = spawn('claude', ['-p', '--model', 'sonnet'], { cwd: ROOT, shell: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', () => {});
    p.stdin.write(prompt);
    p.stdin.end();
    p.on('close', () => {
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) return resolve({ name, error: 'no JSON from judge', raw: out.slice(0, 200) });
      try { resolve({ name, ...JSON.parse(m[0]) }); }
      catch (e) { resolve({ name, error: 'bad JSON: ' + e.message, raw: m[0].slice(0, 200) }); }
    });
  });
  // claude -p is occasionally flaky under parallel load — retry once on a non-result
  let r = await once();
  if (r.error) r = await once();
  return r;
}

// ---- 1. capture every scenario at full FX -------------------------------------
const shots = await withGame(async ({ page, shot }) => {
  const captured = [];
  for (const name of NAMES) {
    await page.evaluate((n) => window.__game.scenario(n), name);
    // combat shots: fire a staggered burst and capture MID-action (projectiles in flight,
    // particles fresh) so "feel" reads dynamic — NOT for hot/crit (casting crashes the zone)
    if (['combat', 'swarm', 'boss'].includes(name)) {
      // fire bolts (card 1) toward the foes ahead + an AoE (card 2) so multiple projectiles
      // streak and impacts pop; the dt-capped headless clock is slow, so pace the waits.
      await page.evaluate(() => { window.__game.aimAt(0, -8); window.__game.cast(1); window.__game.cast(2); });
      await wait(150);
      await page.evaluate(() => { window.__game.aimAt(-5, -8); window.__game.cast(1); });
      await wait(150);
      await page.evaluate(() => { window.__game.aimAt(5, -8); window.__game.cast(1); });
      await wait(280);
    } else {
      await wait(750);
    }
    await shot(`vision-${name}.png`);
    captured.push(name);
    console.log(`captured ${name}`);
  }
  return captured;
}, { query: '' }); // full FX = the real graded look

// ---- 2. judge all shots in parallel (capped) ----------------------------------
console.log(`\nJudging ${shots.length} shots with claude (sonnet)…`);
const results = [];
const POOL = 3;
for (let i = 0; i < shots.length; i += POOL) {
  results.push(...await Promise.all(shots.slice(i, i + POOL).map((n) => judge(n))));
}

// ---- 3. report ----------------------------------------------------------------
const allCrit = [...new Set(Object.values(SPEC).flatMap((s) => s.crit))];
const cell = (r, c) => (r.scores && r.scores[c] != null ? String(r.scores[c]) : '·');
const flat = results.flatMap((r) => (r.scores ? Object.values(r.scores) : []));
const min = flat.length ? Math.min(...flat) : 0;
const avg = flat.length ? (flat.reduce((a, b) => a + b, 0) / flat.length).toFixed(1) : '0';
const fails = results.filter((r) => !r.scores || Object.values(r.scores).some((v) => v < 7));
const pass = fails.length === 0 && min >= 7;

const md = [
  '# Rogue Hero 4 — VISION REPORT', '',
  `Judge: claude (sonnet) vs docs/GAME_BIBLE.md · Scenarios: ${results.length}`,
  `**Overall: ${pass ? '✅ PASS' : '❌ FAIL'}** · avg ${avg}/10 · min ${min}/10 · below-bar scenarios: ${fails.length}`, '',
  '| scenario | ' + allCrit.join(' | ') + ' | verdict |',
  '|---|' + allCrit.map(() => '---').join('|') + '|---|',
  ...results.map((r) => `| ${r.name} | ${allCrit.map((c) => cell(r, c)).join(' | ')} | ${r.verdict || r.error || '?'} |`),
  '', '## Issues to fix (ranked by lowest score)',
  ...results
    .filter((r) => r.scores)
    .sort((a, b) => Math.min(...Object.values(a.scores)) - Math.min(...Object.values(b.scores)))
    .map((r) => `\n### ${r.name} — min ${Math.min(...Object.values(r.scores))}/10\n${r.reasoning || ''}\n` +
      (r.top_issues || []).map((i) => `- ${i}`).join('\n')),
  ...results.filter((r) => r.error).map((r) => `\n### ${r.name} — JUDGE ERROR\n${r.error}\n\`${r.raw || ''}\``),
].join('\n');
await writeFile(join(ROOT, 'shots', 'VISION.md'), md);

console.log('\n' + md.split('\n').slice(0, 8 + results.length).join('\n'));
console.log(`\nVISION done — shots/VISION.md (${pass ? 'PASS' : 'FAIL'}, avg ${avg}, min ${min})`);
process.exit(0);
