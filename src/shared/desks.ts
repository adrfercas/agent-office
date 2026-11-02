/*
 * Who sits where: the rules for moving people between the desks, with no DOM and no file in them.
 * The team window uses them to turn a drop on the floor plan into one change (`dropEdit`) and to show
 * it before the server has answered (`withMoves`); the server uses the same `deskMoves` to check the
 * change and work out who ends up where, so the two can't disagree.
 */
import { PEOPLE_DESKS } from './maps/agentix.js';
import type { TeamEdit, TeamMember } from './team.js';

/** Where a dragged person was let go. */
export type DropTarget = { kind: 'desk'; desk: string } | { kind: 'tray' } | { kind: 'none' };

/** Each person whose desk changes, by id, and the desk they end up at (null: none). */
export type DeskMoves = Record<string, string | null>;

const DESK_IDS = new Set(PEOPLE_DESKS.map((d) => d.id));

/**
 * Who ends up where after `edit` (only its `desk` and `swapWith` count), or why it can't be done.
 * Giving a desk that someone else has needs `swapWith` to be that someone: the two then trade, so
 * nobody is left without a desk they had and nobody shares one. A move to the desk a person has is no move.
 */
export function deskMoves(members: readonly TeamMember[], edit: Pick<TeamEdit, 'id' | 'desk' | 'swapWith'>): { moves: DeskMoves } | { error: string } {
  const me = members.find((m) => m.id === edit.id);
  if (!me) return { error: 'There is nobody by that id on the team' };
  if (edit.desk === undefined) return edit.swapWith === undefined ? { moves: {} } : { error: 'A swap needs the desk to swap for' };
  if (edit.desk === null) return edit.swapWith === undefined ? { moves: me.desk === null ? {} : { [me.id]: null } } : { error: 'A swap needs a desk to swap for' };
  if (typeof edit.desk !== 'string' || !DESK_IDS.has(edit.desk)) return { error: 'There is no such desk' };
  if (me.remote) return { error: `${me.name} works remotely, so has no desk` };
  const holder = members.find((m) => m.desk === edit.desk && m.id !== me.id);
  if (edit.swapWith !== undefined && holder?.id !== edit.swapWith) {
    return { error: holder ? `That desk is ${holder.name}’s now, so nothing was changed` : 'That desk is free now, so nothing was changed' };
  }
  if (holder && edit.swapWith === undefined) return { error: `That desk is ${holder.name}’s` };
  if (me.desk === edit.desk) return { moves: {} };
  return { moves: holder ? { [me.id]: edit.desk, [holder.id]: me.desk } : { [me.id]: edit.desk } };
}

/** The team as it will be once `moves` have happened. */
export function withMoves(members: readonly TeamMember[], moves: DeskMoves): TeamMember[] {
  return members.map((m) => (m.id in moves ? { ...m, desk: moves[m.id] } : m));
}

/**
 * The one change that a drop of `personId` on `target` asks for, or null when nothing should happen
 * (let go on the floor, on the desk they have already, or in the tray with no desk to give up).
 * A taken desk is a swap.
 */
export function dropEdit(members: readonly TeamMember[], personId: string, target: DropTarget): TeamEdit | null {
  const me = members.find((m) => m.id === personId);
  if (!me || me.remote || target.kind === 'none') return null;
  if (target.kind === 'tray') return me.desk === null ? null : { id: me.id, desk: null };
  if (me.desk === target.desk) return null;
  const holder = members.find((m) => m.desk === target.desk && m.id !== me.id);
  return holder ? { id: me.id, desk: target.desk, swapWith: holder.id } : { id: me.id, desk: target.desk };
}

/** A desk's size on the plan, in metres. */
export function deskSize(d: { along: 'x' | 'z' }): { w: number; l: number } {
  return d.along === 'x' ? { w: 1.8, l: 0.8 } : { w: 0.8, l: 1.8 };
}

/** How far from a desk's middle or its chair a drop still counts as on that desk, in metres. */
const REACH = 1.1;

/**
 * Which desk a point on the plan (x, z in metres) is on: the one it is over, else the nearest whose
 * desk or chair is within reach, else null.
 */
export function deskAt(x: number, z: number): string | null {
  const over = PEOPLE_DESKS.filter((d) => {
    const s = deskSize(d);
    return Math.abs(x - d.x) <= s.w / 2 + 0.2 && Math.abs(z - d.z) <= s.l / 2 + 0.2;
  });
  const dist = (d: (typeof PEOPLE_DESKS)[number]) => {
    const seat = { x: d.x + Math.sin(d.rotY) * 0.75, z: d.z + Math.cos(d.rotY) * 0.75 };
    return Math.min(Math.hypot(x - d.x, z - d.z), Math.hypot(x - seat.x, z - seat.z));
  };
  const pool = over.length ? over : PEOPLE_DESKS.filter((d) => dist(d) <= REACH);
  let best: string | null = null;
  let bestD = Infinity;
  for (const d of pool) {
    const v = dist(d);
    if (v < bestD) {
      bestD = v;
      best = d.id;
    }
  }
  return best;
}
