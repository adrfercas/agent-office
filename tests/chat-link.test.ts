// The chat link on a colleague (shared/chat-link.ts): which links are let through, and how the field
// moves through the team file and the owner's edit. The people and the ids are made up: real names
// and real chat ids never go in a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Roster, readTeam } from '../src/server/roster.js';
import { chatLink, MAX_CHAT_LINK } from '../src/shared/chat-link.js';
import type { TeamState } from '../src/shared/team.js';

const DM = 'https://mail.google.com/chat/u/0/#chat/dm/EXAMPLEID1';
const DM2 = 'https://chat.google.com/dm/EXAMPLEID2';
const person = (id: string, more: Record<string, unknown> = {}) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Example`, role: 'Tester', look: 'woman', desk: null, workingOn: '', goodAt: [], availability: { state: 'unknown' }, ...more });

function setup(file: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agentix-chat-'));
  const f = path.join(dir, 'team.json');
  writeFileSync(f, JSON.stringify(file));
  const heard: TeamState[] = [];
  return { file: f, heard, roster: new Roster(dir, (s) => heard.push(s)) };
}

test('links on Google Chat’s own hosts are let through, tidied', () => {
  assert.deepEqual(chatLink(DM), { url: DM });
  assert.deepEqual(chatLink(DM2), { url: DM2 });
  assert.deepEqual(chatLink(`  ${DM2}\n`), { url: DM2 }, 'trimmed');
  assert.deepEqual(chatLink('https://CHAT.google.com/dm/X'), { url: 'https://chat.google.com/dm/X' }, 'host in lower case');
});

test('anything that is not https on exactly those hosts is refused', () => {
  const bad = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    'http://chat.google.com/dm/X',
    'ftp://chat.google.com/dm/X',
    '//chat.google.com/dm/X',
    'chat.google.com/dm/X',
    'https://evil.example/dm/X',
    'https://evil.example/chat.google.com',
    'https://evil.example/?u=https://chat.google.com',
    'https://evil.example#chat.google.com',
    'https://chat.google.com.evil.example/dm/X',
    'https://evilchat.google.com/dm/X',
    'https://notmail.google.com/chat',
    'https://chat.google.com@evil.example/dm/X',
    'https://user:pw@chat.google.com/dm/X',
    'https://chat.google.com:8443/dm/X',
    'https://chat.google.com./dm/X',
    'https://google.com/chat',
    'https://sub.chat.google.com/dm/X',
    'https://chat.google.com/dm/X with space',
    'https://chat.google.com/dm/X\u0000',
    '',
    '   ',
    `https://chat.google.com/${'a'.repeat(MAX_CHAT_LINK)}`,
  ];
  for (const b of bad) assert.ok('error' in chatLink(b), `should be refused: ${JSON.stringify(b)}`);
  for (const b of [undefined, null, 5, {}, ['https://chat.google.com/dm/X'], true]) assert.ok('error' in chatLink(b));
});

test('a backslash trick cannot move the link to another host', () => {
  const r = chatLink('https://chat.google.com\@evil.example/dm/X');
  // Either refused or tidied to chat.google.com itself, never opened on the other host.
  if ('url' in r) assert.equal(new URL(r.url).hostname, 'chat.google.com');
});

test('the team file carries the chat link through, and drops (and says) one that will not do', () => {
  const { state, problems } = readTeam({ members: [person('ada', { chat: DM }), person('ben'), person('cy', { chat: 'javascript:alert(1)' }), person('di', { chat: 'https://evil.example/' }), person('ed', { chat: 7 })] });
  const by = Object.fromEntries(state.members.map((m) => [m.id, m]));
  assert.equal(by.ada.chat, DM);
  for (const id of ['ben', 'cy', 'di', 'ed']) assert.equal('chat' in by[id], false, id);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /Cy Example|cy/);
  assert.match(problems.join('\n'), /chat link that can’t be used/);
});

test('an edit from the app sets, changes and takes away the chat link, and keeps the rest of the file', () => {
  const { roster, file, heard } = setup({ members: [person('ada', { extra: 'kept' }), person('ben', { chat: DM })] });
  assert.equal(roster.edit({ id: 'ada', chat: ` ${DM2} ` }), undefined);
  assert.equal(roster.state().members[0].chat, DM2);
  assert.equal(heard.length, 1, 'everyone is told');
  let saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.members[0].chat, DM2);
  assert.equal(saved.members[0].extra, 'kept');
  assert.equal(saved.members[1].chat, DM, 'nobody else changed');
  // Together with another field, in one change.
  assert.equal(roster.edit({ id: 'ada', chat: DM, workingOn: 'tests' }), undefined);
  assert.equal(roster.state().members[0].workingOn, 'tests');
  assert.equal(roster.state().members[0].chat, DM);
  // Taking it away: null and an empty string both do.
  assert.equal(roster.edit({ id: 'ada', chat: null }), undefined);
  assert.equal('chat' in roster.state().members[0], false);
  assert.equal(roster.edit({ id: 'ben', chat: '' }), undefined);
  saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal('chat' in saved.members[0], false);
  assert.equal('chat' in saved.members[1], false);
});

test('an edit with a link that will not do says why and changes nothing', () => {
  const { roster, file, heard } = setup({ members: [person('ada', { chat: DM })] });
  const before = readFileSync(file, 'utf8');
  for (const chat of ['javascript:alert(1)', 'https://evil.example/dm/X', 'http://chat.google.com/dm/X', 'not a link', 5, {}]) {
    const why = roster.edit({ id: 'ada', chat, workingOn: 'must not be saved' });
    assert.ok(why && /chat link|link/i.test(why), `${JSON.stringify(chat)} -> ${why}`);
  }
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(heard.length, 0);
  assert.equal(roster.state().members[0].chat, DM);
});
