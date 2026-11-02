import './ui.css';
import type { MapPlan } from '../../../shared/maps';
import { PEOPLE_DESKS } from '../../../shared/maps/agentix';
import type { WorkerInfo } from '../../../shared/protocol';
import type { TeamMember, TeamState } from '../../../shared/team';
import type { Net } from '../../net';
import { store } from '../../state';
import { clip, h, openModal, timeAgo, type Modal } from '../../ui/dom';
import { engineLabel } from '../../ui/provider';
import { agentStatus, agentsHere, deskById, initials, lasted, lookOf, occupants, readTeam, seatPoint, sendEdit, tally, waitingSpot } from './controller';

// The team window: a small plan of the rooms with everyone on it, the people with whether they are
// free, what they are on and what they are good at, and the agents working with the owner. People are
// round and agents are square all the way through, so the two are never mistaken for each other.

/** What the window needs of the rest of the office. */
export interface TeamHost {
  net: Net;
  plan(): MapPlan;
  /** Puts you at an agent's desk. */
  goTo(workerId: string): void;
  /** Opens an agent's terminal. */
  openTerminal(workerId: string): void;
}

interface Draft {
  workingOn: string;
  goodAt: string;
}

let host: TeamHost | null = null;
/** Redraws whatever of the team window is open, and each open person's card. */
const redraws = new Set<() => void>();
let open: Modal | null = null;

export function bindTeamUi(to: TeamHost) {
  host = to;
}

/** Redraws the open windows with what the store has now (the team changed, or the workers did). */
export function refreshTeamUi() {
  for (const fn of [...redraws]) fn();
}

const NS = 'http://www.w3.org/2000/svg';
type SvgAttrs = Record<string, string | number | EventListener>;
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}, ...kids: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, String(v));
  }
  el.append(...kids);
  return el;
}

/** Whether an input in `root` has the cursor: a redraw then would take it away mid-word. */
function typing(root: HTMLElement): boolean {
  const a = document.activeElement;
  return !!a && root.contains(a) && (a instanceof HTMLInputElement || a instanceof HTMLSelectElement);
}

// ---- The floor plan -------------------------------------------------------------------------------

function floorPlan(t: TeamState | null, now: number, onPerson: (id: string) => void): SVGSVGElement {
  const plan = host!.plan();
  const b = plan.bounds;
  const pad = 0.8;
  const W = b.maxX - b.minX + 2 * pad;
  const L = b.maxZ - b.minZ + 2 * pad;
  const root = svg('svg', { class: 'tw-plan', viewBox: `${b.minX - pad} ${b.minZ - pad} ${W} ${L}`, role: 'img', 'aria-label': 'Plan of the rooms with everyone on it' });
  root.append(svg('rect', { x: b.minX, y: b.minZ, width: b.maxX - b.minX, height: b.maxZ - b.minZ, class: 'tw-floor' }));
  for (const p of plan.config?.props ?? []) {
    if (p.kind === 'wall') {
      const r = p.rotY ?? 0;
      const dx = (Math.sin(r) * (p.length ?? 0)) / 2;
      const dz = (Math.cos(r) * (p.length ?? 0)) / 2;
      root.append(svg('line', { x1: p.x - dx, y1: p.z - dz, x2: p.x + dx, y2: p.z + dz, class: 'tw-wall' }));
    } else if (p.kind === 'window') {
      const half = (p.width ?? 2.6) / 2;
      root.append(svg('line', { x1: p.x - half, y1: p.z, x2: p.x + half, y2: p.z, class: 'tw-window' }));
    }
  }
  root.append(svg('rect', { x: b.maxX - 0.15, y: plan.door.z - 0.65, width: 0.3, height: 1.3, class: 'tw-door' }, svg('title', {}, 'The way out')));
  // The agents' rows.
  for (const tb of plan.tables) {
    root.append(svg('rect', { x: -tb.width / 2, y: -tb.length / 2, width: tb.width, height: tb.length, class: 'tw-rowdesk', transform: `translate(${tb.x} ${tb.z}) rotate(${(-tb.rotY * 180) / Math.PI})` }));
  }
  // The people's desks, and who is at each.
  const sitting = t ? occupants(t) : new Map<string, TeamMember>();
  for (const d of PEOPLE_DESKS) {
    const w = d.along === 'x' ? 1.8 : 0.8;
    const l = d.along === 'x' ? 0.8 : 1.8;
    root.append(svg('rect', { x: d.x - w / 2, y: d.z - l / 2, width: w, height: l, class: sitting.has(d.id) ? 'tw-desk taken' : 'tw-desk' }, svg('title', {}, d.name)));
  }
  const marker = (m: TeamMember, at: { x: number; z: number }, waiting: boolean) => {
    const look = lookOf(m, now);
    root.append(
      svg(
        'g',
        { class: `tw-person${waiting ? ' waiting' : ''}`, transform: `translate(${at.x} ${at.z})`, onclick: () => onPerson(m.id) },
        svg('title', {}, `${m.name}: ${look.label}`),
        svg('circle', { r: 0.6, fill: look.color, class: 'tw-circle' }),
        svg('text', { class: 'tw-initials' }, initials(m.name)),
      ),
    );
  };
  let queued = 0;
  for (const m of t?.members ?? []) {
    if (m.remote) continue;
    const d = deskById(m.desk);
    if (d) marker(m, seatPoint(d), false);
    else marker(m, waitingSpot(queued++), true);
  }
  if (queued) root.append(svg('text', { x: waitingSpot(0).x - 0.5, y: waitingSpot(0).z + 1.5 + Math.floor((queued - 1) / 8) * 0.7, class: 'tw-note' }, 'no desk yet'));
  // The agents, where they sit.
  for (const w of agentsHere()) {
    const def = plan.byId.get(w.deskId);
    if (!def) continue;
    const st = agentStatus(w);
    root.append(
      svg(
        'g',
        { class: `tw-agent-mark ${st.tone}`, transform: `translate(${def.x + Math.sin(def.rotY) * 0.85} ${def.z + Math.cos(def.rotY) * 0.85})` },
        svg('title', {}, `${w.name} (agent): ${st.label}`),
        svg('rect', { x: -0.4, y: -0.4, width: 0.8, height: 0.8, rx: 0.12, fill: w.color, class: 'tw-square' }),
      ),
    );
  }
  root.append(svg('text', { x: b.minX + 0.3, y: b.minZ - 0.25, class: 'tw-note' }, 'north, where the windows are'));
  return root;
}

// ---- A person -------------------------------------------------------------------------------------

/** What is said about when someone's availability was checked. */
function checkedLine(m: TeamMember, now: number): string {
  const a = m.availability;
  if (lookOf(m, now).stale) return `The last calendar answer is old (checked ${timeAgo(a.checkedAt ?? 0)}), so this shows as unknown`;
  if (a.source === 'calendar') {
    const until = a.until && a.until > now ? `, until ${new Date(a.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    return `From the calendar, checked ${a.checkedAt ? timeAgo(a.checkedAt) : 'never'}${until}`;
  }
  if (a.source === 'manual') return 'Set by hand';
  return 'Not checked yet';
}

const notRecorded = () => h('span.tw-empty', {}, 'Not recorded yet');

/** One person's card. `drafts` holds what is being typed for the ones in edit mode. */
function personCard(m: TeamMember, now: number, drafts: Map<string, Draft>, redraw: () => void): HTMLElement {
  const look = lookOf(m, now);
  const draft = drafts.get(m.id);
  const taken = occupants(readTeam() ?? { members: [] });
  const desk = h(
    'select',
    { 'aria-label': `Desk for ${m.name}`, onchange: (e: Event) => sendEdit(host!.net, { id: m.id, desk: (e.target as HTMLSelectElement).value || null }) },
    h('option', { value: '' }, 'No desk yet'),
    ...PEOPLE_DESKS.map((d) => {
      const other = taken.get(d.id);
      const busy = !!other && other.id !== m.id;
      return h('option', { value: d.id, disabled: busy }, busy ? `${d.name} (${other.name})` : d.name);
    }),
  );
  desk.value = m.desk ?? '';
  const row = (label: string, ...kids: (Node | string)[]) => h('div.tw-row', {}, h('span.tw-label', {}, label), h('div.tw-value', {}, ...kids));
  const rows: HTMLElement[] = [m.remote ? row('Desk', 'Remote: shown on the wall screen in the real room') : row('Desk', desk)];
  if (draft) {
    rows.push(
      row('Working on', h('input', { type: 'text', value: draft.workingOn, placeholder: 'What they are on right now', 'aria-label': 'Working on', oninput: (e: Event) => (draft.workingOn = (e.target as HTMLInputElement).value) })),
      row('Good at', h('input', { type: 'text', value: draft.goodAt, placeholder: 'Separate with commas', 'aria-label': 'Good at', oninput: (e: Event) => (draft.goodAt = (e.target as HTMLInputElement).value) })),
    );
  } else {
    rows.push(row('Working on', m.workingOn ? m.workingOn : notRecorded()), row('Good at', m.goodAt.length ? h('span.tw-chips', {}, ...m.goodAt.map((g) => h('span.tw-chip', {}, g))) : notRecorded()));
  }
  const save = () => {
    if (!draft) return;
    sendEdit(host!.net, { id: m.id, workingOn: draft.workingOn.trim(), goodAt: draft.goodAt.split(',').map((g) => g.trim()).filter(Boolean) });
    drafts.delete(m.id);
    redraw();
  };
  const edit = () => {
    drafts.set(m.id, { workingOn: m.workingOn, goodAt: m.goodAt.join(', ') });
    redraw();
  };
  const cancel = () => {
    drafts.delete(m.id);
    redraw();
  };
  const actions = draft
    ? [h('button.btn.primary', { type: 'button', onclick: save }, 'Save'), h('button.btn', { type: 'button', onclick: cancel }, 'Cancel')]
    : [h('button.btn', { type: 'button', onclick: edit }, 'Edit notes')];
  return h(
    'article.tw-person-card',
    { 'data-id': m.id },
    h(
      'header',
      {},
      h('span.tw-light', { style: `background:${look.color}`, title: look.label }),
      h('strong', {}, m.name, m.self ? h('span.tw-you', {}, ' (you)') : null),
      h('span.tw-role', {}, m.role || 'Role not recorded yet'),
      h('span.tw-avail', { style: `color:${look.state === 'unknown' ? 'var(--muted)' : look.color}` }, look.label),
    ),
    h('p.tw-checked', {}, checkedLine(m, now)),
    ...rows,
    m.fromFiles ? h('details.tw-files', {}, h('summary', {}, 'From your files'), h('p', {}, m.fromFiles)) : null,
    h('div.tw-actions', {}, ...actions),
  );
}

// ---- An agent -------------------------------------------------------------------------------------

function agentCard(w: WorkerInfo, now: number): HTMLElement {
  const st = agentStatus(w);
  const seat = host!.plan().byId.get(w.deskId)?.label ?? w.deskId;
  const since = (w.status === 'needs_input' || w.status === 'done') && w.waitingSince ? ` · ${st.label.toLowerCase()} since ${timeAgo(w.waitingSince)}` : '';
  const task = w.title || w.prompt;
  return h(
    'article.tw-agent-card',
    { class: st.tone, style: `--agent:${w.color}` },
    h('header', {}, h('span.tw-bot', { title: 'Agent' }, '🤖'), h('strong', {}, w.name), h('span.tw-tag', {}, 'AGENT'), h('span.tw-status', { class: st.tone }, st.label)),
    h('p.tw-model', {}, engineLabel(w, store.project)),
    h('p.tw-task', {}, task ? clip(task, 180) : h('span.tw-empty', {}, 'No task recorded')),
    h('p.tw-meta', {}, `Seat: ${seat} · running ${lasted(now - w.createdAt)}${since}`),
    h('div.tw-actions', {}, h('button.btn', { type: 'button', onclick: () => host!.goTo(w.id) }, 'Go to'), h('button.btn', { type: 'button', onclick: () => host!.openTerminal(w.id) }, 'Terminal')),
  );
}

// ---- The windows ----------------------------------------------------------------------------------

function legend(): HTMLElement {
  return h(
    'ul.tw-legend',
    {},
    h('li', {}, h('span.tw-key-circle'), ' A person, coloured by whether they are free'),
    h('li', {}, h('span.tw-key-square'), ' An agent, in its own colour'),
    h('li', {}, h('span.tw-key-desk'), ' A person’s desk · ', h('span.tw-key-row'), ' The agents’ rows'),
    h('li', {}, 'Remote colleagues are not on the plan: they are on the wall screen in the real room'),
  );
}

/** Opens the team window (or does nothing when it is open already). */
export function openTeam() {
  if (open || !host) return;
  const drafts = new Map<string, Draft>();
  const body = h('div.body.tw-body');
  const meta = h('span.tw-meta-top');
  let pending = false;
  let tick = 0;
  const modal = openModal(h('div.modal.tw', { role: 'dialog', 'aria-label': 'Team', style: 'width:min(1180px,100%)' }, h('header', {}, h('h2', {}, '🧑‍🤝‍🧑 Team'), meta), body), {
    doing: 'looking at the team',
    onClose: () => {
      open = null;
      redraws.delete(render);
      clearInterval(tick);
    },
  });
  open = modal;

  function render() {
    if (typing(body)) {
      pending = true;
      return;
    }
    pending = false;
    const now = Date.now();
    const t = readTeam();
    const agents = agentsHere();
    meta.textContent = t?.members.length ? `${t.members.length} people${tally(t, now) ? `: ${tally(t, now)}` : ''} · ${agents.length} agent${agents.length === 1 ? '' : 's'}` : '';
    const people = h('section.tw-people', {}, h('h3', {}, '🧑 People', h('small', {}, t?.calendarAt ? ` calendar read ${timeAgo(t.calendarAt)}` : ' calendar not read yet')));
    if (!t) people.append(h('p.tw-empty-block', {}, 'Waiting for the office to say who is on the team.'));
    else if (!t.members.length) people.append(h('p.tw-empty-block', {}, 'No team recorded yet. Add the people to the office’s team file (see docs/team.md) and they show up here.'));
    else for (const m of t.members) people.append(personCard(m, now, drafts, render));
    const bots = h('section.tw-agents', {}, h('h3', {}, '🤖 Agents working with you', h('small', {}, ' started from this office')));
    if (!agents.length) bots.append(h('p.tw-empty-block', {}, 'No agents are running on this floor.'));
    for (const w of agents) bots.append(agentCard(w, now));
    const toRow = (id: string) => body.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    body.replaceChildren(
      ...(t?.error ? [h('p.tw-error', { role: 'alert' }, `The team file has a problem: ${t.error}`)] : []),
      h('div.tw-grid', {}, h('div.tw-left', {}, floorPlan(t, now, toRow), legend()), h('div.tw-right', {}, people, bots)),
    );
  }
  // A redraw that waited for the cursor to leave a field runs once it has.
  body.addEventListener('focusout', () => {
    if (pending) setTimeout(() => !typing(body) && render());
  });
  // Availability goes stale with time, and "running for" counts up.
  tick = window.setInterval(render, 30_000);
  redraws.add(render);
  render();
}

/** A small window with one person's card: for E on someone in the room. */
export function openPersonCard(id: string) {
  if (!host) return;
  const drafts = new Map<string, Draft>();
  const body = h('div.body.tw-card-body');
  const modal = openModal(h('div.modal.tw', { role: 'dialog', 'aria-label': 'Colleague', style: 'width:min(480px,100%)' }, h('header', {}, h('h2', {}, 'Colleague')), body), {
    doing: 'looking at the team',
    onClose: () => redraws.delete(render),
  });
  function render() {
    if (typing(body)) return;
    const m = readTeam()?.members.find((x) => x.id === id);
    if (!m) return void body.replaceChildren(h('p.tw-empty-block', {}, 'This person is not on the team any more.'));
    body.replaceChildren(personCard(m, Date.now(), drafts, render), h('button.btn', { type: 'button', onclick: () => (modal.close(), openTeam()) }, 'Open the team window'));
  }
  redraws.add(render);
  render();
}
