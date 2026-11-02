// Who ends up where when a person is dropped on the floor plan (shared/desks.ts). Pure: no DOM. The
// people are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deskAt, deskMoves, dropEdit, withMoves } from '../src/shared/desks.js';
import { PEOPLE_DESKS } from '../src/shared/maps/agentix.js';
import type { TeamMember } from '../src/shared/team.js';

const person = (id: string, desk: string | null, more: Partial<TeamMember> = {}): TeamMember => ({ id, name: `${id} Example`, role: '', look: 'woman', desk, workingOn: '', goodAt: [], availability: { state: 'unknown' }, ...more });
const team = () => [person('ada', 'west'), person('ben', 'middle'), person('cy', null), person('di', null, { remote: true })];
const deskOf = (members: TeamMember[]) => Object.fromEntries(members.map((m) => [m.id, m.desk]));
/** Applies a drop the way the window and the server do together. */
const drop = (members: TeamMember[], id: string, target: Parameters<typeof dropEdit>[2]) => {
  const edit = dropEdit(members, id, target);
  if (!edit) return members;
  const r = deskMoves(members, edit);
  assert.ok('moves' in r, 'a drop the window asks for is one the server accepts');
  return withMoves(members, r.moves);
};

test('a free desk is given to the person dropped on it, and the desk they left is free', () => {
  assert.deepEqual(deskOf(drop(team(), 'ada', { kind: 'desk', desk: 'window' })), { ada: 'window', ben: 'middle', cy: null, di: null });
  assert.deepEqual(deskOf(drop(team(), 'cy', { kind: 'desk', desk: 'door' })), { ada: 'west', ben: 'middle', cy: 'door', di: null });
});

test('a taken desk is a swap: both end up with a desk, and nobody shares one', () => {
  assert.deepEqual(dropEdit(team(), 'ada', { kind: 'desk', desk: 'middle' }), { id: 'ada', desk: 'middle', swapWith: 'ben' });
  assert.deepEqual(deskOf(drop(team(), 'ada', { kind: 'desk', desk: 'middle' })), { ada: 'middle', ben: 'west', cy: null, di: null });
});

test('dropping someone without a desk on a taken desk puts the holder in the tray', () => {
  assert.deepEqual(deskOf(drop(team(), 'cy', { kind: 'desk', desk: 'west' })), { ada: null, ben: 'middle', cy: 'west', di: null });
});

test('the tray takes the desk away; with no desk to give up, nothing happens', () => {
  assert.deepEqual(dropEdit(team(), 'ada', { kind: 'tray' }), { id: 'ada', desk: null });
  assert.deepEqual(deskOf(drop(team(), 'ada', { kind: 'tray' })), { ada: null, ben: 'middle', cy: null, di: null });
  assert.equal(dropEdit(team(), 'cy', { kind: 'tray' }), null);
});

test('letting go anywhere else, on your own desk, or dropping a remote person changes nothing', () => {
  assert.equal(dropEdit(team(), 'ada', { kind: 'none' }), null);
  assert.equal(dropEdit(team(), 'ada', { kind: 'desk', desk: 'west' }), null);
  assert.equal(dropEdit(team(), 'di', { kind: 'desk', desk: 'door' }), null);
  assert.equal(dropEdit(team(), 'nobody', { kind: 'desk', desk: 'door' }), null);
});

test('the server side refuses what would leave two people on one desk, or a swap that has gone stale', () => {
  const t = team();
  const why = (edit: Parameters<typeof deskMoves>[1]) => (deskMoves(t, edit) as { error: string }).error;
  assert.equal(why({ id: 'ada', desk: 'middle' }), 'That desk is ben Example’s');
  assert.match(why({ id: 'ada', desk: 'middle', swapWith: 'cy' }), /ben Example’s now/);
  assert.match(why({ id: 'ada', desk: 'door', swapWith: 'ben' }), /free now/);
  assert.match(why({ id: 'ada', desk: null, swapWith: 'ben' }), /swap/);
  assert.match(why({ id: 'ada', desk: 'nowhere' }), /no such desk/);
  assert.match(why({ id: 'di', desk: 'door' }), /remotely/);
  assert.match(why({ id: 'zed', desk: 'door' }), /nobody/);
});

test('whatever the drops, nobody ends up on two desks or sharing one', () => {
  let members = team();
  const ids = ['ada', 'ben', 'cy'];
  const targets = [...PEOPLE_DESKS.map((d) => ({ kind: 'desk' as const, desk: d.id })), { kind: 'tray' as const }, { kind: 'none' as const }];
  for (let i = 0; i < 300; i++) {
    members = drop(members, ids[(i * 7) % 3], targets[(i * 5 + (i >> 2)) % targets.length]);
    const held = members.map((m) => m.desk).filter((d) => d !== null);
    assert.equal(new Set(held).size, held.length, `step ${i}: ${JSON.stringify(deskOf(members))}`);
    assert.equal(members.length, 4);
  }
});

test('deskAt finds the desk under a point on the plan, and nothing in the middle of the corridor', () => {
  for (const d of PEOPLE_DESKS) assert.equal(deskAt(d.x, d.z), d.id, d.id);
  for (const d of PEOPLE_DESKS) assert.equal(deskAt(d.x + Math.sin(d.rotY) * 0.75, d.z + Math.cos(d.rotY) * 0.75), d.id, `${d.id}'s chair`);
  assert.equal(deskAt(0, 0), null);
  assert.equal(deskAt(-100, 100), null);
});
