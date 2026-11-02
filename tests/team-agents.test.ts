import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

// The team window lists the agents on the floor and names their status. Every status the server can
// send has to read as something in the window, and the ones that need you must come first.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});

const { store } = await import('../src/client/state/index.js');
const { agentStatus, agentsHere } = await import('../src/client/features/team/controller.js');

const STATUSES: WorkerStatus[] = ['starting', 'idle', 'working', 'needs_input', 'done', 'exited', 'offline'];
const agent = (id: string, status: WorkerStatus, createdAt: number) => ({ id, deskId: `d-${id}`, name: id, color: '#fff', kind: 'agent', status, createdAt, acked: false, createdBy: 'x' }) as WorkerInfo;

test('every status the server sends has a label in the team window', () => {
  const tones: Record<string, string> = {};
  for (const s of STATUSES) {
    const st = agentStatus(agent('a', s, 1));
    assert.ok(st.label.length > 0, s);
    tones[s] = st.tone;
  }
  assert.deepEqual(tones, { starting: 'rest', idle: 'rest', working: 'working', needs_input: 'needs', done: 'done', exited: 'rest', offline: 'rest' });
  assert.equal(agentStatus(agent('a', 'working', 1)).label, 'Working');
  assert.equal(agentStatus(agent('a', 'idle', 1)).label, 'Ready');
});

test('agents come needs-you first, then working, then done, then the rest, oldest first within each', () => {
  store.workers.clear();
  for (const w of [agent('idle', 'idle', 1), agent('done', 'done', 2), agent('work-new', 'working', 5), agent('work-old', 'working', 3), agent('needs', 'needs_input', 9)]) store.workers.set(w.id, w);
  assert.deepEqual(
    agentsHere().map((w) => w.id),
    ['needs', 'work-old', 'work-new', 'done', 'idle'],
  );
  store.workers.clear();
});
