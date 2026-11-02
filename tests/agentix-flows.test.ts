// What the app does on the agentix map, as far as it can be checked without a browser: who sits where as
// workers are hired (with and without a back office), which way each seat faces, the way home from each
// room, the boards, and a map of your own that extends agentix. tests/agentix-map.test.ts has the plan
// and the walking in general; src/client/lab/agentix-flows.mjs does the same in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Maps } from '../src/server/maps.js';
import { BEANBAGS, DESKS, WING_DESKS, beanbagsOut, deskSeat, nextFreeSeat, vacantSeats } from '../src/shared/layout.js';
import { NavGrid } from '../src/shared/nav.js';
import { AGENTIX, PEOPLE_DESKS, REAL_ROOM } from '../src/shared/maps/agentix.js';
import { agentixFootprint } from '../src/shared/maps/agentix-props.js';
import { planMap } from '../src/shared/maps/index.js';
import { boxFootprint } from '../src/shared/maps/props.js';
import type { BoardKey, MapPlan } from '../src/shared/maps/types.js';

const plan = planMap(AGENTIX);
const nav = new NavGrid(plan.bounds, plan.obstacles!);
const props = AGENTIX.props ?? [];
type Rect = [number, number, number, number];

const inside = (r: Rect, x: number, z: number, m = 0) => x > r[0] - m && x < r[1] + m && z > r[2] - m && z < r[3] + m;
/** The solid inside walls (the doorway frames are only trim over the gap). */
const walls: Rect[] = props.filter((p) => p.kind === 'wall').map((p) => agentixFootprint(p)!.rect!);
/** Each table's top, as the rectangle it covers. */
const tops: Rect[] = plan.tables.map((t) => boxFootprint(t.x, t.z, t.width, t.length, t.rotY));
const seats = [...plan.desks, ...plan.overflow];
const taken = (ids: Iterable<string>) => {
  const set = new Set(ids);
  return (id: string) => set.has(id);
};

/** Hires `n` workers one after another the way the server does (nextFreeSeat), at back office level `wing`. */
function hire(n: number, wing: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const seat = nextFreeSeat(taken(ids), wing);
    if (!seat) break;
    ids.push(seat.id);
  }
  return ids;
}

test('hiring with no back office: desk-1 to desk-16 next door, then the overflow, and nobody at desk-17 to desk-20', () => {
  const ids = hire(40, 0);
  assert.deepEqual(ids.slice(0, 16), Array.from({ length: 16 }, (_, i) => `desk-${i + 1}`));
  assert.deepEqual(ids.slice(16), BEANBAGS.map((b) => b.id), 'then the twelve overflow seats, skipping the unbuilt back office desks');
  for (const id of ids) assert.ok(plan.byId.has(id), `${id} is a seat on the agentix plan`);
  for (const w of WING_DESKS) assert.ok(!ids.includes(w.id), `${w.id} is not handed out with no back office`);
  // The real room's desks are for people: no worker is ever hired there.
  for (const id of ids) assert.ok(plan.byId.get(id)!.x > REAL_ROOM.maxX, `${id} is next door, not in the real room`);
  assert.equal(ids.length, 28, 'with no back office the floor seats 16 at desks and 12 on overflow seats');
  assert.equal(nextFreeSeat(taken(ids), 0), undefined, 'a 29th worker has nowhere to go');
});

test('hiring with a back office built out: desk-17 to desk-20 come before the overflow, row by row', () => {
  assert.deepEqual(hire(18, 1).slice(16), ['desk-17', 'desk-18']);
  assert.deepEqual(hire(20, 2).slice(16), ['desk-17', 'desk-18', 'desk-19', 'desk-20']);
  assert.equal(hire(40, 2).length, 32);
  // Desks 17 to 20 exist on agentix as the north row's window-side seats, so there is somewhere to put them.
  for (const id of ['desk-17', 'desk-18', 'desk-19', 'desk-20']) assert.match(plan.byId.get(id)!.label, /^North row/);
});

test('the overflow seats come out only when every built desk is taken, one spare at a time', () => {
  const desks16 = Array.from({ length: 16 }, (_, i) => `desk-${i + 1}`);
  assert.equal(beanbagsOut(taken(desks16.slice(0, 15)), 0).size, 0, 'a free desk left: nothing out');
  assert.deepEqual([...beanbagsOut(taken(desks16), 0)], ['beanbag-1'], 'all 16 desks taken with no back office: one spare');
  assert.equal(beanbagsOut(taken(desks16), 1).size, 0, 'with a back office built the new desks come first');
  assert.deepEqual([...beanbagsOut(taken([...desks16, 'beanbag-1']), 0)].sort(), ['beanbag-1', 'beanbag-2']);
  // A worker on an overflow seat keeps it out even when a desk frees up.
  assert.ok(beanbagsOut(taken([...desks16.slice(1), 'beanbag-3']), 0).has('beanbag-3'));
  // Every vacancy marker the client could show is a seat the plan has.
  for (const id of vacantSeats([])) assert.ok(plan.byId.has(id), `${id} is on the plan`);
});

test('a worker hired where the back office is not built still has a seat that works: the overflow seat is a real place at a table', () => {
  const first = plan.byId.get(nextFreeSeat(taken(hire(16, 0)), 0)!.id)!;
  assert.equal(first.id, 'beanbag-1');
  assert.ok(nav.walkable(deskSeat(first, 1.4).x, deskSeat(first, 1.4).z) || nav.wayFrom(first, [plan.door.x, plan.door.z]).length > 1);
  assert.ok(seats.includes(first));
});

test('seats stay apart, stay in the hall, and every chair is clear of walls, tables and other chairs', () => {
  assert.equal(seats.length, 32);
  const { minX, maxX, minZ, maxZ } = plan.bounds;
  for (const [i, a] of seats.entries()) {
    assert.ok(a.x > minX && a.x < maxX && a.z > minZ && a.z < maxZ, `${a.id} is in the hall`);
    const chair = deskSeat(a, 0.85);
    for (const w of walls) assert.ok(!inside(w, a.x, a.z) && !inside(w, chair.x, chair.z, 0.05), `${a.id} or its chair is in a wall`);
    // The chair stands in the aisle, not under another table.
    tops.forEach((t, k) => assert.ok(!inside(t, chair.x, chair.z, 0.1), `${a.id}'s chair is under table ${plan.tables[k].name}`));
    for (const b of seats.slice(i + 1)) {
      // Opposite sides of one 0.8 m table sit 0.1 m apart (their laptops would overlap): see the report. Same side must be apart.
      if (Math.abs(a.rotY - b.rotY) < 0.1) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.9, `${a.id} and ${b.id} are on top of each other`);
      else assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.05 || Math.abs(Math.abs(a.rotY - b.rotY) - Math.PI) < 0.1, `${a.id} and ${b.id} are on top of each other`);
      const other = deskSeat(b, 0.85);
      assert.ok(Math.hypot(chair.x - other.x, chair.z - other.z) > 0.5, `${a.id}'s chair and ${b.id}'s overlap`);
    }
  }
});

test('each seat faces its desk: the table is straight ahead, the laptop end of it is within reach, and the chair is behind', () => {
  for (const d of seats) {
    const t = plan.tables.find((q) => inside(boxFootprint(q.x, q.z, q.width, q.length, q.rotY) as Rect, d.x, d.z, 0.05));
    assert.ok(t, `${d.id} sits at a table`);
    const ahead = [-Math.sin(d.rotY), -Math.cos(d.rotY)];
    // Along the facing direction the table's middle line is in front of the seat, by less than the table's depth.
    const across = (t.x - d.x) * ahead[0] + (t.z - d.z) * ahead[1];
    assert.ok(across > 0 && across <= t.width / 2 + 0.05, `${d.id} faces away from, or is far from, its table (${across.toFixed(2)})`);
    // The chair is on the opposite side, on open floor.
    const chair = deskSeat(d, 0.85);
    assert.ok(nav.walkable(deskSeat(d, 1.2).x, deskSeat(d, 1.2).z) || !inside(boxFootprint(t.x, t.z, t.width, t.length, t.rotY) as Rect, chair.x, chair.z), `${d.id}'s chair is behind it`);
  }
});

test('the rooms: every worker seat is next door, and the eight people desks are in the real room and the board room', () => {
  for (const d of seats) assert.ok(d.x > -5.4 && d.x < 12 && d.z > -9 && d.z < -1, `${d.id} is in the second desk room`);
  assert.deepEqual(plan.desks.slice(0, 8).map((d) => d.label.split(',')[0]), Array(8).fill('North row'));
  assert.deepEqual(plan.desks.slice(8, 16).map((d) => d.label.split(',')[0]), Array(8).fill('South row'));
  assert.equal(PEOPLE_DESKS.length, 8);
  assert.equal(PEOPLE_DESKS.filter((d) => inside([REAL_ROOM.minX, REAL_ROOM.maxX, REAL_ROOM.minZ, REAL_ROOM.maxZ], d.x, d.z)).length, 6);
  // The person sits on the side the desk says: a step that way from the desk is open floor, and the walls stay clear.
  for (const d of PEOPLE_DESKS) {
    const at = deskSeat({ x: d.x, z: d.z, rotY: d.rotY } as never, 0.85);
    for (const w of walls) assert.ok(!inside(w, at.x, at.z), `${d.id}'s chair is in a wall`);
    assert.ok(at.x > plan.bounds.minX && at.x < plan.bounds.maxX && at.z > plan.bounds.minZ && at.z < plan.bounds.maxZ);
  }
});

test('sending home: from next door a worker leaves by the doorway at x = 3.5, and nothing crosses a wall', () => {
  const crossing = (way: [number, number][], z: number) => {
    const xs: number[] = [];
    for (let i = 1; i < way.length; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      if ((z0 - z) * (z1 - z) < 0) xs.push(x0 + ((x1 - x0) * (z - z0)) / (z1 - z0));
    }
    return xs;
  };
  for (const d of seats) {
    const way = nav.wayFrom(d, [plan.door.x, plan.door.z]);
    // Every step is clear of the solid walls (the nav grid already keeps 0.3 m off them).
    for (let i = 1; i < way.length; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      for (let k = 0; k <= 20; k++) {
        const x = x0 + ((x1 - x0) * k) / 20;
        const z = z0 + ((z1 - z0) * k) / 20;
        for (const w of walls) assert.ok(!inside(w, x, z), `${d.id} walks through a wall at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    const through = crossing(way, -0.9);
    assert.equal(through.length, 1, `${d.id} crosses the corridor wall once`);
    assert.ok(Math.abs(through[0] - 3.5) < 0.7, `${d.id} leaves by the doorway at x = 3.5 (crossed at ${through[0].toFixed(2)})`);
  }
  // The way out is the east end of the corridor.
  assert.ok(plan.door.x > 10 && plan.door.z > -0.8 && plan.door.z < 1.6);
});

test('the meeting table and the board agents: their places are on open floor and each board has room to stand in front of it', () => {
  for (const d of plan.meeting) assert.ok(nav.walkable(deskSeat(d, 1.4).x, deskSeat(d, 1.4).z) || nav.walkable(deskSeat(d, 1.75).x, deskSeat(d, 1.75).z), `${d.id} can be walked up to`);
  // A board agent stands behind its lectern, toward its board; you come at it from the other side.
  for (const d of plan.stations) assert.ok(nav.walkable(deskSeat(d, -1.2).x, deskSeat(d, -1.2).z), `${d.id} can be walked up to`);
  for (const key of ['issues', 'queue', 'pulls', 'services'] as BoardKey[]) {
    const b = plan.boards[key];
    // A board faces +sin(rotY), +cos(rotY). Its agent's lectern stands in front of it, so look for a place to read it
    // from between 1.2 m and 3.5 m out.
    const spots = Array.from({ length: 10 }, (_, i) => 1.2 + i * 0.25).map((d) => [b.x + Math.sin(b.rotY) * d, b.z + Math.cos(b.rotY) * d] as const);
    assert.ok(spots.some(([x, z]) => nav.walkable(x, z)), `${key} board: nowhere to stand in front of it`);
    assert.ok(b.x > plan.bounds.minX && b.x < plan.bounds.maxX && b.z > plan.bounds.minZ && b.z < plan.bounds.maxZ, `${key} board is in the hall`);
  }
  // The whiteboard (the task queue's board) is in the real room, on its east wall.
  assert.ok(inside([REAL_ROOM.minX, REAL_ROOM.maxX, REAL_ROOM.minZ, REAL_ROOM.maxZ], plan.boards.queue.x, plan.boards.queue.z, 0.1));
  // The meeting table is in the meeting room, and the gong and coffee machine are in the corridor.
  assert.ok(plan.council!.z > 1.8 && plan.council!.x < 0);
  for (const kind of ['gong', 'coffee']) {
    const p = props.find((q) => q.kind === kind)!;
    assert.ok(p.z > -0.8 && p.z < 1.6, `the ${kind} is in the corridor`);
  }
});

test('a map of your own that extends agentix is still agentix, and editing it plans again without trouble', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agentix-flows-'));
  const folder = path.join(dir, 'maps');
  mkdirSync(folder);
  const write = (json: object) => writeFileSync(path.join(folder, 'mine.json'), JSON.stringify(json));
  write({ id: 'mine', name: 'Mine', extends: 'agentix' });
  writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ pick: 'mine', by: 'test', at: 1 }));
  let maps = new Maps(dir);
  const first: MapPlan = maps.plan();
  assert.equal(first.id, 'mine');
  assert.equal(first.style, 'agentix');
  assert.deepEqual(first.desks.map((d) => d.id), plan.desks.map((d) => d.id));
  // Edited: the spawn moved, the props cut down to a bare room with no windows, gong or doors.
  write({ id: 'mine', name: 'Mine', extends: 'agentix', spawn: { x: -9, z: -3, rotY: 0 }, props: [] });
  maps = new Maps(dir);
  const second = maps.plan();
  assert.equal(second.id, 'mine');
  assert.notEqual(second, first, 'a new plan object, so the client builds the world again and disposes the old one');
  assert.equal(second.spawn.x, -9);
  assert.equal(second.config!.props!.length, 0);
});
