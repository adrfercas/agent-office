// Screenshots the team in the agentix office, and assigns someone a desk through the team window:
//
//   node src/client/lab/agentix-team-shot.mjs [outDir] [baseUrl] [teamFile]
//
// It needs the server and Vite running, as agentix-shot.mjs does. Use a made-up team file: the shots
// show whatever is in it. It prints what it found as JSON and exits 1 if a check fails.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/team-shots';
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

await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForURL(/\/login/, { timeout: 120000 }).catch(() => {});
if (page.url().includes('/login')) {
  await page.fill('#password', 'dev');
  await page.click('#submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 120000 }).catch(() => {});
}
try {
  // A first visit gets the character picker before anything else.
  await page.getByRole('button', { name: /Enter the office/ }).click({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__office?.plan?.().id === 'agentix' && window.__office.world(), null, { timeout: 120000, polling: 1000 });
  await page.waitForTimeout(5000);
} catch (e) {
  checks.loaded = `not loaded: ${e.message.split('\n')[0]}`;
  await page.screenshot({ path: `${out}/not-loaded.png`, timeout: 180000 });
  await finish(1);
}
checks.loaded = true;

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
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
};

// Yaw 0 looks north (-z), pi/2 west, -pi/2 east, pi south.
await stand(-8.6, -1.6, 0, -0.08);
await shoot('1-real-room-seated');
await stand(-8.6, -4.5, Math.PI, 0);
await shoot('2-remote-screen');
await stand(-9.6, 0.5, -Math.PI / 2, -0.05);
await shoot('3-corridor-no-desk-yet');
await stand(6.1, 7.6, 0, -0.1);
await shoot('4-board-room-desks');

await page.keyboard.press('KeyU');
await page.waitForTimeout(1500);
checks.windowOpensOnU = await page.evaluate(() => !!document.querySelector('.tw-people'));
if (!checks.windowOpensOnU) {
  await page.mouse.move(640, 360);
  await shoot('5-window-did-not-open');
  await finish(1);
}
await shoot('5-team-window');

// Give the first person without a desk the first free desk, and see it reach the file.
const assigned = await page.evaluate(() => {
  for (const s of document.querySelectorAll('.tw-people select')) {
    if (s.value) continue;
    const free = [...s.options].find((o) => o.value && !o.disabled);
    if (!free) continue;
    s.value = free.value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return free.value;
  }
  return null;
});
checks.assignedDesk = assigned;
await page.waitForTimeout(2000);
if (teamFile) {
  const team = JSON.parse(readFileSync(teamFile, 'utf8'));
  checks.savedToFile = team.members.some((m) => m.desk === assigned);
}
await shoot('6-after-assigning');

await page.keyboard.press('Escape');
await page.waitForTimeout(800);
checks.windowClosesOnEsc = await page.evaluate(() => !document.querySelector('.tw-people'));

await finish(Object.values(checks).every(Boolean) && !errors.some((e) => e.startsWith('pageerror')) ? 0 : 1);
