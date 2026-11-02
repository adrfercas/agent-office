// Drives a REAL mouse through the agentix office and checks that the cursor is never captured:
//
//   LAB_BROWSER=chromium node src/client/lab/agentix-mouse-check.mjs [outDir]
//
// It starts the office server (port 4600, in a temp folder with the made-up team in
// agentix-mouse-team.json) and Vite (port 5190) itself, and stops exactly those two when it ends.
// It enters the office, checks nothing sits over the HUD buttons, moves the mouse, opens Settings
// from the menu, closes it with the X, drags to look around (left button turns the view, right
// button does not), hovers a person and clicks them to open their card, and asserts that
// document.pointerLockElement stayed null and requestPointerLock was never called.
// It prints what it found as JSON and exits 1 if a check fails.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/mouse-shots';
const home = process.env.AO_MOUSE_HOME ?? '/tmp/ao-mouse';
const serverPort = 4600; // the Vite proxy in vite.config.ts points here
const vitePort = Number(process.env.AO_MOUSE_VITE_PORT ?? 5190);
const base = `http://127.0.0.1:${vitePort}`;
mkdirSync(out, { recursive: true });
mkdirSync(`${home}/.agent-office`, { recursive: true });
copyFileSync(new URL('./agentix-mouse-team.json', import.meta.url), `${home}/.agent-office/team.json`);

const children = [];
const start = (cmd, args, env = {}, name = 'child') => {
  const log = openSync(`${home}/${name}.log`, 'w');
  const c = spawn(cmd, args, { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...env } });
  children.push(c);
  return c;
};
const stopAll = () => {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {}
  }
};
const until = async (url, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

const checks = {};
const errors = [];
let browser;
const finish = async (code) => {
  console.log(JSON.stringify({ checks, errors: errors.slice(0, 12) }, null, 1));
  await browser?.close().catch(() => {});
  stopAll();
  process.exit(code);
};

// The worktree may have no node_modules of its own (they sit in the main checkout above it), so Vite
// gets a throwaway config next to the team file: the repo config's root, proxy and file access, without
// its whiteboard-fonts plugin (which reads node_modules next to the config). Not committed.
const require = createRequire(import.meta.url);
const viteBin = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const cwd = process.cwd();
const allow = [cwd, resolve(cwd, '../..')];
writeFileSync(
  `${home}/vite.mouse.config.mjs`,
  `export default {
  root: ${JSON.stringify(resolve(cwd, 'src/client'))},
  publicDir: ${JSON.stringify(resolve(cwd, 'src/client/public'))},
  define: { __EXCALIDRAW_ASSETS__: '"/assets/unused/"' },
  server: {
    fs: { allow: ${JSON.stringify(allow)} },
    proxy: { '/api': { target: 'http://localhost:${serverPort}', changeOrigin: false }, '/ws': { target: 'ws://localhost:${serverPort}', ws: true } },
  },
};
`,
);
start(process.execPath, ['--import', 'tsx', 'src/server/cli.ts', '--port', String(serverPort), '--password', 'dev', '--no-open'], { AGENT_OFFICE_HOME: home }, 'server');
start(process.execPath, [viteBin, '--config', `${home}/vite.mouse.config.mjs`, '--port', String(vitePort), '--strictPort', '--host', '127.0.0.1'], {}, 'vite');
if (!(await until(`http://127.0.0.1:${serverPort}/login`, 240000)) || !(await until(`${base}/`, 240000))) {
  checks.servers = 'did not start';
  for (const n of ['server', 'vite']) checks[`${n}Log`] = readFileSync(`${home}/${n}.log`, 'utf8').split('\n').slice(-8);
  await finish(1);
}

const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
// Count every ask for the mouse and every change of it, from the first script on the page.
await page.addInitScript(() => {
  window.__lock = { asked: 0, changes: 0 };
  const ask = HTMLElement.prototype.requestPointerLock;
  HTMLElement.prototype.requestPointerLock = function (...a) {
    window.__lock.asked++;
    return ask.apply(this, a);
  };
  document.addEventListener('pointerlockchange', () => window.__lock.changes++);
});
const shot = async (name) => page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
const state = () =>
  page.evaluate(() => ({
    locked: document.pointerLockElement !== null,
    ...window.__lock,
    window: !window.__office.player.enabled,
    yaw: window.__office.player.camYaw,
    cursor: getComputedStyle(document.getElementById('scene')).cursor,
  }));

await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForURL(/\/login/, { timeout: 120000 }).catch(() => {});
if (page.url().includes('/login')) {
  await page.fill('#password', 'dev');
  await page.click('#submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 120000 }).catch(() => {});
}
try {
  await page.getByRole('button', { name: /Enter the office/ }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__office?.plan?.().id === 'agentix' && window.__office.world(), null, { timeout: 120000, polling: 1000 });
  await page.waitForFunction(() => document.querySelectorAll('#dock button').length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
} catch (e) {
  checks.loaded = `not loaded: ${e.message.split('\n')[0]}`;
  await shot('not-loaded');
  await finish(1);
}
checks.loaded = true;
checks.defaultIsFreeCursor = await page.evaluate(() => window.__office.player.mouse === 'free' && window.__office.settings.mouse === 'free');

// 1. Nothing sits over the buttons: what is at each one's middle is the button itself (or inside it).
checks.overlay = await page.evaluate(() => {
  const bad = [];
  const list = [...document.querySelectorAll('#dock button, #project, .panel-x, #chat-input')].filter((b) => b.getClientRects().length);
  for (const b of list) {
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!top || !(b === top || b.contains(top))) bad.push(`${b.id || b.className || b.tagName} is covered by ${top?.id || top?.className || top?.tagName}`);
  }
  const mid = document.elementFromPoint(640, 400);
  if (mid?.id !== 'scene') bad.push(`the middle of the screen is ${mid?.id || mid?.className || mid?.tagName}, not the scene`);
  return bad.length ? bad : { buttonsChecked: list.length, sceneOnTop: true };
});

// 2. Move the mouse about, then click through a window: menu, Settings, X.
for (let i = 0; i < 20; i++) await page.mouse.move(300 + i * 30, 300 + (i % 5) * 20);
let s = await state();
checks.afterMoving = { locked: s.locked, asked: s.asked, cursor: s.cursor };
await page.click('#dock [aria-label="Menu"]', { timeout: 10000 });
await page.getByRole('menuitem', { name: /Settings/ }).click({ timeout: 10000 });
await page.waitForTimeout(800);
s = await state();
checks.settingsOpened = s.window;
checks.mouseSettingShown = await page.evaluate(() => /Mouse in first person/.test(document.body.innerText) && /Free cursor/.test(document.body.innerText));
await shot('1-settings');
await page.click('[aria-label="Close"]', { timeout: 10000 });
await page.waitForTimeout(500);
s = await state();
checks.closedWithX = { windowClosed: !s.window, locked: s.locked, asked: s.asked };

// 3. With no extra click: a left-drag turns the view, a right-drag does not.
const yaw0 = s.yaw;
await page.mouse.move(640, 500);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 12, 500);
await page.mouse.up();
await page.waitForTimeout(200);
const yaw1 = (await state()).yaw;
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 10; i++) await page.mouse.move(760 - i * 12, 500);
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(200);
s = await state();
checks.leftDragLooks = yaw1 !== yaw0;
checks.rightDragDoesNotLook = s.yaw === yaw1;
checks.dragOpenedNothing = !s.window;

// 4. A person: find them on screen from a few spots, hover (pointing hand), click (their card opens).
const candidates = await page.evaluate(() => {
  const o = window.__office;
  const spots = [[-8.6, -3.5], [-6.6, -4.6], [-9.2, -6.4], [-7.5, -1.8], [5.5, 7.6], [8.5, 7.6]];
  const people = [];
  o.scene.traverse((ob) => ob.userData?.interact?.kind === 'person' && people.push(ob));
  const list = [];
  for (const [x, z] of spots) {
    for (const ob of people) {
      const w = ob.getWorldPosition(o.camera.position.clone());
      const dx = w.x - x;
      const dz = w.z - z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) continue;
      list.push({ x, z, yaw: Math.atan2(-dx, -dz), ox: w.x, oy: w.y, oz: w.z, d });
    }
  }
  return { count: people.length, list: list.sort((a, b) => b.d - a.d).slice(0, 14) };
});
checks.peopleInRoom = candidates.count > 0 ? candidates.count : false;
let opened = null;
for (const c of candidates.list) {
  await page.evaluate((c) => {
    const p = window.__office.player;
    if (p.seat) p.stand();
    p.pos.set(c.x, p.pos.y, c.z);
    p.vy = 0;
    p.camYaw = c.yaw;
    p.lookPitch = 0;
  }, c);
  await page.waitForTimeout(500);
  for (const dy of [1.1, 0.7, 1.4, 0.3]) {
    const pt = await page.evaluate(
      ([c, dy]) => {
        const cam = window.__office.camera;
        cam.updateMatrixWorld();
        const v = cam.position.clone().set(c.ox, c.oy + dy, c.oz).project(cam);
        if (v.z > 1 || Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.9) return null;
        return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
      },
      [c, dy],
    );
    if (!pt) continue;
    await page.mouse.move(pt.x - 6, pt.y - 6);
    await page.mouse.move(pt.x, pt.y, { steps: 3 });
    await page.waitForTimeout(350);
    const hover = (await state()).cursor;
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
    s = await state();
    if (s.window) {
      opened = { distance: Math.round(c.d * 10) / 10, hoverCursor: hover, from: [c.x, c.z] };
      await shot('2-person-card');
      break;
    }
  }
  if (opened) break;
}
checks.personClickOpensCard = opened ?? false;
if (opened) {
  await page.click('[aria-label="Close"]', { timeout: 10000 }).catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(500);
  s = await state();
  checks.cardClosedWithX = { windowClosed: !s.window, locked: s.locked };
} else await shot('2-no-person-opened');

s = await state();
checks.neverCaptured = s.locked === false && s.asked === 0 && s.changes === 0;
const failed = Object.values(checks).some((v) => v === false || typeof v === 'string') || Array.isArray(checks.overlay) || errors.some((e) => e.startsWith('pageerror'));
await finish(failed ? 1 : 0);
