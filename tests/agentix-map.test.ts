// The agentix office (shared/maps/agentix.ts): that its map plans, that its six real desks come first,
// that every seat can be walked to from the door, and that it is what the building is until someone picks another map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Maps } from '../src/server/maps.js';
import { DESK_BY_ID } from '../src/shared/layout.js';
import { NavGrid, pathLength } from '../src/shared/nav.js';
import { AGENTIX, REAL_ROOM } from '../src/shared/maps/agentix.js';
import { BUILTIN_MAPS, DEFAULT_MAP, OFFICE_PLAN, mapChoices, planMap, planOf } from '../src/shared/maps/index.js';

const plan = planMap(AGENTIX);
const nav = new NavGrid(plan.bounds, plan.obstacles!);

/** Every step along `way` (after its first `skip` points) is on open floor. */
function clear(way: [number, number][], skip: number, what: string) {
  for (let i = skip + 1; i < way.length; i++) {
    const [x0, z0] = way[i - 1];
    const [x1, z1] = way[i];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = z0 + ((z1 - z0) * k) / n;
      assert.ok(nav.walkable(x, z), `${what} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
}

test('the agentix office plans, as the agentix style, and is a built-in map', () => {
  assert.equal(plan.id, 'agentix');
  assert.equal(plan.style, 'agentix');
  assert.ok(BUILTIN_MAPS.some((m) => m.id === 'agentix'));
  assert.equal(BUILTIN_MAPS[0].id, 'agentix', 'the first built-in map');
  assert.equal(planOf('agentix').id, 'agentix');
  assert.ok(mapChoices().some((c) => c.id === 'agentix' && !c.custom && !c.error));
});

test('agentix has every seat the office has, by the same ids', () => {
  assert.deepEqual(new Set(plan.byId.keys()), new Set(DESK_BY_ID.keys()));
  for (const [id, d] of plan.byId) {
    const office = DESK_BY_ID.get(id)!;
    assert.equal(!!d.station, !!office.station, `${id} is a kiosk on both`);
    assert.equal(d.station, office.station);
    assert.equal(!!d.room, !!office.room, `${id} is a meeting chair on both`);
  }
});

test("the real room's six desks are desk-1 to desk-6", () => {
  const { minX, maxX, minZ, maxZ } = REAL_ROOM;
  for (let i = 1; i <= 6; i++) {
    const d = plan.byId.get(`desk-${i}`)!;
    assert.ok(d, `desk-${i} exists`);
    assert.ok(d.x > minX && d.x < maxX && d.z > minZ && d.z < maxZ, `desk-${i} (${d.x.toFixed(2)}, ${d.z.toFixed(2)}) is in the real room`);
  }
  // The seventh is in the room next door.
  const seventh = plan.byId.get('desk-7')!;
  assert.ok(seventh.x > REAL_ROOM.maxX, 'desk-7 is past the real room’s east wall');
});

test('a table without `first` keeps its place: the order is the same as before for any other map', () => {
  const noFirst = planMap({ ...AGENTIX, id: 'no-first', tables: AGENTIX.tables.map(({ first: _first, ...t }) => t) });
  // Without the flag, the seats toward the middle of the hall fill first, as in every other map.
  assert.equal(noFirst.desks.length, plan.desks.length);
  assert.notDeepEqual(
    noFirst.desks.slice(0, 6).map((d) => d.id + d.x.toFixed(2) + d.z.toFixed(2)),
    plan.desks.slice(0, 6).map((d) => d.id + d.x.toFixed(2) + d.z.toFixed(2)),
  );
});

test('every seat, lectern and meeting chair can be walked to from the door, and back', () => {
  assert.ok(nav.walkable(plan.door.x, plan.door.z), 'the door is clear');
  assert.ok(nav.walkable(plan.spawn.x, plan.spawn.z), 'where you arrive is clear');
  const to = plan.door;
  for (const d of plan.byId.values()) {
    // Off its seat (it hops down beside it, then walks)…
    const way = nav.wayFrom(d, [to.x, to.z]);
    // The point behind the chair can sit a hand's breadth inside the 0.3 m the grid keeps off a wall (the desks by a wall); it hops to the nearest clear cell, under a metre on.
    const hop = way.length > 2 && Math.hypot(way[2][0] - way[1][0], way[2][1] - way[1][1]) < 0.8;
    clear(way, hop ? 2 : 1, `${d.id} going`);
    assert.ok(pathLength(way) < 3 * Math.hypot(to.x - d.x, to.z - d.z) + 10, `${d.id} doesn't go the long way round`);
    // …and back to it (up to beside it, where it hops on).
    const back = nav.wayTo([to.x, to.z], d);
    clear(back.slice(0, -1), hop ? 1 : 0, `${d.id} coming back`);
  }
});

test('no doorway is blocked: the floor is clear in it and a step either side', () => {
  const doorways = (AGENTIX.props ?? []).filter((p) => p.kind === 'doorway');
  assert.ok(doorways.length >= 4);
  for (const p of doorways) {
    // The doorway runs along x when its rotY is π/2: it is walked through along z.
    const along = Math.abs(Math.sin(p.rotY ?? 0)) > 0.5;
    for (const step of [-0.7, -0.35, 0, 0.35, 0.7]) {
      const [x, z] = along ? [p.x, p.z + step] : [p.x + step, p.z];
      assert.ok(nav.walkable(x, z), `the doorway at (${p.x}, ${p.z}) is blocked at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
    // Wide enough for a worker (the grid keeps 0.3 m off every wall) to get through.
    assert.ok((p.width ?? 1.4) >= 1.2, `the doorway at (${p.x}, ${p.z}) is only ${p.width} wide`);
  }
});

test('the rooms are joined: from the door to the real room and to the meeting room', () => {
  for (const to of [plan.spawn, plan.council!, plan.stations[0], plan.stations[2]]) {
    const way = nav.route([plan.door.x, plan.door.z], [to.x, to.z]);
    clear(way, 0, `the way to (${to.x}, ${to.z})`);
  }
});

/** A fresh temporary data folder, with `pick` saved as the building's map when there is one. */
function dataDir(pick?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'agentix-maps-'));
  if (pick !== undefined) writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ pick, by: 'test', at: 1 }));
  return dir;
}

test('the building is on agentix until someone picks another map', () => {
  assert.equal(DEFAULT_MAP, 'agentix');
  const maps = new Maps(dataDir());
  assert.equal(maps.pick(), 'agentix');
  assert.equal(maps.plan().id, 'agentix');
  assert.equal(maps.state().pick, 'agentix');
});

test('a saved pick of the office stays on the office, and the office keeps its own id and plan', () => {
  const maps = new Maps(dataDir('office'));
  assert.equal(maps.pick(), 'office');
  assert.equal(maps.plan(), OFFICE_PLAN);
  assert.equal(OFFICE_PLAN.id, 'office');
  assert.equal(planOf(undefined), OFFICE_PLAN);
  assert.ok(mapChoices().some((c) => c.id === 'office'));
  assert.ok(new Maps(dataDir('castle')).pick() === 'castle');
});

test('a saved pick that will not load falls back to agentix, not the office', () => {
  assert.equal(new Maps(dataDir('gone-map')).pick(), 'agentix');
  const dir = dataDir('broken');
  const folder = path.join(dir, 'maps');
  mkdirSync(folder);
  writeFileSync(path.join(folder, 'broken.json'), JSON.stringify({ id: 'broken', name: 'Broken', extends: 'castle', door: { x: 999, z: 0 } }));
  const maps = new Maps(dir);
  assert.ok(maps.state().custom.some((m) => m.file === 'broken.json' && m.error), 'the broken map is listed with why');
  assert.equal(maps.pick(), 'agentix');
  assert.equal(maps.plan().id, 'agentix');
  // A pick of a custom map that does load is kept.
  writeFileSync(path.join(folder, 'fine.json'), JSON.stringify({ id: 'fine', name: 'Fine', extends: 'castle' }));
  writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ pick: 'fine', by: 'test', at: 1 }));
  assert.equal(new Maps(dir).pick(), 'fine');
});
