// Checks zooming and two-finger navigation in a real browser, against an office that's already running:
//
//   node src/client/lab/agentix-navigation-check.mjs [address] [outDir]
//
// The address defaults to http://127.0.0.1:5173 (the password is `dev`). It starts and stops nothing but
// its own headless browser, and it enters the office as one more visitor while it runs. The wheel events
// are made in the page with the fields a touchpad or mouse sends, since a headless browser has neither.
// It prints what it found as JSON and exits 1 if a check fails.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = process.argv[3] ?? '/tmp/navigation-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForURL(/\/login/, { timeout: 60000 }).catch(() => {});
if (page.url().includes('/login')) {
  await page.fill('#password', 'dev');
  await page.click('#submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 120000 }).catch(() => {});
}
await page.getByRole('button', { name: /Enter the office/ }).click({ timeout: 180000 });
await page.waitForFunction(() => window.__office?.world?.(), null, { timeout: 180000, polling: 1000 });
await page.waitForTimeout(6000);
// An office with no floors greets you with a window that takes the keys and the wheel.
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);

/** Sends the canvas one wheel event, with the older wheelDeltaY field a real one has. */
const send = (some) =>
  page.evaluate((some) => {
    const { wheelDeltaY, ...init } = some;
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    if (wheelDeltaY !== undefined) Object.defineProperty(e, 'wheelDeltaY', { value: wheelDeltaY });
    document.getElementById('scene').dispatchEvent(e);
    return e.defaultPrevented;
  }, some);
const look = () =>
  page.evaluate(() => {
    const { player, camera } = window.__office;
    return { yaw: player.camYaw, pitch: player.lookPitch, dist: player.camDist, fov: camera.fov, scale: player.lookScale };
  });
/** Waits for this many frames to be drawn. Counted, not timed: without a graphics card a frame can take seconds. */
const frames = (n) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        const next = () => (n-- > 0 ? requestAnimationFrame(next) : done());
        next();
      }),
    n,
  );
/** Waits for the view to ease to where it's going, which takes it about a dozen frames at this speed. */
const settled = async () => {
  await frames(14);
  return look();
};
const notch = (dir) => ({ deltaY: dir * 100, wheelDeltaY: dir * -120 });
const gap = () => page.waitForTimeout(300);

const checks = {};
await page.evaluate(() => window.__office.player.setView('first'));
const start = await look();
checks.startsAtTheUsualView = Math.abs(start.fov - 55) < 0.2;

// Two fingers turn the view, sideways and up and down, and don't zoom.
checks.leavesBrowserAlone = await send({ deltaX: 20, deltaY: 0 });
let now = await look();
checks.twoFingersTurn = now.yaw < start.yaw;
await send({ deltaX: 0, deltaY: 7, wheelDeltaY: -21 });
const down = await look();
checks.twoFingersLook = down.pitch < now.pitch;
checks.twoFingersDoNotZoom = Math.abs(down.fov - start.fov) < 0.2;
await page.waitForTimeout(400);

// A mouse wheel zooms, without turning.
const before = await look();
for (let i = 0; i < 3; i++) {
  await send(notch(-1));
  await gap();
}
const notched = await settled();
checks.wheelZoomsIn = notched.fov < before.fov - 3;
checks.wheelDoesNotTurn = notched.yaw === before.yaw && notched.pitch === before.pitch;
await page.screenshot({ path: `${out}/1-zoomed-in.png`, timeout: 180000 });

// A pinch zooms too, all the way in as far as it goes.
for (let i = 0; i < 12; i++) await send({ deltaY: -30, ctrlKey: true });
const pinched = await settled();
checks.pinchZooms = pinched.fov < notched.fov;
checks.zoomInStops = pinched.fov > 55 / 3 - 0.5;
checks.turnsSlowerZoomedIn = pinched.scale < 0.5;

// All the way back out, past the usual view.
for (let i = 0; i < 30; i++) await send({ deltaY: 30, ctrlKey: true });
const wide = await settled();
checks.zoomOutStops = Math.abs(wide.fov - 55 * 1.45) < 1;
await page.screenshot({ path: `${out}/2-zoomed-out.png`, timeout: 180000 });

// The look speed setting scales two fingers.
for (let i = 0; i < 30; i++) await send({ deltaY: -30, ctrlKey: true });
for (let i = 0; i < 9; i++) await send({ deltaY: 30, ctrlKey: true });
await settled();
await page.waitForTimeout(400);
const turnBy = async () => {
  const a = await look();
  await send({ deltaX: 20, deltaY: 0 });
  return a.yaw - (await look()).yaw;
};
await page.evaluate(() => (window.__office.settings.lookSpeed = 1));
await frames(2);
const usual = await turnBy();
await page.evaluate(() => (window.__office.settings.lookSpeed = 2));
await frames(2);
const doubled = await turnBy();
await page.evaluate(() => (window.__office.settings.lookSpeed = 1));
checks.lookSpeedScales = Math.abs(doubled / usual - 2) < 0.1;

// Third person: the wheel moves the camera, and two fingers orbit it.
await page.evaluate(() => window.__office.player.setView('third'));
await page.waitForTimeout(1500);
const orbit = await look();
await send(notch(-1));
await gap();
const closer = await look();
checks.thirdPersonWheelMovesCamera = closer.dist < orbit.dist;
await page.waitForTimeout(400);
await send({ deltaX: 20, deltaY: 0 });
checks.thirdPersonFingersOrbit = (await look()).yaw !== closer.yaw;

// With a window open, none of it.
await page.evaluate(() => window.__office.player.setView('first'));
await page.waitForTimeout(1000);
await page.evaluate(() => (window.__office.player.enabled = false));
const shut = await look();
await send({ deltaX: 20, deltaY: 0 });
checks.nothingWithAWindowOpen = (await look()).yaw === shut.yaw;
await page.evaluate(() => (window.__office.player.enabled = true));

checks.noPageErrors = errors.length === 0;
const failed = Object.values(checks).some((v) => v !== true);
console.log(JSON.stringify({ checks, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
process.exit(failed ? 1 : 0);
