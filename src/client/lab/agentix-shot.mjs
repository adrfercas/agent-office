// Screenshots the agentix map from the places the two reference photos were taken, and a few more:
//
//   node src/client/lab/agentix-shot.mjs [outDir] [baseUrl]
//
// It needs the server (npx tsx src/server/cli.ts <dir> --port 4600 --password dev --no-open) and the
// Vite dev server (npx vite --host 0.0.0.0) running. It signs in with the password `dev`, waits for the
// world, then moves the player with window.__office.player (the debug hook main.ts already has) and
// shoots. No product code is involved. It also checks that walls stop you, doorways let you through and
// an empty desk shows its vacant-seat marker, and prints the results as JSON.
//
// The eyes are EYE_HEIGHT (1.4 m) above the feet, a little lower than the 1.6 m the photos were taken at.
// LAB_BROWSER=chromium uses Playwright's own Chromium; other values are as in shot.mjs.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/shots';
const base = process.argv[3] ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const logs = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message} ${(e.stack ?? '').split('\n').slice(1, 4).join(' | ')}`));
page.on('requestfailed', (r) => logs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const result = { shots: [], checks: {}, errors: logs };
const done = async (code) => {
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
  process.exit(code);
};

await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
// The office page sends you to /login from script when there is no session, so wait for either.
await page.waitForURL(/\/login/, { timeout: 120000 }).catch(() => {});
await page.waitForLoadState('domcontentloaded');
if (page.url().includes('/login')) {
  await page.fill('#password', 'dev');
  await page.click('#submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 120000 }).catch(() => {});
}
try {
  await page.waitForFunction(() => window.__office?.world && window.__office.plan, null, { timeout: 240000 });
  // A first visit opens the character picker: take the random character it offers.
  const enter = page.getByText('Enter the office');
  if (await enter.first().waitFor({ state: 'visible', timeout: 60000 }).then(() => true, () => false)) await enter.first().click();
  // The map arrives from the server after the first frame: wait for it to be agentix and built.
  await page.waitForFunction(() => window.__office.plan().id === 'agentix' && window.__office.world(), null, { timeout: 240000 });
  await page.waitForTimeout(4000);
} catch (e) {
  result.checks.loaded = `not loaded: ${e.message.split('\n')[0]}`;
  result.checks.planId = await page.evaluate(() => window.__office?.plan?.().id ?? null).catch(() => null);
  await page.screenshot({ path: `${out}/not-loaded.png`, timeout: 180000 });
  result.shots.push(`${out}/not-loaded.png`);
  await done(1);
}
result.checks.loaded = true;

// Moves the player (feet at x, z) to look along yaw/pitch. Yaw 0 looks north (-z), pi/2 west, -pi/2 east, pi south.
const stand = (x, z, yaw, pitch = 0) =>
  page.evaluate(
    ([x, z, yaw, pitch]) => {
      const p = window.__office.player;
      if (p.seat) p.stand();
      p.pos.set(x, p.pos.y, z);
      p.vy = 0;
      p.camYaw = yaw;
      p.lookPitch = pitch;
    },
    [x, z, yaw, pitch],
  );
const shoot = async (name) => {
  await page.waitForTimeout(700);
  const file = `${out}/${name}.png`;
  await page.screenshot({ path: file, timeout: 180000 });
  result.shots.push(file);
};

const N = 0;
const W = Math.PI / 2;
const E = -Math.PI / 2;
const S = Math.PI;

// Photo 1: from the door end, looking north at the window.
await stand(-8.2, -1.6, N, -0.04);
await shoot('1-door-end-north');
// Photo 2: from the east side, looking west at the long wall.
await stand(-6.6, -4.6, W, -0.04);
await shoot('2-east-side-west');
// Close at the window, looking out.
await stand(-8.7, -7.6, N, 0.02);
await shoot('3-window-close');
await stand(-8.7, -7.2, N, 0.1);
await shoot('3b-window-out');
// The second desk room, from its west end looking east along the rows.
await stand(-4.6, -5, E, -0.05);
await shoot('4-second-desk-room');
// The meeting room, from its north-west corner looking at the table.
await stand(-10.5, 3.2, Math.PI + 0.6, -0.12);
await shoot('5-meeting-room');
// Extras: the corridor, the board room, the real room from the south-west corner.
await stand(-11, 0.4, E, 0);
await shoot('6-corridor');
await stand(1.2, 2.4, -2.5, -0.1);
await shoot('7-board-room');
await stand(-11.3, -1.5, -0.6, -0.04);
await shoot('8-real-room-sw-corner');

// Walking: hold W for a while and see where the player ends up.
const walk = async (x, z, yaw, ms) => {
  await stand(x, z, yaw, 0);
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(ms);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const p = window.__office.player;
    return { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) };
  });
};
// East through the real room's east wall (x = -5.5): should stop short of it.
result.checks.walkIntoEastWall = { from: [-8.2, -4.9], to: await walk(-8.2, -4.9, E, 3500), wallAtX: -5.5, ok: 'x stays below -5.5' };
// North into the window wall (z = -9): should stop short.
result.checks.walkIntoWindowWall = { from: [-7.2, -3], to: await walk(-7.2, -3, N, 3500), wallAtZ: -9, ok: 'z stays above -9' };
// South through the wall next to the doorway (doorway is at x = -8.6): blocked.
result.checks.walkIntoWallBesideDoorway = { from: [-7.2, -2.2], to: await walk(-7.2, -2.2, S, 3000), wallAtZ: -0.9, ok: 'z stays below -0.9' };
// South through the doorway at x = -8.6, z = -0.9: should get through into the corridor.
result.checks.walkThroughDoorway = { from: [-8.6, -2.4], to: await walk(-8.6, -2.4, S, 3000), doorwayAtZ: -0.9, ok: 'z goes past -0.9' };

// An empty desk shows its vacant-seat marker, and E at it opens the hire flow.
result.checks.vacancy = await page.evaluate(() => {
  const w = window.__office.world();
  const ids = ['desk-1', 'desk-6', 'desk-7'];
  return Object.fromEntries(ids.map((id) => [id, w.desks.get(id)?.vacancy?.visible ?? 'no such desk']));
});
const seat = await page.evaluate(() => window.__office.plan().byId.get('desk-1'));
result.checks.desk1 = seat ? { x: seat.x, z: seat.z, rotY: seat.rotY } : null;
if (seat) {
  // Stand 1 m from the seat, on the side its worker would sit, looking at it.
  const sx = seat.x + Math.sin(seat.rotY) * 1.0;
  const sz = seat.z + Math.cos(seat.rotY) * 1.0;
  await stand(sx, sz, seat.rotY - Math.PI, -0.35);
  await shoot('9-vacant-desk-1');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1500);
  await shoot('9b-after-E');
  result.checks.afterE = await page.evaluate(() => ({
    dialogs: [...document.querySelectorAll('dialog[open], .modal:not(.hidden), .panel:not(.hidden)')].slice(0, 6).map((e) => (e.id || e.className) + ': ' + (e.textContent || '').trim().slice(0, 80)),
    hint: document.getElementById('hint')?.textContent?.trim().slice(0, 120) ?? null,
  }));
  await page.keyboard.press('Escape');
}

result.checks.title = await page.title();
await done(0);
