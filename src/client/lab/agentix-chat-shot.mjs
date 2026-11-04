// Checks the Talk button in the agentix office's team window, with no Google involved:
//
//   node src/client/lab/agentix-chat-shot.mjs [outDir] [baseUrl] [teamFile]
//
// It needs the server and Vite running (see agentix-team-shot.mjs) on a made-up team file given as
// `teamFile`: Ada has a chat link, Ben has none, and Zed is `self`. It opens the team window, clicks
// Talk and reads the URL the new page asked for (every request to Google is answered with an empty
// page, so nothing leaves the machine), tries bad links and a good one in the paste box, and prints the
// results as JSON. It exits 1 if a check fails.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/chat-shots';
const base = process.argv[3] ?? 'http://localhost:5173';
const teamFile = process.argv[4];
mkdirSync(out, { recursive: true });

const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const requested = [];
await context.route(/(^|\.)google\.com/, (route) => {
  requested.push(route.request().url());
  return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const checks = {};
const finish = async (code) => {
  console.log(JSON.stringify({ checks, requested, errors: errors.slice(0, 12) }, null, 1));
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
  await page.getByRole('button', { name: /Enter the office/ }).click({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__office?.plan?.().id === 'agentix' && window.__office.world(), null, { timeout: 120000, polling: 1000 });
  await page.waitForTimeout(3000);
} catch (e) {
  checks.loaded = `not loaded: ${e.message.split('\n')[0]}`;
  await finish(1);
}
checks.loaded = true;

try {
  await page.keyboard.press('KeyU');
  await page.waitForSelector('.tw-people .tw-person-card', { timeout: 20000 }).catch(() => {});
  const card = (name) => page.locator('.tw-person-card', { has: page.locator('strong', { hasText: name }) });
  const ada = card('Ada Example');
  const ben = card('Ben Example');
  const you = card('Zed Example');

  // Who gets what.
  checks.selfHasNoTalk = (await you.locator('.tw-talk').count()) === 0;
  checks.adaHasTalkLink = (await ada.locator('a.tw-talk-btn').count()) === 1;
  checks.benAsksForLink = (await ben.locator('a.tw-talk-btn').count()) === 0 && (await ben.locator('.tw-talk-paste input').count()) === 1;
  checks.helpLineShown = /copy the address/.test((await ben.locator('.tw-talk-help').textContent({ timeout: 5000 })) ?? '');
  const expected = await ada.locator('a.tw-talk-btn').getAttribute('href');
  checks.adaHref = expected;
  checks.adaRelNoopener = /noopener/.test((await ada.locator('a.tw-talk-btn').getAttribute('rel')) ?? '');
  await page.screenshot({ path: `${out}/1-team-window.png`, timeout: 180000 });

  // Talk opens the link in a new page, which cannot reach back into the office.
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), ada.locator('a.tw-talk-btn').click()]);
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  checks.popupUrl = popup.url();
  checks.popupIsTheLink = popup.url() === expected;
  checks.popupHasNoOpener = (await popup.evaluate(() => window.opener === null)) === true;
  await popup.close();
  await page.bringToFront();
  checks.noHeldKeysAfterReturn = (await page.evaluate(() => window.__office.player.keys.size)) === 0;
  checks.windowStillOpen = (await page.locator('.tw-people').count()) === 1;

  // Bad links in the paste box: said in place, nothing saved.
  const before = teamFile ? readFileSync(teamFile, 'utf8') : '';
  const box = ben.locator('.tw-talk-paste input');
  for (const bad of ['javascript:alert(1)', 'https://evil.example/chat.google.com', 'http://chat.google.com/dm/X']) {
    await box.fill(bad);
    await ben.locator('.tw-talk-paste .btn').click();
  }
  checks.badLinkSaid = ((await ben.locator('.tw-talk-problem').textContent()) ?? '').length > 0;
  await page.waitForTimeout(1500);
  if (teamFile) checks.badLinkNotSaved = readFileSync(teamFile, 'utf8') === before;
  checks.benStillAsks = (await ben.locator('a.tw-talk-btn').count()) === 0;
  await page.screenshot({ path: `${out}/2-bad-link.png`, timeout: 180000 });

  // A good one: saved to the file, and the card turns into a Talk button.
  const good = 'https://chat.google.com/dm/EXAMPLE-BEN';
  await box.fill(good);
  await ben.locator('.tw-talk-paste .btn').click();
  await ben.locator('a.tw-talk-btn').waitFor({ timeout: 15000 }).catch(() => {});
  checks.benTalkAppears = (await ben.locator('a.tw-talk-btn').getAttribute('href').catch(() => null)) === good;
  if (teamFile) checks.goodLinkSavedToFile = JSON.parse(readFileSync(teamFile, 'utf8')).members.some((m) => m.id === 'ben' && m.chat === good);
  await page.screenshot({ path: `${out}/3-link-saved.png`, timeout: 180000 });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  checks.windowClosesOnEsc = await page.evaluate(() => !document.querySelector('.tw-people'));

} catch (e) {
  checks.error = e.message.split('\n')[0];
  checks.windowText = await page.evaluate(() => document.querySelector('.modal')?.textContent?.slice(0, 400) ?? null).catch(() => null);
  await page.screenshot({ path: `${out}/error.png`, timeout: 60000 }).catch(() => {});
}

await finish(Object.values(checks).every((v) => v !== false) && !checks.error && !errors.length ? 0 : 1);
