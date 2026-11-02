import type { MapPlan } from '../../../shared/maps';
import { PEOPLE_DESKS } from '../../../shared/maps/agentix';
import { deskAt, deskMoves, deskSize, dropEdit, withMoves, type DeskMoves, type DropTarget } from '../../../shared/desks';
import type { TeamEdit, TeamMember, TeamState } from '../../../shared/team';
import { h } from '../../ui/dom';
import { agentStatus, agentsHere, deskById, initials, lookOf, occupants, seatPoint } from './controller';

// The floor plan in the team window, and moving people between desks on it. Each person with a desk is
// a round marker on it; the ones without a desk wait in the "No desk yet" tray under it. Drag a marker
// (or a name in the tray) onto a free desk to give it, onto a taken desk to swap with whoever has it,
// onto the tray to take the desk away; let go anywhere else and nothing changes. A plain click opens
// the person's card. What a drop means is worked out by shared/desks.ts, so this file only draws,
// follows the pointer and says what happened. Nothing moves for good until the server has said so: the
// marker shows its new place meanwhile, and goes back with the reason if the server says no.

/** What changing a desk needs of the window (the dropdown on a card uses this part alone). */
export interface DeskHost {
  /** Whether this person may change the team (admins only). */
  canEdit(): boolean;
  /** Sends the change to the server. */
  send(edit: TeamEdit): void;
  /** Redraws the open team windows. */
  redraw(): void;
}

/** What the plan needs on top of that. */
export interface PlanHost extends DeskHost {
  plan(): MapPlan;
  /** A click on someone's marker. */
  onPerson(id: string): void;
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

// ---- A change on its way ---------------------------------------------------------------------------

/** How long the plan shows a change before the server has confirmed it, then goes back to what the server says. */
const PENDING_MS = 3000;
/** How long a message under the plan stays. */
const NOTE_MS = 7000;
/** How far the pointer has to travel before a press is a drag and not a click, in pixels. */
const DRAG_PX = 5;
const NOT_ADMIN = 'Only admins can change the team, so desks can’t be moved from here.';

let pending: { moves: DeskMoves; timer: number } | null = null;
let note = '';
let noteTimer = 0;
let last: DeskHost | null = null;

/** Says something under the plan (and in every plan that is open). */
function say(text: string) {
  note = text;
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => say(''), NOTE_MS);
  for (const el of document.querySelectorAll('.tw-plan-note')) el.textContent = text;
}

function forget() {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}

/** The team as the plan shows it: the server's, with a change still on its way already made. */
function shown(t: TeamState | null): TeamState | null {
  return t && pending ? { ...t, members: withMoves(t.members, pending.moves) } : t;
}

/**
 * Sends one change of desks and shows it at once. A change that can't be made says why instead. The
 * server's answer (the team coming back, see `settled`; or a refusal, see `rejected`) ends the wait.
 */
export function requestEdit(host: DeskHost, members: readonly TeamMember[], edit: TeamEdit) {
  last = host;
  if (!host.canEdit()) return say(NOT_ADMIN);
  const r = deskMoves(members, edit);
  if ('error' in r) return say(r.error);
  if (!Object.keys(r.moves).length) return;
  forget();
  host.send(edit);
  pending = {
    moves: r.moves,
    timer: window.setTimeout(() => {
      pending = null;
      host.redraw();
    }, PENDING_MS),
  };
  host.redraw();
}

/** The team came from the server: whatever was waiting for it has been answered. */
export function settled() {
  forget();
}

/** The server turned a change down (it said why): the markers go back and the reason is under the plan. */
export function rejected(reason: string) {
  if (!pending) return;
  forget();
  say(reason);
  last?.redraw();
}

// ---- The dropdown ----------------------------------------------------------------------------------

/**
 * The desk dropdown on a person's card: the keyboard's way to do what dragging does, with the same
 * outcome. A desk someone else has is offered as a swap.
 */
export function deskSelect(m: TeamMember, members: readonly TeamMember[], host: DeskHost): HTMLSelectElement {
  const taken = occupants({ members: [...members] });
  const desk = h(
    'select',
    {
      'aria-label': `Desk for ${m.name}`,
      disabled: !host.canEdit(),
      title: host.canEdit() ? '' : NOT_ADMIN,
      onchange: (e: Event) => {
        const select = e.target as HTMLSelectElement;
        const edit = dropEdit(members, m.id, select.value ? { kind: 'desk', desk: select.value } : { kind: 'tray' });
        if (edit) requestEdit(host, members, edit);
        // Out of the field, so the windows redraw with what the server says.
        select.blur();
      },
    },
    h('option', { value: '' }, 'No desk yet'),
    ...PEOPLE_DESKS.map((d) => {
      const other = taken.get(d.id);
      return h('option', { value: d.id }, other && other.id !== m.id ? `${d.name}: swap with ${other.name}` : d.name);
    }),
  ) as HTMLSelectElement;
  desk.value = m.desk ?? '';
  return desk;
}

// ---- Dragging --------------------------------------------------------------------------------------

interface Drag {
  id: string;
  x: number;
  y: number;
  moved: boolean;
  /** A press by someone who can't change the team: it is a click or nothing. */
  refused: boolean;
  ghost: HTMLElement | null;
  target: DropTarget;
}
let drag: Drag | null = null;
/** Whether a redraw was asked for while a marker was held. */
let blocked = false;

/** Whether someone is in the middle of a drag: the window waits to redraw until they let go. */
export function planBusy(): boolean {
  if (drag) blocked = true;
  return drag !== null;
}

function labelOf(m: TeamMember | undefined): string {
  return m ? m.name : '';
}

/** Makes `el` something to press and drag: a click calls `onClick`, a drag ends in a drop on the plan or the tray. */
function draggable(el: Element, m: TeamMember, host: PlanHost, root: SVGSVGElement, tray: HTMLElement, members: readonly TeamMember[], look: { color: string }) {
  el.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.button !== 0 || drag) return;
    drag = { id: m.id, x: e.clientX, y: e.clientY, moved: false, refused: false, ghost: null, target: { kind: 'none' } };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    if (!drag || drag.id !== m.id || drag.refused) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
      if (!host.canEdit()) {
        drag.refused = true;
        say(NOT_ADMIN);
        return;
      }
      drag.moved = true;
      drag.ghost = h('div.tw-ghost', {}, h('span.tw-ghost-dot', { style: `background:${look.color}` }, initials(m.name)), h('span.tw-ghost-name', {}, m.name));
      document.body.append(drag.ghost);
      el.classList.add('dragging');
    }
    drag.ghost!.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 10}px)`;
    drag.target = targetAt(e.clientX, e.clientY, root, tray);
    markTarget(root, tray, drag.target, m, members);
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    const d = drag;
    if (!d || d.id !== m.id) return;
    drag = null;
    d.ghost?.remove();
    el.classList.remove('dragging');
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    markTarget(root, tray, { kind: 'none' }, m, members);
    if (!cancelled) {
      if (!d.moved && !d.refused) host.onPerson(m.id);
      else if (d.moved) {
        const edit = dropEdit(members, m.id, d.target);
        if (edit) requestEdit(host, members, edit);
      }
    }
    // Whatever the team did while it was held waits no longer. (A plain click leaves the window as it is.)
    if (d.moved || blocked) host.redraw();
    blocked = false;
  };
  el.addEventListener('pointerup', (e) => end(e as PointerEvent, false));
  el.addEventListener('pointercancel', (e) => end(e as PointerEvent, true));
  el.addEventListener('lostpointercapture', (e) => end(e as PointerEvent, true));
}

/** What a point on the screen is over: the tray, a desk, or nothing. */
function targetAt(cx: number, cy: number, root: SVGSVGElement, tray: HTMLElement): DropTarget {
  const inside = (r: DOMRect) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  if (inside(tray.getBoundingClientRect())) return { kind: 'tray' };
  if (!inside(root.getBoundingClientRect())) return { kind: 'none' };
  const m = root.getScreenCTM();
  if (!m) return { kind: 'none' };
  const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
  const desk = deskAt(p.x, p.y);
  return desk ? { kind: 'desk', desk } : { kind: 'none' };
}

/** Lights up what a drop would land on (and says, on the ghost, whether it swaps). */
function markTarget(root: SVGSVGElement, tray: HTMLElement, target: DropTarget, who: TeamMember, members: readonly TeamMember[]) {
  for (const el of root.querySelectorAll('.drop, .swap')) el.classList.remove('drop', 'swap');
  tray.classList.toggle('drop', target.kind === 'tray');
  const ghost = document.querySelector('.tw-ghost-name');
  if (ghost) ghost.textContent = who.name;
  if (target.kind !== 'desk') return;
  const rect = root.querySelector(`[data-desk="${CSS.escape(target.desk)}"]`);
  const holder = members.find((x) => x.desk === target.desk && x.id !== who.id);
  rect?.classList.add(holder ? 'swap' : 'drop');
  if (ghost && holder) ghost.textContent = `${who.name} ⇄ ${labelOf(holder)}`;
}

// ---- The plan --------------------------------------------------------------------------------------

/** The plan of the rooms with everyone on it, the "No desk yet" tray under it, and a line for what just happened. */
export function planView(real: TeamState | null, now: number, host: PlanHost): HTMLElement {
  last = host;
  const t = shown(real);
  const members = real?.members ?? [];
  const plan = host.plan();
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
    const s = deskSize(d);
    root.append(svg('rect', { x: d.x - s.w / 2, y: d.z - s.l / 2, width: s.w, height: s.l, 'data-desk': d.id, class: sitting.has(d.id) ? 'tw-desk taken' : 'tw-desk' }, svg('title', {}, d.name)));
  }
  const tray = h('div.tw-tray', { 'aria-label': 'No desk yet' }, h('strong.tw-tray-title', {}, 'No desk yet'));
  const editable = host.canEdit();
  const waiting: TeamMember[] = [];
  for (const m of t?.members ?? []) {
    if (m.remote) continue;
    const d = deskById(m.desk);
    if (!d) {
      waiting.push(m);
      continue;
    }
    const look = lookOf(m, now);
    const at = seatPoint(d);
    const g = svg(
      'g',
      { class: `tw-person${editable ? '' : ' noedit'}`, transform: `translate(${at.x} ${at.z})`, 'data-person': m.id },
      svg('title', {}, `${m.name}: ${look.label}`),
      svg('circle', { r: 0.6, fill: look.color, class: 'tw-circle' }),
      svg('text', { class: 'tw-initials' }, initials(m.name)),
    );
    draggable(g, m, host, root, tray, members, look);
    root.append(g);
  }
  if (!waiting.length) tray.append(h('span.tw-tray-empty', {}, t?.members.length ? 'Everyone has a desk. Drop someone here to take their desk away.' : ''));
  for (const m of waiting) {
    const look = lookOf(m, now);
    const chip = h(
      'span.tw-waiter',
      { class: editable ? '' : 'noedit', 'data-person': m.id, title: `${m.name}: ${look.label}` },
      h('span.tw-ghost-dot', { style: `background:${look.color}` }, initials(m.name)),
      h('span.tw-waiter-name', {}, m.name),
    );
    draggable(chip, m, host, root, tray, members, look);
    tray.append(chip);
  }
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
  const help = !t?.members.length ? '' : editable ? 'Drag a person onto a desk. A desk someone has is swapped. Drop on the tray to take the desk away.' : NOT_ADMIN;
  return h('div.tw-planbox', {}, root, tray, h('p.tw-plan-help', {}, help), h('p.tw-plan-note', { role: 'status', 'aria-live': 'polite' }, note));
}
