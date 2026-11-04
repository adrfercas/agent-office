import test from 'node:test';
import assert from 'node:assert/strict';
import { BEHIND_FPS, IDLE_AFTER, IDLE_FPS, Pacer, listenForInput, type PageState } from '../src/client/core/pacing.js';

// How often the office is drawn (core/pacing.ts): every frame while it's in use, less often when it's
// left alone, even less behind other windows, and not at all while the tab is hidden.

const page = (over: Partial<{ hidden: boolean; focused: boolean }> = {}): PageState & { hidden(): boolean; set(o: Partial<{ hidden: boolean; focused: boolean }>): void } => {
  const s = { hidden: false, focused: true, ...over };
  return { hidden: () => s.hidden, focused: () => s.focused, set: (o) => Object.assign(s, o) };
};

test('it is drawn every frame at first, and while someone is using it', () => {
  const p = new Pacer(page(), 0);
  assert.equal(p.gap(100), 0);
  p.touch(10_000);
  assert.equal(p.gap(10_000 + IDLE_AFTER - 1), 0);
  assert.equal(p.wait(10_100, 10_090), 0);
  assert.equal(p.relaxed, false);
});

test('left alone, frames come IDLE_FPS a second, and are not due until then', () => {
  const p = new Pacer(page(), 0);
  const quiet = IDLE_AFTER + 1;
  assert.equal(p.gap(quiet), 1000 / IDLE_FPS);
  assert.equal(p.wait(quiet + 10, quiet), 1000 / IDLE_FPS - 10);
  assert.equal(p.relaxed, true);
  assert.equal(p.wait(quiet + 60, quiet), 0);
});

test('a key held down, a mouse button held down, or you walking keeps it busy however long ago the last event was', () => {
  const p = new Pacer(page(), 0);
  p.key('KeyW', true, 0);
  assert.equal(p.gap(60_000), 0);
  p.key('KeyW', false, 60_000);
  assert.equal(p.gap(60_000 + IDLE_AFTER + 1), 1000 / IDLE_FPS);
  p.button(true, 70_000);
  assert.equal(p.gap(90_000), 0);
  p.button(false, 90_000);
  assert.ok(p.gap(100_000) > 0);
  let walking = true;
  p.busy = () => walking;
  assert.equal(p.gap(200_000), 0);
  walking = false;
  assert.ok(p.gap(200_000) > 0);
});

test('losing the focus lets go of held keys, since their release will not come here', () => {
  const pg = page();
  const p = new Pacer(pg, 0);
  p.key('KeyW', true, 0);
  p.lostFocus();
  pg.set({ focused: false });
  assert.equal(p.gap(60_000), 1000 / BEHIND_FPS);
  pg.set({ focused: true });
  assert.equal(p.gap(60_000), 1000 / IDLE_FPS);
});

test('behind other windows it is drawn less often than when it is just idle, and a hidden tab is not drawn', () => {
  const pg = page({ focused: false });
  const p = new Pacer(pg, 0);
  // Even straight after input: the input was for another window.
  p.touch(1000);
  assert.equal(p.gap(1001), 1000 / BEHIND_FPS);
  assert.ok(1000 / BEHIND_FPS > 1000 / IDLE_FPS);
  pg.set({ hidden: true });
  assert.equal(p.gap(1001), Infinity);
  assert.equal(p.wait(1001, 0), Infinity);
});

test('input wakes the loop, and the listeners come off again', () => {
  const seen: string[] = [];
  const handlers = new Map<string, EventListener>();
  const target = (name: string) => ({
    addEventListener: (type: string, fn: EventListener) => handlers.set(`${name}:${type}`, fn),
    removeEventListener: (type: string) => void handlers.delete(`${name}:${type}`),
  });
  const p = new Pacer(page(), 0);
  p.wake = () => void seen.push('wake');
  const off = listenForInput(p, target('win') as never, target('doc') as never);
  handlers.get('win:keydown')!({ code: 'KeyA' } as never);
  handlers.get('win:pointermove')!({} as never);
  handlers.get('doc:visibilitychange')!({} as never);
  assert.deepEqual(seen, ['wake', 'wake', 'wake']);
  assert.equal(p.gap(performance.now() + 60_000), 0, 'KeyA is still held');
  handlers.get('win:keyup')!({ code: 'KeyA' } as never);
  off();
  assert.equal(handlers.size, 0);
});
