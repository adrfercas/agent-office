// Starts an agent the way a person on the agentix map would, and follows it to its terminal:
//
//   node src/client/lab/agentix-agent-flow.mjs [outDir] [baseUrl]
//
// It needs the server started with a made-up Custom --agent (a script that prints lines, tells the hook
// server it is working and sleeps), a made-up team file, and Vite in front (see agentix-team-shot.mjs).
// No real agent, login or GitHub is used. Steps: U opens the team window, Start an agent opens the hire
// window at a free desk, a worker appears at that desk and goes to Working, the team window lists it, Go to
// takes you to its desk, Terminal shows the script's output, and the windows close by Esc. Prints one line
// per check and exits 1 if one fails.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/agent-flow';
const base = process.argv[3] ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

let failed = false;
const rec = (name, ok, evidence) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
};
const finish = async () => {
  rec('no page errors', !errors.some((e) => e.startsWith('pageerror')), errors.slice(0, 8));
  await browser.close();
  process.exit(failed ? 1 : 0);
};
const shoot = async (name) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const until = (fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 1000 }).then(() => true, () => false);

await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForURL(/\/login/, { timeout: 120000 }).catch(() => {});
if (page.url().includes('/login')) {
  await page.fill('#password', 'dev');
  await page.click('#submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 120000 }).catch(() => {});
}
try {
  await page.getByRole('button', { name: /Enter the office/ }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__office?.plan?.().id === 'agentix' && window.__office.world(), null, { timeout: 120000, polling: 1000 });
  await page.waitForTimeout(3000);
} catch (e) {
  rec('loaded', false, e.message.split('\n')[0]);
  await finish();
}
rec('loaded on the agentix map', true, '');

// 1. The team window offers a way to start an agent.
await page.keyboard.press('KeyU');
await page.waitForTimeout(1200);
const start = page.locator('.tw-agents .tw-start');
rec('team window has Start an agent', (await start.count()) === 1, await ev(() => document.querySelector('.tw-agents')?.innerText.replace(/\n+/g, ' | ')));
await shoot('1-team-window-empty');

// 2. It opens the usual hire window and the team window goes away.
await start.click();
await page.waitForTimeout(1000);
const hire = await ev(() => ({ team: !!document.querySelector('.tw-people'), title: document.querySelector('.modal h2')?.textContent, button: [...document.querySelectorAll('.modal button')].map((b) => b.textContent) }));
rec('hire window opens at a free desk, team window closed', !hire.team && /Hire a worker at/.test(hire.title ?? ''), hire);
await shoot('2-hire-window');
await page.getByRole('button', { name: /Hire & start/ }).click();

// 3. The worker is there, at its desk, and working.
rec('worker appears in the store', await until(() => window.__office.store.workers.size === 1, null, 30000), '');
const w = await ev(() => {
  const [x] = [...window.__office.store.workers.values()];
  return { id: x.id, deskId: x.deskId, provider: x.provider, kind: x.kind, name: x.name, status: x.status };
});
rec('hired worker is a Custom agent at an agents desk', w.provider === 'custom' && w.kind === 'agent' && /^desk-/.test(w.deskId), w);
rec('its status goes to working', await until((id) => window.__office.store.workers.get(id)?.status === 'working', w.id, 60000), await ev((id) => window.__office.store.workers.get(id)?.status, w.id));
// It walks in from the door and sits down.
const seated = await until(
  (id) => {
    const o = window.__office;
    const v = o.workerViews.get(id);
    const d = o.plan().byId.get(v?.deskId ?? '');
    if (!v || !d) return false;
    const p = v.model.root.getWorldPosition(new v.model.root.position.constructor());
    return Math.hypot(p.x - d.x, p.z - d.z) < 0.9;
  },
  w.id,
  90000,
);
const figure = await ev((id) => {
  const o = window.__office;
  const v = o.workerViews.get(id);
  const d = o.plan().byId.get(v?.deskId ?? '');
  if (!v || !d) return null;
  const p = v.model.root.getWorldPosition(new v.model.root.position.constructor());
  return { desk: d.id, label: d.label, distance: +Math.hypot(p.x - d.x, p.z - d.z).toFixed(2), visible: v.model.root.visible };
}, w.id);
rec('a figure sits at that desk', seated && !!figure?.visible, figure);

// 4. The team window lists it as Working, with Go to and Terminal.
await page.keyboard.press('KeyU');
await page.waitForTimeout(1500);
const card = await ev(() => {
  const c = document.querySelector('.tw-agent-card');
  return c ? { text: c.innerText.replace(/\n+/g, ' | '), status: c.querySelector('.tw-status')?.textContent, buttons: [...c.querySelectorAll('button')].map((b) => b.textContent) } : null;
});
rec('team window lists it as Working with Go to and Terminal', card?.status === 'Working' && card.buttons.join() === 'Go to,Terminal', card);
await shoot('3-team-window-with-agent');

// 5. Terminal opens over the team window and shows the script's output.
await page.locator('.tw-agent-card button', { hasText: 'Terminal' }).click();
const text = async () => ev(() => document.querySelector('.term-host')?.innerText ?? '');
const gotOutput = await until(() => /fake agent line/.test(document.querySelector('.term-host')?.innerText ?? ''), null, 30000);
rec('terminal shows the script output', gotOutput, (await text()).split('\n').filter(Boolean).slice(0, 4));
await shoot('4-terminal');
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
rec('Esc closes the terminal and leaves the team window', await ev(() => !document.querySelector('.term') && !!document.querySelector('.tw-people')), '');

// 6. Go to walks you to its desk and closes the window.
const before = await ev(() => ({ x: window.__office.player.pos.x, z: window.__office.player.pos.z }));
await page.locator('.tw-agent-card button', { hasText: 'Go to' }).click();
await page.waitForTimeout(2500);
const after = await ev((deskId) => {
  const o = window.__office;
  const d = o.plan().byId.get(deskId);
  return { x: +o.player.pos.x.toFixed(2), z: +o.player.pos.z.toFixed(2), toDesk: +Math.hypot(o.player.pos.x - d.x, o.player.pos.z - d.z).toFixed(2), windows: document.querySelectorAll('#modal-root .backdrop').length };
}, w.deskId);
rec('Go to puts you at its desk and closes the windows', after.toDesk < 3.5 && after.windows === 0, { before, after });
await shoot('5-at-the-desk');

// 7. E at the desk opens the terminal as well.
await page.keyboard.press('KeyE');
rec('E at its desk opens the terminal', await until(() => !!document.querySelector('.term'), null, 15000), '');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
rec('Esc closes it, back in the room', await ev(() => !document.querySelector('.term')), '');

await finish();
