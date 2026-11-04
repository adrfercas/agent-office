// Measures what the agentix map costs to keep open, in a headless Chromium:
//
//   node src/client/lab/agentix-speed.mjs [outDir] [baseUrl] [modes]
//
// `modes` is a comma list of the Graphics settings to try ("default" leaves the saved settings alone,
// "light" and "full" save that choice first). For each one it loads the office, stands in the real room
// and at the window, and prints as JSON what the renderer says it drew (draw calls, triangles, textures,
// shadow-casting lights), what each part of the scene adds, what turning shadows off or the pixel ratio
// down saves, how many frames get drawn a second while nobody touches anything, and takes a screenshot.
//
// It needs the server and Vite running, as agentix-shot.mjs does (see its header), and a made-up team.
// Headless Chromium draws in software, so the frames per second say nothing about a real laptop: read
// the draw calls, the triangles and the frames drawn a second while idle, not the speed.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '/tmp/speed-shots';
const base = process.argv[3] ?? 'http://localhost:5173';
const modes = (process.argv[4] ?? 'default').split(',');
mkdirSync(out, { recursive: true });

const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});

const result = { modes: {}, errors: [] };
const finish = async (code) => {
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
  process.exit(code);
};

/** Runs inside the page: what the renderer drew in one whole frame, with `setup` applied around it. */
const PROBE = `(() => {
  const o = window.__office;
  const info = o.renderer.info;
  info.autoReset = false;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  window.__probe = async (hide = [], shadows = null, ratio = null) => {
    const prevRatio = o.renderer.getPixelRatio();
    const prevShadows = o.renderer.shadowMap.enabled;
    for (const h of hide) h.visible = false;
    if (shadows !== null) o.renderer.shadowMap.enabled = shadows;
    if (ratio !== null) o.renderer.setPixelRatio(ratio);
    // Two frames to settle (shaders recompiling, a throttled loop waking), then one to read.
    await nextFrame();
    await nextFrame();
    info.reset();
    const f0 = info.render.frame;
    let tries = 0;
    do {
      await nextFrame();
    } while (info.render.frame === f0 && ++tries < 200);
    const r = { calls: info.render.calls, triangles: info.render.triangles, passes: info.render.frame - f0, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 };
    // How fast software drawing manages this (relative only), with the office kept in use.
    if (!hide.length) {
      const fr0 = info.render.frame;
      const t0 = performance.now();
      const iv = setInterval(() => window.dispatchEvent(new PointerEvent('pointermove')), 200);
      await new Promise((res) => setTimeout(res, 1500));
      clearInterval(iv);
      r.softwareFps = Math.round((10 * (info.render.frame - fr0)) / r.passes / ((performance.now() - t0) / 1000)) / 10;
    }
    for (const h of hide) h.visible = true;
    o.renderer.shadowMap.enabled = prevShadows;
    o.renderer.setPixelRatio(prevRatio);
    return r;
  };
  window.__lights = () => {
    const lights = [];
    o.scene.traverse((l) => { if (l.isLight) lights.push({ type: l.type, shadow: !!l.castShadow, on: l.visible && l.intensity > 0, map: l.castShadow ? l.shadow.mapSize.x : 0 }); });
    let casters = 0, receivers = 0, meshes = 0, instanced = 0;
    o.scene.traverse((m) => {
      if (!m.isMesh) return;
      meshes++;
      if (m.isInstancedMesh) instanced++;
      if (m.castShadow) casters++;
      if (m.receiveShadow) receivers++;
    });
    const sh = lights.filter((l) => l.shadow);
    return { lights: lights.length, lightsOn: lights.filter((l) => l.on).length, shadowLights: sh.length, shadowMapSize: sh[0]?.map ?? 0, meshes, instanced, casters, receivers, ratio: o.renderer.getPixelRatio(), canvas: [o.renderer.domElement.width, o.renderer.domElement.height] };
  };
  window.__rate = (ms) => new Promise((resolve) => {
    // Frames the app drew in ms (render calls divided by the passes one frame takes), and rAF wakeups.
    const f0 = info.render.frame;
    let wake = 0;
    const count = () => { wake++; if (performance.now() < end) requestAnimationFrame(count); };
    const start = performance.now();
    const end = start + ms;
    requestAnimationFrame(count);
    setTimeout(() => resolve({ renderCalls: info.render.frame - f0, rafWakeups: wake, seconds: (performance.now() - start) / 1000 }), ms + 50);
  });
})()`;

async function measure(page, mode) {
  const breakdown = mode === 'default' || !!process.env.BREAKDOWN;
  const r = { views: {} };
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
  // A mouse nudge keeps the office "in use" so a throttled loop is at full rate for the probes.
  const poke = () => page.mouse.move(300 + Math.random() * 200, 300 + Math.random() * 100);
  const probe = async (...args) => {
    await poke();
    return page.evaluate(([a, b, c]) => window.__probe(a ? window.__office.__hide?.(a) : [], b, c), args.length ? [args[0] ?? null, args[1] ?? null, args[2] ?? null] : [null, null, null]);
  };

  await page.evaluate(PROBE);
  // Which direct children of the scene and of the building's group could be hidden to see what they cost.
  await page.evaluate(() => {
    const o = window.__office;
    const parts = {};
    const add = (label, obj) => { parts[label] = obj; };
    o.scene.children.forEach((c, i) => { if (!c.isLight) add(`scene/${c.name || c.type}#${i}`, c); });
    const w = o.world();
    w.group.children.forEach((c, i) => add(`world/${c.name || c.type}#${i}:${c.children.length}`, c));
    o.__parts = parts;
    o.__hide = (names) => names.map((n) => parts[n]);
  });
  const views = {
    room: [-8.6, -1.6, 0, -0.08],
    window: [-8.6, -7.9, 0, 0.02],
    corridor: [-9.6, 0.5, -Math.PI / 2, -0.05],
    nextDoor: [3.3, -1.5, 0, -0.05],
  };
  for (const [name, [x, z, yaw, pitch]] of Object.entries(views)) {
    await stand(x, z, yaw, pitch);
    await page.waitForTimeout(800);
    const v = {};
    v.info = await probe();
    v.scene = await page.evaluate(() => window.__lights());
    if (name === 'room' || name === 'window') {
      v.noShadows = await probe(null, false);
      v.ratio1 = await probe(null, null, 1);
      v.ratio1NoShadows = await probe(null, false, 1);
      // What each part of the scene adds: hide it and see what drops (once, on the first run).
      const names = breakdown ? await page.evaluate(() => Object.keys(window.__office.__parts)) : [];
      const parts = [];
      for (const n of names) {
        const h = await probe([n]);
        parts.push({ part: n, calls: v.info.calls - h.calls, triangles: v.info.triangles - h.triangles });
      }
      parts.sort((a, b) => b.triangles - a.triangles);
      if (parts.length) v.partsByTriangles = parts.slice(0, 6);
      if (parts.length) v.partsByCalls = [...parts].sort((a, b) => b.calls - a.calls).slice(0, 6);
    }
    await poke();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${mode}-${name}.png`, timeout: 180000 });
    r.views[name] = v;
  }

  // Idle: stand in the room, touch nothing, and count how many frames are drawn.
  await stand(...views.room);
  await page.waitForTimeout(12000);
  r.idle = await page.evaluate(() => window.__rate(6000));
  r.idle.pageFocused = await page.evaluate(() => document.hasFocus());
  r.idle.pageHidden = await page.evaluate(() => document.hidden);
  // And in use: the mouse moving about.
  const busy = page.evaluate(() => window.__rate(4000));
  for (let i = 0; i < 16; i++) {
    await poke();
    await page.waitForTimeout(250);
  }
  r.busy = await busy;
  r.passesPerFrame = r.views.room.info.passes;
  return r;
}

for (const mode of modes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => result.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && result.errors.push(`console: ${m.text().slice(0, 200)}`));
  if (mode !== 'default') {
    await page.addInitScript((graphics) => {
      try {
        if (!localStorage.getItem('agent-office.settings.lab')) {
          localStorage.setItem('agent-office.settings', JSON.stringify({ graphics }));
          localStorage.setItem('agent-office.settings.lab', '1');
        }
      } catch {}
    }, mode);
  }
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
    await page.waitForTimeout(5000);
  } catch (e) {
    result.modes[mode] = `not loaded: ${e.message.split('\n')[0]}`;
    await page.screenshot({ path: `${out}/${mode}-not-loaded.png`, timeout: 180000 }).catch(() => {});
    await page.close();
    continue;
  }
  try {
    result.modes[mode] = await measure(page, mode);
    result.modes[mode].setting = await page.evaluate(() => window.__office.settings.graphics ?? null);
  } catch (e) {
    result.modes[mode] = `failed: ${e.message.split('\n')[0]}`;
  }
  await page.close();
}
await finish(Object.values(result.modes).every((m) => typeof m === 'object') ? 0 : 1);
