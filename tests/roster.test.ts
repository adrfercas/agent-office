// The team file (server/roster.ts): reading it without trusting it, picking up an edit made on disk,
// applying the owner's changes, and carrying on when the file is missing or broken. The people here
// are made up: real names never go in a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Roster, readTeam } from '../src/server/roster.js';
import { PEOPLE_DESKS } from '../src/shared/maps/agentix.js';
import { availabilityNow, AVAILABILITY_STALE_MS, type TeamState } from '../src/shared/team.js';

const person = (id: string, more: Record<string, unknown> = {}) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Example`, role: 'Tester', look: 'woman', desk: null, workingOn: '', goodAt: [], availability: { state: 'unknown' }, ...more });

function setup(file?: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agentix-team-'));
  const file_ = path.join(dir, 'team.json');
  if (file !== undefined) writeFileSync(file_, typeof file === 'string' ? file : JSON.stringify(file));
  const heard: TeamState[] = [];
  const roster = new Roster(dir, (s) => heard.push(s));
  /** Writes the file again and makes sure its mtime differs, as an edit minutes later would. */
  const rewrite = (content: unknown) => {
    writeFileSync(file_, typeof content === 'string' ? content : JSON.stringify(content));
    const later = new Date(Date.now() + 5000 + heard.length * 1000);
    utimesSync(file_, later, later);
  };
  return { dir, file: file_, roster, heard, rewrite };
}

test('no team file is an empty team, with nothing wrong', () => {
  const { roster } = setup();
  assert.deepEqual(roster.state(), { members: [] });
  assert.equal(roster.refresh(), false);
});

test('the file is read into people, with what is missing left empty or unknown', () => {
  const { roster } = setup({ members: [{ id: 'ada', name: 'Ada Example' }], calendarAt: 1234 });
  const [ada] = roster.state().members;
  assert.deepEqual(ada, { id: 'ada', name: 'Ada Example', role: '', look: 'man', desk: null, workingOn: '', goodAt: [], availability: { state: 'unknown' } });
  assert.equal(roster.state().calendarAt, 1234);
  assert.equal(roster.state().error, undefined);
});

test('nothing in the file is taken on trust: bad people are left out and the file says why', () => {
  const { state, problems } = readTeam({
    members: [
      person('ada', { desk: 'west', goodAt: ['maths', 3, '', 'maths', 'engines'], availability: { state: 'free', source: 'calendar', checkedAt: 5, until: 'soon', junk: 1 } }),
      person('Bad Id'),
      person('ben', { name: '   ' }),
      person('ada'),
      person('cy', { desk: 'west' }),
      person('di', { desk: 'nowhere' }),
      person('ed', { remote: true, desk: 'door' }),
      'not a person',
      person('flo', { look: 'dragon', availability: { state: 'happy' }, __proto__: { x: 1 } }),
    ],
  });
  assert.deepEqual(state.members.map((m) => m.id), ['ada', 'cy', 'di', 'ed', 'flo']);
  const by = Object.fromEntries(state.members.map((m) => [m.id, m]));
  assert.deepEqual(by.ada.goodAt, ['maths', 'engines']);
  assert.deepEqual(by.ada.availability, { state: 'free', source: 'calendar', checkedAt: 5 });
  assert.equal(by.cy.desk, null, 'a desk already taken');
  assert.equal(by.di.desk, null, 'a desk there is not');
  assert.equal(by.ed.desk, null, 'a remote person has no desk');
  assert.equal(by.flo.look, 'man');
  assert.equal(by.flo.availability.state, 'unknown');
  assert.equal(problems.length, 6);
  assert.match(problems.join('\n'), /shares the desk "west"/);
  assert.deepEqual(readTeam([]).state.members, []);
  assert.match(readTeam('x').problems[0], /should be/);
});

test('an edit made on disk is picked up, and everyone is told', () => {
  const { roster, heard, rewrite } = setup({ members: [person('ada')] });
  assert.equal(roster.refresh(), false, 'nothing changed yet');
  rewrite({ members: [person('ada', { availability: { state: 'busy', source: 'calendar', checkedAt: Date.now() } }), person('ben')] });
  assert.equal(roster.refresh(), true);
  assert.deepEqual(roster.state().members.map((m) => m.id), ['ada', 'ben']);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].members[0].availability.state, 'busy');
});

test('a broken file keeps the last good team and says what is wrong, and a fixed one clears it', () => {
  const { roster, rewrite } = setup({ members: [person('ada')] });
  rewrite('{ "members": [ ');
  assert.equal(roster.refresh(), true);
  assert.deepEqual(roster.state().members.map((m) => m.id), ['ada']);
  assert.match(roster.state().error ?? '', /isn’t valid JSON/);
  rewrite({ members: [person('ada'), person('ben')] });
  roster.refresh();
  assert.equal(roster.state().error, undefined);
  assert.equal(roster.state().members.length, 2);
  // Removed altogether: an empty team again.
  const { roster: lost, file } = setup({ members: [person('ada')] });
  writeFileSync(file, JSON.stringify([]));
  const later = new Date(Date.now() + 9000);
  utimesSync(file, later, later);
  lost.refresh();
  assert.match(lost.state().error ?? '', /should be/);
});

test('an edit from the app changes desk, working on and good at, and keeps everything else in the file', () => {
  const { roster, heard, file } = setup({ members: [{ ...person('ada'), extra: { kept: true } }, person('ben')], calendarAt: 77, other: 'kept' });
  assert.equal(roster.edit({ id: 'ada', desk: 'west', workingOn: '  the engine  ', goodAt: ['maths', 'maths', ' gears '] }), undefined);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.other, 'kept');
  assert.equal(saved.calendarAt, 77);
  assert.deepEqual(saved.members[0].extra, { kept: true });
  assert.equal(saved.members[0].desk, 'west');
  assert.equal(saved.members[0].workingOn, 'the engine');
  assert.deepEqual(saved.members[0].goodAt, ['maths', 'gears']);
  assert.equal(roster.state().members[0].desk, 'west');
  assert.equal(heard.length, 1);
  // Nothing half-written is left behind.
  assert.deepEqual(readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), []);
  assert.equal(statSync(file).isFile(), true);
});

test('an edit that cannot be made says why and changes nothing', () => {
  const { roster, heard, file } = setup({ members: [person('ada', { desk: 'west' }), person('ben'), person('cy', { remote: true })] });
  const before = readFileSync(file, 'utf8');
  assert.match(roster.edit({ id: 'ben', desk: 'west' }) ?? '', /Ada Example’s/);
  assert.match(roster.edit({ id: 'ben', desk: 'moon' }) ?? '', /no such desk/);
  assert.match(roster.edit({ id: 'cy', desk: 'door' }) ?? '', /remotely/);
  assert.match(roster.edit({ id: 'nobody', desk: null }) ?? '', /nobody/);
  assert.match(roster.edit({ id: 'ben', workingOn: 5 }) ?? '', /text/);
  assert.match(roster.edit({ id: 'ben', goodAt: 'maths' }) ?? '', /list/);
  assert.match(roster.edit(null) ?? '', /who/);
  assert.match(roster.edit({ desk: 'west' }) ?? '', /who/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(heard.length, 0);
  // Giving a desk up frees it for someone else.
  assert.equal(roster.edit({ id: 'ada', desk: null }), undefined);
  assert.equal(roster.edit({ id: 'ben', desk: 'west' }), undefined);
});

test('with a missing or broken file an edit is refused rather than inventing a file', () => {
  const none = setup();
  assert.match(none.roster.edit({ id: 'ada', desk: null }) ?? '', /no team file/);
  const broken = setup('not json at all');
  assert.match(broken.roster.state().error ?? '', /valid JSON/);
  assert.match(broken.roster.edit({ id: 'ada', desk: null }) ?? '', /can’t be read/);
  assert.equal(readFileSync(broken.file, 'utf8'), 'not json at all');
});

test('the desks a person can be given are the ones the map has', () => {
  assert.equal(PEOPLE_DESKS.length, 8);
  const { roster } = setup({ members: PEOPLE_DESKS.map((d, i) => person(`p${i}`, { desk: d.id })) });
  assert.equal(roster.state().error, undefined);
  assert.deepEqual(roster.state().members.map((m) => m.desk), PEOPLE_DESKS.map((d) => d.id));
});

test('a calendar answer that is too old or has run out shows as unknown', () => {
  const now = 10 * 3600_000;
  const free = { state: 'free', source: 'calendar', checkedAt: now - 60_000 } as const;
  assert.equal(availabilityNow(free, now), 'free');
  assert.equal(availabilityNow({ ...free, checkedAt: now - AVAILABILITY_STALE_MS - 1 }, now), 'unknown');
  assert.equal(availabilityNow({ ...free, until: now - 1 }, now), 'unknown');
  assert.equal(availabilityNow({ state: 'busy', source: 'manual' }, now), 'busy');
});
