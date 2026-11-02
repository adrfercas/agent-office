// Moving people between desks on the server (Roster.edit): a swap is one edit and one write, and a
// refusal leaves the file alone. The people are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Roster } from '../src/server/roster.js';
import type { TeamState } from '../src/shared/team.js';

const person = (id: string, more: Record<string, unknown> = {}) => ({ id, name: `${id} Example`, role: 'Tester', look: 'woman', desk: null, workingOn: 'keep me', goodAt: [], availability: { state: 'unknown' }, secretNote: 'kept', ...more });

function setup(members: unknown[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agentix-desks-'));
  const file = path.join(dir, 'team.json');
  writeFileSync(file, JSON.stringify({ members }));
  const heard: TeamState[] = [];
  const roster = new Roster(dir, (s) => heard.push(s));
  const desks = () => Object.fromEntries(roster.state().members.map((m) => [m.id, m.desk]));
  const onDisk = () => (JSON.parse(readFileSync(file, 'utf8')) as { members: { id: string; desk: string | null; secretNote: string }[] }).members;
  return { roster, heard, desks, onDisk, file };
}

test('a swap moves both people in one change, one write and one broadcast', () => {
  const { roster, heard, desks, onDisk } = setup([person('ada', { desk: 'west' }), person('ben', { desk: 'middle' }), person('cy')]);
  assert.equal(roster.edit({ id: 'ada', desk: 'middle', swapWith: 'ben' }), undefined);
  assert.deepEqual(desks(), { ada: 'middle', ben: 'west', cy: null });
  assert.deepEqual(Object.fromEntries(onDisk().map((m) => [m.id, m.desk])), { ada: 'middle', ben: 'west', cy: null });
  assert.equal(heard.length, 1, 'everyone is told once, with both moved');
  assert.deepEqual(heard[0].members.map((m) => m.desk), ['middle', 'west', null]);
  assert.equal(onDisk()[0].secretNote, 'kept', 'the rest of the file is kept');
});

test('a person with no desk taking a taken desk sends its holder to the tray', () => {
  const { roster, desks } = setup([person('ada', { desk: 'west' }), person('cy')]);
  assert.equal(roster.edit({ id: 'cy', desk: 'west', swapWith: 'ada' }), undefined);
  assert.deepEqual(desks(), { ada: null, cy: 'west' });
});

test('a taken desk without a swap, or a swap with the wrong person, is refused and the file is not touched', () => {
  const { roster, heard, desks, file } = setup([person('ada', { desk: 'west' }), person('ben', { desk: 'middle' }), person('cy')]);
  const before = readFileSync(file, 'utf8');
  assert.match(roster.edit({ id: 'ada', desk: 'middle' }) ?? '', /ben Example’s/);
  assert.match(roster.edit({ id: 'ada', desk: 'middle', swapWith: 'cy' }) ?? '', /nothing was changed/);
  assert.match(roster.edit({ id: 'cy', desk: 'door', swapWith: 'ben' }) ?? '', /nothing was changed/);
  assert.match(roster.edit({ id: 'cy', desk: 'nowhere' }) ?? '', /no such desk/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(heard.length, 0);
  assert.deepEqual(desks(), { ada: 'west', ben: 'middle', cy: null });
});

test('a note edited in the same change as a refused desk is not half-saved', () => {
  const { roster, file } = setup([person('ada', { desk: 'west' }), person('ben', { desk: 'middle' })]);
  const before = readFileSync(file, 'utf8');
  assert.ok(roster.edit({ id: 'ada', desk: 'middle', workingOn: 'changed' }));
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('clearing a desk and giving it away still work', () => {
  const { roster, desks } = setup([person('ada', { desk: 'west' }), person('cy')]);
  assert.equal(roster.edit({ id: 'ada', desk: null }), undefined);
  assert.equal(roster.edit({ id: 'cy', desk: 'west' }), undefined);
  assert.deepEqual(desks(), { ada: null, cy: 'west' });
});
