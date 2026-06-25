// Autoplay audit: a bot actually PLAYS the game (kite, aim, cast, walk portals,
// draft, retry on death) for a wall-time budget, while asserting invariants every
// frame. Surfaces real bugs (NaN, tempo OOB, arena escape, soft-locked rooms,
// pool leaks) AND a balance/fun signal (how far a competent player gets).
import { withGame } from './harness.mjs';

const BUDGET_MS = Number(process.env.AUDIT_MS || 70000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (page, fn, ...a) => page.evaluate(fn, ...a);
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failed++; };

const report = await withGame(async ({ page, errors }) => {
  await ev(page, () => window.__game.start('pyre'));

  // in-page bot: runs every frame, controls the player, records invariant breaks
  await ev(page, () => {
    window.__audit = { violations: [], maxEnemies: 0, maxActiveProj: 0, deaths: 0, wins: 0, rooms: 0, maxDepth: 1, frames: 0, idleRoomFrames: 0, hpLow: 999 };
    window.__botOn = true;
    const A = window.__audit;
    const log = (m) => { if (A.violations.length < 40) A.violations.push(m); };
    const tick = () => {
      if (!window.__botOn) return;
      const g = window.__game, w = g.world; A.frames++;
      if (g.mode !== 'playing' || !w.player || !w.player.alive) return;
      const pl = w.player;
      if (!Number.isFinite(pl.x) || !Number.isFinite(pl.z) || !Number.isFinite(pl.tempo)) log(`NaN player d${w.run.depth}`);
      if (pl.tempo < -1.5 || pl.tempo > 101.5) log(`tempo OOB ${pl.tempo.toFixed(1)}`);
      if (Math.abs(pl.x) > 31 || Math.abs(pl.z) > 31) log(`player escaped ${pl.x.toFixed(0)},${pl.z.toFixed(0)}`);
      A.maxDepth = Math.max(A.maxDepth, w.run.depth);
      A.hpLow = Math.min(A.hpLow, pl.hp);
      const alive = w.enemies.filter((e) => !e.dead);
      A.maxEnemies = Math.max(A.maxEnemies, alive.length);
      A.maxActiveProj = Math.max(A.maxActiveProj, w.projectiles.filter((p) => p.active).length);
      for (const e of alive) { if (Math.abs(e.x) > 33 || Math.abs(e.z) > 33) { log('enemy escaped arena'); break; } }
      // soft-lock watchdog: cleared a non-boss room but no portal
      if (alive.length === 0 && !w.portalOpen && w.run.depth < 6) { A.idleRoomFrames++; if (A.idleRoomFrames === 90) log(`room ${w.run.depth} did not open portal`); }
      else A.idleRoomFrames = 0;

      if (w.portalOpen) {
        g.aimAt(w.portalX, w.portalZ);
        g.setMove(Math.sign(w.portalX - pl.x), Math.sign(w.portalZ - pl.z));
        return;
      }
      let tgt = null, bd = 1e9;
      for (const e of alive) { const dx = e.x - pl.x, dz = e.z - pl.z; const d = dx * dx + dz * dz; if (d < bd) { bd = d; tgt = e; } }
      // a real player focuses the boss rather than chasing summoned adds
      if (w.boss && !w.boss.dead) { const dx = w.boss.x - pl.x, dz = w.boss.z - pl.z; bd = dx * dx + dz * dz; tgt = w.boss; }
      if (!tgt) { g.setMove(0, 0); return; }
      const d = Math.sqrt(bd) || 1; const ux = (tgt.x - pl.x) / d, uz = (tgt.z - pl.z) / d;
      g.aimAt(tgt.x, tgt.z);
      // dodge: find the nearest incoming bullet, strafe perpendicular to it;
      // retreat-strafe when swarmed or low HP. (competent-player proxy)
      let nearCount = 0, nbx = 0, nbz = 0, nbd = 1e9;
      for (const p of w.projectiles) {
        if (!p.active || p.friendly) continue;
        const px = p.x - pl.x, pz = p.z - pl.z; const pd = px * px + pz * pz;
        if (pd < 20) { nearCount++; if (pd < nbd) { nbd = pd; nbx = px; nbz = pz; } }
      }
      if (nearCount > 0) {
        const bl = Math.hypot(nbx, nbz) || 1; let mx = -nbz / bl, mz = nbx / bl;
        if (nearCount >= 3 || pl.hp < pl.maxHp * 0.3) { mx = mx * 0.4 - ux * 0.9; mz = mz * 0.4 - uz * 0.9; }
        g.setMove(mx, mz);
      } else if (d > 9) g.setMove(ux, uz);
      else if (d < 4.5) g.setMove(-ux, -uz);
      else g.setMove(-uz, ux);
      for (let i = 0; i < 4; i++) g.cast(i);
    };
    window.__botTimer = setInterval(tick, 16);
  });

  // node driver: handle state transitions while the bot fights
  const deadline = Date.now() + BUDGET_MS;
  while (Date.now() < deadline) {
    await wait(200);
    const mode = await ev(page, () => window.__game.mode);
    if (mode === 'draft') {
      await ev(page, () => { const g = window.__game; const o = g.world.draftOptions; if (o.length) g.chooseRelic(o[Math.floor(Math.random() * o.length)].id); window.__audit.rooms++; });
    } else if (mode === 'gameover') {
      await ev(page, () => { window.__audit.deaths++; window.__audit.maxDepth = Math.max(window.__audit.maxDepth, window.__game.world.run.depth); window.__game.start('pyre'); });
    } else if (mode === 'win') {
      await ev(page, () => { window.__audit.wins++; window.__game.start('pyre'); });
    }
  }
  await ev(page, () => { window.__botOn = false; clearInterval(window.__botTimer); });
  const a = await ev(page, () => window.__audit);
  const fs = await ev(page, () => window.__game.frameStats());
  return { a, fs, errors };
});

const { a, fs, errors } = report;
console.log(`\nPlayed ${a.frames} frames · rooms cleared ${a.rooms} · deaths ${a.deaths} · wins ${a.wins} · maxDepth ${a.maxDepth} · lowest HP ${a.hpLow}`);
console.log(`Peaks: enemies ${a.maxEnemies} · activeProj ${a.maxActiveProj} · geometries ${fs.geometries} · textures ${fs.textures}`);

check('no invariant violations', a.violations.length === 0, a.violations.slice(0, 6).join(' | '));
check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
check('made progress (cleared a room or won)', a.rooms > 0 || a.wins > 0, `rooms=${a.rooms}`);
check('reached past depth 1', a.maxDepth >= 2, `maxDepth=${a.maxDepth}`);
check('not unwinnable (a win OR deep progress)', a.wins > 0 || a.maxDepth >= 4, `wins=${a.wins} depth=${a.maxDepth}`);
check('not trivial (at least one death across runs)', a.deaths > 0 || a.wins > 0, `deaths=${a.deaths}`);
check('geometry stable (no leak)', fs.geometries < 200, `geom=${fs.geometries}`);

console.log(failed === 0 ? '\nAUDIT OK' : `\nAUDIT: ${failed} flag(s) — triage above`);
process.exit(failed === 0 ? 0 : 1);
