// Moves people between desks in the team window with a real mouse drag, checks the file, the 3D room
// and a reload, and takes screenshots:
//
//   node src/client/lab/agentix-desks-shot.mjs <outDir> <baseUrl> <teamFile>
//
// It needs the server (--password dev) and Vite running, and a made-up team file in the server's
// folder with: ada (west), ben (middle), cy and di (no desk), eve (remote), sam (self, armoire).
// It prints what it found as JSON and exits 1 if a check fails.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/desks-shots';
const base = process.argv[3] ?? 'http://localhost:5173';
const teamFile = process.argv[4];
mkdirSync(out, { recursive: true });

const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const checks = {};
const finish = async (code) => {
  console.log(JSON.stringify({ checks, errors: errors.slice(0, 12) }, null, 1));
  await browser.close();
  process.exit(code);
};
const fileDesks = () => Object.fromEntries(JSON.parse(readFileSync(teamFile, 'utf8')).members.map((m) => [m.id, m.desk]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shoot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
};

async function enter(first) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForURL(/\/login/, { timeout: first ? 120000 : 10000 }).catch(() => {});
  if (page.url().includes('/login')) {
    await page.fill('#password', 'dev');
    await page.click('#submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 120000 }).catch(() => {});
  }
  // A first visit gets the character picker before anything else.
  await page.getByRole('button', { name: /Enter the office/ }).click({ timeout: first ? 150000 : 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__office?.plan?.().id === 'agentix' && window.__office.world(), null, { timeout: 120000, polling: 1000 });
  await page.waitForTimeout(3000);
  // An office with no floors greets you with a window that takes the keys (U would be typed into it): Esc closes it.
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }
}
try {
  await enter(true);
} catch (e) {
  checks.loaded = `not loaded: ${e.message.split('\n')[0]}`;
  await page.screenshot({ path: `${out}/not-loaded.png`, timeout: 180000 });
  await finish(1);
}
checks.loaded = true;

const DESKS = { west: [-10.9, -3.1], middle: [-10.3, -3.95], armoire: [-10.9, -6.95], window: [-6.5, -6.75], door: [-6.1, -2.55] };
/** Where the first names stand in the 3D room, by the interactables the people add. */
const figures = () =>
  page.evaluate(() =>
    Object.fromEntries(
      window.__office
        .world()
        .interactables.filter((i) => i.kind === 'person')
        .map((i) => [i.label, [i.x, i.z]]),
    ),
  );
/** Whether the figure stands at the desk: looked at for a few seconds, as a slow frame loop gets there late. */
const figureAt = async (name, desk) => {
  for (let i = 0; i < 12; i++) {
    const f = (await figures())[name];
    if (f && Math.hypot(f[0] - DESKS[desk][0], f[1] - DESKS[desk][1]) < 1.5) return true;
    await page.waitForTimeout(1000);
  }
  return false;
};
const center = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** A point of the world (metres) on the screen, through the plan's own transform. */
const worldToScreen = (x, z) =>
  page.evaluate(([x, z]) => {
    const svg = document.querySelector('.tw-plan');
    const p = new DOMPoint(x, z).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, [x, z]);
const person = (id) => `[data-person="${id}"]`;
const desk = (id) => `.tw-plan [data-desk="${id}"]`;
const tray = '.tw-tray';
/** A real mouse drag: press, wiggle, travel in steps, (shoot), let go. */
async function drag(from, to, shot) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 8, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
  if (shot) await shoot(shot);
  await page.mouse.up();
  await page.waitForTimeout(1500);
}

await page.keyboard.press('KeyU');
await page.waitForSelector('.tw-plan', { timeout: 20000 }).catch(() => {});
checks.windowOpens = await page.evaluate(() => !!document.querySelector('.tw-plan') && !!document.querySelector('.tw-tray'));
if (!checks.windowOpens) {
  await shoot('0-window-did-not-open');
  await finish(1);
}
checks.trayNamesReadable = await page.evaluate(() => [...document.querySelectorAll('.tw-tray .tw-waiter-name')].map((e) => e.textContent));
await shoot('1-window-before');
const start = fileDesks();

// A. A person from the tray onto a free desk.
await drag(await center(person('cy')), await center(desk('door')), '2-dragging-to-free-desk');
checks.A_assign = fileDesks().cy === 'door';
checks.A_figureMovedWithoutReload = await figureAt('Cy', 'door');

// B. A person with a desk onto a taken desk: a swap.
await drag(await center(person('ada')), await center(desk('middle')), '3-dragging-to-taken-desk');
checks.B_swap = fileDesks().ada === 'middle' && fileDesks().ben === 'west';
checks.B_figures = (await figureAt('Ada', 'middle')) && (await figureAt('Ben', 'west'));

// C. The tray takes a desk away; a free desk for the other one waiting.
await drag(await center(person('di')), await center(desk('window')));
checks.C_assign = fileDesks().di === 'window';
await drag(await center(person('ben')), await center(tray), '4-dragging-to-tray');
checks.C_clear = fileDesks().ben === null;
checks.C_benWaitsInTray = await page.evaluate(() => !!document.querySelector('.tw-tray [data-person="ben"]'));

// D. Let go on the floor, away from every desk: nothing changes, the marker is back.
const before = fileDesks();
await drag(await center(person('ada')), await worldToScreen(0, 0));
checks.D_floorChangesNothing = same(fileDesks(), before) && (await page.evaluate(() => !!document.querySelector('.tw-plan [data-person="ada"]')));

// E. A plain click changes nothing either.
await page.mouse.click((await center(person('ada'))).x, (await center(person('ada'))).y);
await page.waitForTimeout(600);
checks.E_clickChangesNothing = same(fileDesks(), before);

// F. The dropdown does the same as a drop: a taken desk is a swap.
await page.selectOption('.tw-person-card[data-id="di"] select', 'middle');
await page.waitForTimeout(1800);
checks.F_dropdownSwap = fileDesks().di === 'middle' && fileDesks().ada === 'window';
checks.F_figures = (await figureAt('Di', 'middle')) && (await figureAt('Ada', 'window')) && (await figureAt('Cy', 'door'));
await shoot('5-window-after');
checks.noOneSharesADesk = (() => {
  const held = Object.values(fileDesks()).filter(Boolean);
  return new Set(held).size === held.length;
})();
checks.expectedFile = same(fileDesks(), { ...start, ada: 'window', ben: null, cy: 'door', di: 'middle' });

// The 3D room, as it is now (no reload).
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const p = window.__office.player;
  if (p.seat) p.stand();
  p.pos.set(-8.6, p.pos.y, -1.6);
  p.vy = 0;
  p.camYaw = 0;
  p.lookPitch = -0.08;
});
await shoot('6-room-real-desks');
await page.evaluate(() => {
  const p = window.__office.player;
  p.pos.set(-8.4, p.pos.y, -5.2);
  p.camYaw = Math.PI / 2;
  p.lookPitch = -0.1;
});
await shoot('7-room-west-side');

// And after a reload, it is all still there.
await enter(false);
await page.keyboard.press('KeyU');
await page.waitForSelector('.tw-plan', { timeout: 20000 }).catch(() => {});
checks.afterReload_file = same(fileDesks(), { ...start, ada: 'window', ben: null, cy: 'door', di: 'middle' });
checks.afterReload_markersAtDesks = await page.evaluate(() => {
  const svg = document.querySelector('.tw-plan');
  const ppm = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
  const want = { ada: 'window', cy: 'door', di: 'middle', sam: 'armoire' };
  return Object.entries(want).every(([id, d]) => {
    const a = svg.querySelector(`[data-person="${id}"]`)?.getBoundingClientRect();
    const b = svg.querySelector(`[data-desk="${d}"]`)?.getBoundingClientRect();
    return !!a && !!b && Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2)) < 1.3 * ppm;
  });
});
checks.afterReload_benInTray = await page.evaluate(() => !!document.querySelector('.tw-tray [data-person="ben"]'));
checks.afterReload_figures = (await figureAt('Ada', 'window')) && (await figureAt('Cy', 'door')) && (await figureAt('Di', 'middle'));
await shoot('8-window-after-reload');

await finish(Object.values(checks).every((v) => v) && !errors.some((e) => e.startsWith('pageerror')) ? 0 : 1);
