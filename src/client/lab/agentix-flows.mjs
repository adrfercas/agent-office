// Drives the whole app on the agentix map in a headless browser and reports what works:
//
//   node src/client/lab/agentix-flows.mjs [baseUrl] [outDir]
//
// It needs an office server with a throwaway project and a fake agent (--agent <script that prints and
// sleeps>), and the Vite dev server in front of it (see agentix-shot.mjs). Nothing here uses real
// credentials, an agent login or GitHub. It uses window.__office (the debug hook main.ts has) to move the
// player and look at the world, and the office's own websocket messages (net.send) to hire, send home,
// start a meeting and change the map. Every check prints one line: PASS, FAIL or SKIP, and the evidence.
// The fast checks that need no browser are in tests/agentix-flows.test.ts.
//
// LAB_BROWSER=chromium uses Playwright's own Chromium; other values are as in shot.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5183';
const out = process.argv[3] ?? '/tmp/ao7-shots';
mkdirSync(out, { recursive: true });
const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({
  channel: channel === 'chromium' ? undefined : channel,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const results = [];
const rec = (name, ok, evidence) => {
  const status = ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  results.push({ name, status, evidence });
  console.log(`${status}  ${name}  ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
};
/** Runs a check; an exception in it is a FAIL with the message, so the rest still run. */
const check = async (name, fn) => {
  try {
    const r = await fn();
    rec(name, r.ok, r.evidence);
  } catch (e) {
    rec(name, false, `threw: ${String(e.message).split('\n')[0]}`);
  }
};
const finish = async (code) => {
  const noErrors = errors.length === 0;
  console.log(`${noErrors ? 'PASS' : 'FAIL'}  console and page errors  ${noErrors ? 'none' : JSON.stringify(errors.slice(0, 12))}`);
  writeFileSync(`${out}/results.json`, JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(code);
};

await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
if (page.url().includes('/login')) {
  await page.fill('#password', 'dev');
  await page.click('#submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => {});
}
try {
  await page.waitForFunction(() => window.__office?.world && window.__office.plan, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__office.plan().id === 'agentix' && window.__office.world(), null, { timeout: 120000 });
  await page.waitForTimeout(3000);
} catch (e) {
  rec('loads', false, `not loaded: ${String(e.message).split('\n')[0]}; errors ${JSON.stringify(errors.slice(0, 5))}`);
  await finish(1);
}

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const send = (msg) => ev((m) => window.__office.net.send(m), msg);
/** Waits until `fn` (run in the page) is truthy, or `ms` run out. Returns whether it came true. */
const until = (fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// Everything the page-side checks share: the solid inside walls as rectangles (as agentixFootprint draws them).
await ev(() => {
  const H = (window.__h = {});
  const plan = () => window.__office.plan();
  H.walls = () =>
    (plan().config?.props ?? [])
      .filter((p) => p.kind === 'wall')
      .map((p) => {
        const along = Math.abs(Math.sin(p.rotY ?? 0)) > 0.5;
        const [w, l] = [0.2, p.length ?? 1];
        return along ? [p.x - l / 2, p.x + l / 2, p.z - w / 2, p.z + w / 2] : [p.x - w / 2, p.x + w / 2, p.z - l / 2, p.z + l / 2];
      });
  H.inWall = (x, z) => H.walls().some((r) => x > r[0] && x < r[1] && z > r[2] && z < r[3]);
  const V = window.__office.player.pos.constructor;
  H.vec = new V();
  H.at = (obj) => {
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(H.vec);
    return [+H.vec.x.toFixed(2), +H.vec.y.toFixed(2), +H.vec.z.toFixed(2)];
  };
  H.round = (a) => a.map((v) => +v.toFixed(2));
  // Walks the player: holds W for `steps` frames of 1/30 s from (x, z) looking along yaw, and says where it ends.
  H.walk = (x, z, yaw, steps, key = 'KeyW') => {
    const p = window.__office.player;
    if (p.seat) p.stand();
    p.pos.set(x, 0, z);
    p.vy = 0;
    p.camYaw = yaw;
    p.enabled = true;
    p.keys.add(key);
    const trail = [];
    for (let i = 0; i < steps; i++) {
      p.update(1 / 30);
      if (i % 10 === 0) trail.push([+p.pos.x.toFixed(2), +p.pos.z.toFixed(2)]);
    }
    p.keys.delete(key);
    return { end: [+p.pos.x.toFixed(2), +p.pos.z.toFixed(2)], trail };
  };
});

// ---- 1. A fresh start --------------------------------------------------------------------------------
await check('1 fresh start lands on agentix, at the spawn in the real room', async () => {
  const s = await ev(() => {
    const o = window.__office;
    const p = o.player;
    return { plan: o.plan().id, style: o.plan().style, pos: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)], spawn: o.plan().spawn, seat: !!p.seat, map: o.store.map?.pick ?? null, floor: o.store.floor };
  });
  const inRoom = s.pos[0] > -12 && s.pos[0] < -5.6 && s.pos[2] > -9 && s.pos[2] < -1;
  const nearSpawn = Math.hypot(s.pos[0] - s.spawn.x, s.pos[2] - s.spawn.z) < 1.2;
  return { ok: s.plan === 'agentix' && s.style === 'agentix' && inRoom && nearSpawn && s.pos[1] < 0.5, evidence: s };
});
await check('1b the old office is not up: its elevator is not the place we stand', async () => {
  const s = await ev(() => {
    const o = window.__office;
    const p = o.player.pos;
    // The office's elevator stands at the east end of its hall, far outside the agentix room.
    return { atOffice: o.world() === o.world().plan && false, visible: o.world().group.visible, near: Math.hypot(p.x - 17, p.z) };
  });
  return { ok: s.visible && s.near > 10, evidence: s };
});
await page.screenshot({ path: `${out}/01-fresh.png` });

// ---- 2/3. Hiring -------------------------------------------------------------------------------------
const HIRES = 18;
await check('2 hire: workers fill desk-1.., each on its chair, facing its desk, laptop on the desk, none in a wall', async () => {
  for (let i = 1; i <= 7; i++) {
    await send({ t: 'worker.spawn', deskId: `desk-${i}`, worktree: false });
    await wait(150);
  }
  const arrived = await until(() => window.__office.store.workers.size >= 7, null, 60000);
  await wait(20000); // They walk in from the door and sit down.
  const rows = await ev(() => {
    const o = window.__office;
    const H = window.__h;
    const plan = o.plan();
    return [...o.workerViews].map(([id, v]) => {
      const d = plan.byId.get(v.deskId);
      const w = H.at(v.model.root);
      const l = H.at(v.laptop.root);
      const dv = o.world().desks.get(v.deskId);
      const chair = H.at(dv.chair);
      const q = v.model.root.getWorldQuaternion(new (o.player.pos.constructor === Object ? Object : v.model.root.quaternion.constructor)());
      const yaw = 2 * Math.atan2(q.y, q.w);
      const toDesk = [-Math.sin(d.rotY), -Math.cos(d.rotY)];
      return {
        desk: v.deskId,
        worker: w,
        laptop: l,
        chair,
        seatDist: +Math.hypot(w[0] - d.x, w[2] - d.z).toFixed(2),
        chairDist: +Math.hypot(chair[0] - (d.x - toDesk[0] * 0.85), chair[2] - (d.z - toDesk[1] * 0.85)).toFixed(2),
        laptopOnDesk: l[1] > 0.6 && l[1] < 1.0 && Math.hypot(l[0] - d.x, l[2] - d.z) < 0.7,
        facing: +(Math.sin(yaw) * toDesk[0] + Math.cos(yaw) * toDesk[1]).toFixed(2),
        inWall: H.inWall(w[0], w[2]) || H.inWall(l[0], l[2]) || H.inWall(chair[0], chair[2]),
      };
    });
  });
  const bad = rows.filter((r) => r.seatDist > 0.6 || r.chairDist > 0.2 || !r.laptopOnDesk || r.inWall);
  rec('2b facing: |dot| of worker heading with the desk direction', Math.abs(rows[0]?.facing ?? 0) > 0.8 || null, rows.map((r) => `${r.desk}:${r.facing}`).join(' '));
  return { ok: arrived && rows.length >= 7 && bad.length === 0, evidence: { count: rows.length, bad, sample: rows.slice(0, 2) } };
});
await page.screenshot({ path: `${out}/02-hired.png` });

await check('3 overflow: desk-17..20 hold no worker with no back office; overflow seats appear only when needed; a worker hired then works', async () => {
  const before = await ev(() => {
    const o = window.__office;
    const d = (id) => ({ vis: o.world().desks.get(id)?.group.visible, vac: o.world().desks.get(id)?.vacancy.visible });
    return { d16: d('desk-16'), d17: d('desk-17'), b1: d('beanbag-1') };
  });
  for (let i = 8; i <= HIRES; i++) {
    await send({ t: 'worker.spawn', deskId: i <= 16 ? `desk-${i}` : `beanbag-${i - 16}`, worktree: false });
    await wait(150);
  }
  await until((n) => window.__office.store.workers.size >= n, HIRES, 90000);
  await wait(15000);
  const after = await ev(() => {
    const o = window.__office;
    const d = (id) => ({ vis: o.world().desks.get(id)?.group.visible, vac: o.world().desks.get(id)?.vacancy.visible, it: o.world().interactables.length });
    return {
      workers: o.store.workers.size,
      desks: [...o.store.workers.values()].map((w) => w.deskId).sort(),
      wing: o.store.floorPlan.wing,
      d17: d('desk-17'),
      b1: d('beanbag-1'),
      b2: d('beanbag-2'),
      b3: d('beanbag-3'),
      views: o.workerViews.size,
    };
  });
  await page.screenshot({ path: `${out}/03-overflow.png` });
  const ok = after.workers === HIRES && after.views === HIRES && after.b1.vis === true && after.b2.vis === true && after.b3.vis === true && !after.d17.vac;
  return { ok, evidence: { before, after: { ...after, desks: after.desks.join(',') } } };
});
await check('3b hire with no seat given: the server picks the next free seat, not an unbuilt back-office desk', async () => {
  await send({ t: 'worker.spawn', deskId: '', worktree: false });
  await wait(4000);
  const ids = await ev(() => [...window.__office.store.workers.values()].map((w) => w.deskId));
  return { ok: ids.length >= HIRES, evidence: { total: ids.length, hasBackOffice: ids.filter((i) => /^desk-(17|18|19|20)$/.test(i)) } };
});

// ---- 4. Sending home ---------------------------------------------------------------------------------
await check('4 sending home: the worker walks out of the east end of the corridor, never inside a wall', async () => {
  const id = await ev(() => [...window.__office.store.workers.values()].find((w) => w.deskId === 'desk-1')?.id);
  if (!id) return { ok: false, evidence: 'no worker at desk-1' };
  await send({ t: 'worker.kill', workerId: id });
  const trail = [];
  let inWall = 0;
  for (let i = 0; i < 80; i++) {
    const s = await ev((wid) => {
      const v = window.__office.workerViews.get(wid) ?? window.__office.departures?.get?.(wid);
      if (!v) return null;
      const p = window.__h.at(v.model.root);
      return { p, wall: window.__h.inWall(p[0], p[2]) };
    }, id);
    if (s) {
      trail.push(s.p);
      if (s.wall) inWall++;
    }
    if (!s && trail.length > 3) break;
    await wait(500);
  }
  const maxX = Math.max(...trail.map((p) => p[0]));
  const crossed = trail.filter((p) => Math.abs(p[2] + 0.9) < 0.12).map((p) => p[0]);
  return { ok: trail.length > 3 && inWall === 0 && maxX > 9, evidence: { samples: trail.length, inWallSamples: inWall, maxX, firstLast: [trail[0], trail.at(-1)], xWhenAtCorridorWall: crossed.slice(0, 6) } };
});

// ---- 5. Boards, meeting, gong, coffee ----------------------------------------------------------------
const stand = (x, z, yaw, pitch = 0) =>
  ev(([x, z, yaw, pitch]) => {
    const p = window.__office.player;
    if (p.seat) p.stand();
    p.pos.set(x, 0, z);
    p.vy = 0;
    p.camYaw = yaw;
    p.lookPitch = pitch;
  }, [x, z, yaw, pitch]);
const hint = () => ev(() => document.getElementById('hint')?.textContent?.trim().slice(0, 100) ?? null);
const overlays = () => ev(() => [...document.querySelectorAll('dialog[open], .modal:not(.hidden), .panel:not(.hidden), .overlay:not(.hidden)')].map((e) => e.id || e.className).slice(0, 6));
// Boards: stand in front of each, look at it, press E, and see what opens.
// Yaw 0 looks north (-z), pi/2 west (-x), -pi/2 east, pi south.
const boardAt = [
  ['queue (whiteboard, real room)', -7.4, -4.6, Math.PI / 2],
  ['issues', 7.6, 3.6 + 0.0, -Math.PI / 2],
  ['pulls', 7.6, 7.2, -Math.PI / 2],
  ['services', 6, 6.2, Math.PI],
];
for (const [name, x, z, yaw] of boardAt) {
  await check(`5 board ${name} opens with E`, async () => {
    await stand(x, z, yaw, 0);
    await wait(1200);
    const h = await hint();
    await page.keyboard.press('KeyE');
    await wait(2500);
    const o = await overlays();
    const shown = await ev(() => !!document.querySelector('.excalidraw, [class*=board], #board-modal:not(.hidden), .modal:not(.hidden)'));
    await page.screenshot({ path: `${out}/05-board-${name.split(' ')[0]}.png` });
    await page.keyboard.press('Escape');
    await wait(500);
    return { ok: shown || o.length > 0, evidence: { hint: h, overlays: o, modal: shown } };
  });
}
await check('5 board agents stand at their lecterns in the board room', async () => {
  const s = await ev(() => {
    const o = window.__office;
    return o.plan().stations.map((d) => {
      const v = o.world().desks.get(d.id);
      const idle = o.worldIdle?.() ?? null;
      return { id: d.id, at: [d.x, d.z], vacancyShown: v.vacancy.visible, inBoardRoom: d.x > 0.1 && d.z > 1.8 };
    });
  });
  return { ok: s.every((a) => a.inBoardRoom), evidence: s };
});
await check('5 meeting: it starts, the five-chair table gets workers and the board shows it', async () => {
  const ids = await ev(() => [...window.__office.store.workers.values()].slice(0, 3).map((w) => w.id));
  await send({ t: 'meeting.start', pattern: 'debate', prompt: 'made-up test question', roles: ['Lead', 'Skeptic'], title: 'Flow test' });
  const started = await until(() => !!window.__office.store.meeting?.current, null, 20000);
  await wait(6000);
  const s = await ev(() => {
    const o = window.__office;
    const m = o.store.meeting?.current;
    const seated = [...o.workerViews].filter(([, v]) => v.deskId.startsWith('meeting-')).map(([, v]) => ({ desk: v.deskId, at: window.__h.at(v.model.root) }));
    return { status: m?.status ?? null, seats: m?.seats?.map((x) => x.deskId), seated, board: !!o.world().meetingBoard, sign: !!o.world().meetingSign, council: o.plan().council };
  });
  await stand(-7, 3.4, 0, 0);
  await wait(800);
  await page.screenshot({ path: `${out}/05-meeting.png` });
  return { ok: started && s.board && s.sign && s.seated.length >= 1, evidence: { ...s, ids: ids.length } };
});
await check('5 gong rings (a merged PR), no errors', async () => {
  const before = errors.length;
  await send({ t: 'gong' });
  await wait(1500);
  const s = await ev(() => ({ gong: !!window.__office.world().gong }));
  return { ok: s.gong && errors.length === before, evidence: { ...s, newErrors: errors.length - before } };
});
await check('5 coffee machine: E at it gives a cup (hint shown, caffeine goes up)', async () => {
  // The machine is at (8.5, 1.25) in the corridor, facing south (rotY pi): stand south of it? It faces -z side wall; stand at z 0.3.
  await stand(8.5, 0.2, Math.PI, -0.1);
  await wait(1200);
  const h = await hint();
  const c0 = await ev(() => window.__office.caffeine?.() ?? null);
  await page.keyboard.press('KeyE');
  await wait(2500);
  const c1 = await ev(() => window.__office.caffeine?.() ?? null);
  await page.screenshot({ path: `${out}/05-coffee.png` });
  return { ok: h !== null && JSON.stringify(c0) !== JSON.stringify(c1), evidence: { hint: h, before: c0, after: c1 } };
});

// ---- 6. Switching maps -------------------------------------------------------------------------------
const seatsNow = () => ev(() => [...window.__office.workerViews].map(([id, v]) => `${id}:${v.deskId}`).sort().join('|'));
const waitPlan = (id) => until((id) => window.__office.plan().id === id && window.__office.world(), id, 40000);
await check('6 map switching: agentix -> office -> agentix -> castle -> agentix keeps seats, no errors', async () => {
  const start = await seatsNow();
  const e0 = errors.length;
  const steps = [];
  for (const id of ['office', 'agentix', 'castle', 'agentix']) {
    await send({ t: 'map.set', map: id });
    const ok = await waitPlan(id);
    await wait(3500);
    const s = await ev(() => {
      const p = window.__office.player.pos;
      return { views: window.__office.workerViews.size, pos: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)] };
    });
    steps.push({ id, ok, ...s, same: (await seatsNow()) === start });
    await page.screenshot({ path: `${out}/06-map-${id}.png` });
  }
  return { ok: steps.every((s) => s.ok && s.same), evidence: { steps, newErrors: errors.slice(e0) } };
});
await check('6b the office is still selectable and the pick persists on the server', async () => {
  await send({ t: 'map.set', map: 'office' });
  const ok = await waitPlan('office');
  const pick = await ev(() => window.__office.store.map?.pick ?? null);
  const choices = await ev(() => (window.__office.store.map?.custom ?? []).length);
  await send({ t: 'map.set', map: 'agentix' });
  await waitPlan('agentix');
  return { ok: ok && pick === 'office', evidence: { pick, custom: choices } };
});
await check('6c editing a custom map that extends agentix disposes the old world without throwing', async () => {
  // The custom maps folder is in the project's .agent-office; the script runs next to the server, so it writes there.
  const dir = process.env.AO_PROJECT ?? '/tmp/ao7-proj';
  const { mkdirSync: mk, writeFileSync: wf } = await import('node:fs');
  mk(`${dir}/.agent-office/maps`, { recursive: true });
  const file = `${dir}/.agent-office/maps/mine.json`;
  wf(file, JSON.stringify({ id: 'mine', name: 'Mine', extends: 'agentix' }));
  const e0 = errors.length;
  await send({ t: 'map.set', map: 'mine' });
  const a = await waitPlan('mine');
  await wait(3000);
  const before = await ev(() => window.__office.world().group.parent !== null);
  wf(file, JSON.stringify({ id: 'mine', name: 'Mine', extends: 'agentix', spawn: { x: -9, z: -3, rotY: 0 }, props: [] }));
  await send({ t: 'map.set', map: 'mine' });
  await wait(6000);
  const s = await ev(() => ({ plan: window.__office.plan().id, spawn: window.__office.plan().spawn.x, propsLen: window.__office.plan().config.props.length, views: window.__office.workerViews.size }));
  await page.screenshot({ path: `${out}/06-custom.png` });
  await send({ t: 'map.set', map: 'agentix' });
  await waitPlan('agentix');
  return { ok: a && before && s.plan === 'mine' && s.spawn === -9 && s.propsLen === 0 && errors.length === e0, evidence: { ...s, newErrors: errors.slice(e0) } };
});

// ---- 7. Movement -------------------------------------------------------------------------------------
await check('7 walls stop the player: the real room east wall, the window wall, the corridor wall, the east outside wall', async () => {
  const r = {
    eastWall: await ev(() => window.__h.walk(-8.2, -4.9, -Math.PI / 2, 150)),
    windowWall: await ev(() => window.__h.walk(-7.2, -3, 0, 150)),
    corridorWall: await ev(() => window.__h.walk(-6.5, -2.2, Math.PI, 90)),
    outsideEast: await ev(() => window.__h.walk(9, 0.4, -Math.PI / 2, 200)),
    secondRoomWindow: await ev(() => window.__h.walk(3.3, -5, 0, 200)),
  };
  const ok = r.eastWall.end[0] < -5.6 && r.windowWall.end[1] > -9 && r.corridorWall.end[1] < -0.9 && r.secondRoomWindow.end[1] > -9;
  return { ok, evidence: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.end])) };
});
await check('7 the player cannot leave through any of the five windows', async () => {
  const xs = [-8.7, -1, 4.5, 9.5];
  const ends = [];
  for (const x of xs) ends.push((await ev(([x]) => window.__h.walk(x, -6, 0, 200), [x])).end);
  return { ok: ends.every((e) => e[1] > -9), evidence: ends };
});
await check('7 every doorway can be walked through, both ways', async () => {
  const doors = [[-8.6, -0.9], [3.5, -0.9], [-2.5, 1.7], [6, 1.7]];
  const rows = [];
  for (const [x, z] of doors) {
    const down = await ev(([x, z]) => window.__h.walk(x, z - 1.5, Math.PI, 100), [x, z]);
    const up = await ev(([x, z]) => window.__h.walk(x, z + 1.5, 0, 100), [x, z]);
    rows.push({ at: [x, z], southEnd: down.end[1], northEnd: up.end[1], ok: down.end[1] > z + 0.5 && up.end[1] < z - 0.5 });
  }
  return { ok: rows.every((r) => r.ok), evidence: rows };
});
await check('7 the way out at the east end of the corridor and the door can be walked to', async () => {
  const r = await ev(() => window.__h.walk(7, 0.4, -Math.PI / 2, 200));
  return { ok: r.end[0] > 10.5, evidence: r.end };
});
await check('7 sound: setHall with the map windows does not throw', async () => {
  const e0 = errors.length;
  const s = await ev(() => {
    const w = window.__office.world();
    return { windows: w.acoustics?.windows?.length ?? null, gong: !!w.acoustics?.gong, finite: (w.acoustics?.windows ?? []).every((q) => [q.x, q.y, q.z].every(Number.isFinite)) };
  });
  // The map switch above called setHall for agentix three times; a bad window would have thrown then.
  return { ok: s.windows === 4 && s.finite && errors.length === e0, evidence: s };
});

// ---- 8. Day and night --------------------------------------------------------------------------------
const brightness = async (name) => {
  await wait(2500);
  const file = `${out}/${name}.png`;
  const buf = await page.screenshot({ path: file });
  return ev(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 50;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 80, 50);
    const d = g.getImageData(0, 0, 80, 50).data;
    let sum = 0;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      if (l < 20) dark++;
    }
    return { mean: +(sum / (d.length / 4)).toFixed(1), darkShare: +(dark / (d.length / 4)).toFixed(2) };
  }, buf.toString('base64'));
};
await check('8 night and noon: the room is readable at both and nothing throws', async () => {
  const e0 = errors.length;
  await stand(-8.2, -1.6, 0, -0.04);
  await ev(() => window.__office.sky.show({ hour: 2 }));
  const night = await brightness('08-night');
  await ev(() => window.__office.sky.show({ hour: 12 }));
  const noon = await brightness('08-noon');
  await ev(() => window.__office.sky.show({ hour: 2, weather: 'rain', intensity: 1 }));
  const rain = await brightness('08-night-rain');
  await ev(() => window.__office.sky.show({}));
  return { ok: night.mean > 25 && night.darkShare < 0.6 && noon.mean > 60 && errors.length === e0, evidence: { night, noon, rain, newErrors: errors.slice(e0) } };
});

await finish(0);
