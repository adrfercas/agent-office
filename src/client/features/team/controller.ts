import { AVAILABILITY_LOOK, availabilityNow, type Availability, type TeamEdit, type TeamMember, type TeamState } from '../../../shared/team';
import type { WorkerInfo } from '../../../shared/protocol';
import { PEOPLE_DESKS, type PersonDesk } from '../../../shared/maps/agentix';
import type { Net } from '../../net';
import { store } from '../../state';

// What the team window knows: the team as the server last said it, and the plain facts worked out from
// it (who is free, who sits where, where each marker goes on the floor plan). No DOM here: ui.ts draws.

/** The team as the server last said it, or null before it has (or when what's there isn't a team). */
export function readTeam(): TeamState | null {
  return store.people;
}

/** Sends the owner's change to the server (see TeamEdit): it writes it to the team file and tells everyone. */
export function sendEdit(net: Net, edit: TeamEdit) {
  net.send({ t: 'people.edit', edit });
}

export const deskById = (id: string | null): PersonDesk | undefined => (id === null ? undefined : PEOPLE_DESKS.find((d) => d.id === id));

/** Who sits at a person's desk, by desk id. */
export function occupants(t: TeamState): Map<string, TeamMember> {
  const by = new Map<string, TeamMember>();
  for (const m of t.members) if (m.desk && !m.remote) by.set(m.desk, m);
  return by;
}

/** How someone shows right now: the state the calendar's answer still stands for, its colour and words, and whether an old answer was dropped. */
export function lookOf(m: TeamMember, now: number): { state: Availability; color: string; label: string; stale: boolean } {
  const state = availabilityNow(m.availability, now);
  const stale = m.availability.state !== 'unknown' && state === 'unknown';
  return { state, ...AVAILABILITY_LOOK[state], stale };
}

/** "3 free, 2 busy, 1 unknown": how the people stand, leaving out what nobody is. */
export function tally(t: TeamState, now: number): string {
  const n: Record<Availability, number> = { free: 0, busy: 0, away: 0, unknown: 0 };
  for (const m of t.members) n[lookOf(m, now).state]++;
  return (Object.keys(n) as Availability[])
    .filter((k) => n[k] > 0)
    .map((k) => `${n[k]} ${AVAILABILITY_LOOK[k].label.toLowerCase()}`)
    .join(', ');
}

/** Initials for a marker: the first letters of the first and last word, or what there is. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** "12 min", "2 h 10 min", "3 days": how long something has been going on. */
export function lasted(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** The agents on this floor, the ones that need you first. */
export function agentsHere(): WorkerInfo[] {
  const rank = (w: WorkerInfo) => (w.status === 'needs_input' ? 0 : w.status === 'working' ? 1 : w.status === 'done' ? 2 : 3);
  return [...store.workers.values()].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}

/** What an agent's status is called in the team window. */
export function agentStatus(w: WorkerInfo): { label: string; tone: 'working' | 'needs' | 'done' | 'rest' } {
  if (w.status === 'needs_input') return { label: 'Needs you', tone: 'needs' };
  if (w.status === 'working') return { label: 'Working', tone: 'working' };
  if (w.status === 'done') return { label: 'Done', tone: 'done' };
  return { label: w.status === 'offline' ? 'Asleep' : w.status === 'exited' ? 'Stopped' : w.status === 'starting' ? 'Starting' : 'Ready', tone: 'rest' };
}

/** Where a person's marker goes on the floor plan: on the chair side of their desk. */
export function seatPoint(d: PersonDesk): { x: number; z: number } {
  return { x: d.x + Math.sin(d.rotY) * 0.75, z: d.z + Math.cos(d.rotY) * 0.75 };
}

/** The corridor spot the n-th person without a desk stands at, by the real room's door (an estimate, as the room is). */
export function waitingSpot(n: number): { x: number; z: number } {
  return { x: -11 + (n % 8) * 0.7, z: 0.4 + Math.floor(n / 8) * 0.7 };
}
