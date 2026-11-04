import type { MapConfig, PropConfig } from './types.js';

/*
 * agentix: the office at Widenmayerstraße 48, in Munich's Lehel, one floor up, its window looking out
 * over the trees toward the Eisbach. The room at the north-west is the real one, as far as two photos
 * can say: sizes are estimates, nobody has measured it. Everything else (the second desk room, the
 * corridor, the meeting room and the board room) is made up, since the office needs 32 seats, board
 * agents and a meeting table, and the photos show six desks in one room.
 *
 * It's data, like the castle (./castle.ts). -z is the way the window looks: see OUTLOOK.
 */

const W = 24;
const L = 18;
const H = 4;

/** Where the building stands and how it's turned, for what's outside (world/agentix/outside.ts). */
export const OUTLOOK = {
  /** The address point of Widenmayerstraße 48 in OpenStreetMap. */
  lat: 48.1488592,
  lon: 11.5964165,
  /** The compass bearing the window looks along (-z): straight at the Eisbach, 54 m off. */
  bearing: 314,
  /** How far the floor is above the ground outside: the first floor of an old building. */
  floorY: 4.5,
} as const;

/** The real room's walls. */
export const REAL_ROOM = { minX: -12, maxX: -5.6, minZ: -9, maxZ: -1 } as const;

const ALONG_X = Math.PI / 2;
/** A piece of inside wall along x, from x0 to x1. */
const wallX = (z: number, x0: number, x1: number): PropConfig => ({ kind: 'wall', x: (x0 + x1) / 2, z, length: x1 - x0, rotY: ALONG_X });
/** A piece of inside wall along z, from z0 to z1. */
const wallZ = (x: number, z0: number, z1: number): PropConfig => ({ kind: 'wall', x, z: (z0 + z1) / 2, length: z1 - z0, rotY: 0 });
const doorX = (z: number, x: number): PropConfig => ({ kind: 'doorway', x, z, width: 1.4, rotY: ALONG_X });

const props: PropConfig[] = [
  // The walls between the rooms, with gaps for the doorways below.
  wallZ(-5.5, -9, -1),
  wallX(-0.9, -12, -9.3),
  wallX(-0.9, -7.9, 2.8),
  wallX(-0.9, 4.2, 12),
  wallX(1.7, -12, -3.2),
  wallX(1.7, -1.8, 5.3),
  wallX(1.7, 6.7, 12),
  wallZ(0, 1.8, 9),
  doorX(-0.9, -8.6),
  doorX(-0.9, 3.5),
  doorX(1.7, -2.5),
  doorX(1.7, 6),

  // The real room: its window (six panes, three across), the radiator under it, plants on the sill.
  { kind: 'window', x: -8.7, z: -9, y: 0.85, width: 2.6, height: 2.6 },
  { kind: 'radiator', x: -8.7, z: -8.84, width: 2.8 },
  { kind: 'plant', x: -9.5, z: -8.82, y: 0.9, scale: 0.8 },
  { kind: 'plant', x: -7.7, z: -8.82, y: 0.9 },
  // The dark wardrobe in the corner, by the window.
  { kind: 'armoire', x: -11.1, z: -8.62, width: 1.3, length: 0.7, height: 2.3 },
  // The big monitor on the desk by the west wall, the curved one on the desk by the east wall.
  { kind: 'monitor', x: -10.9, z: -3, y: 0.78, rotY: 0, width: 0.72 },
  { kind: 'monitor', x: -6.05, z: -2.55, y: 0.78, rotY: -Math.PI / 2, width: 0.86, height: 0.34 },
  { kind: 'basket', x: -11.6, z: -1.5 },

  // The made-up rooms.
  ...[-1, 4.5, 9.5].flatMap((x): PropConfig[] => [
    { kind: 'window', x, z: -9, y: 0.85, width: 2.6, height: 2.6 },
    { kind: 'radiator', x, z: -8.84, width: 2.8 },
  ]),
  { kind: 'plant', x: -4.9, z: -8.3, scale: 1.4 },
  { kind: 'plant', x: 11.4, z: 8.4, scale: 1.4 },
  { kind: 'lamp', x: 3.3, z: -5, y: 3.1 },
  { kind: 'lamp', x: -7, z: 5.8, y: 3.1 },
  { kind: 'lamp', x: 6, z: 5.4, y: 3.1 },
  { kind: 'lamp', x: 0, z: 0.4, y: 3.3 },
  { kind: 'lamp', x: -8.8, z: -5, y: 3.3 },

  // The corridor: something to ring when a pull request merges, and coffee.
  { kind: 'gong', x: -10.8, z: 0.4, rotY: ALONG_X },
  { kind: 'coffee', x: 8.5, z: 1.25, rotY: Math.PI },
];

/**
 * A desk where a person of the team sits (see shared/team.ts), as opposed to the worker seats at the
 * long rows next door. `rotY` is the way from the desk to the person sitting at it (0 is +z, as for any
 * seat), and `along` the way the desk itself runs. Nobody is put at a desk here: the owner assigns
 * them in the app. Only these desks are built by the persondesk prop below, one for each.
 */
export interface PersonDesk {
  id: string;
  name: string;
  x: number;
  z: number;
  rotY: number;
  along: 'x' | 'z';
}

export const PEOPLE_DESKS: readonly PersonDesk[] = [
  // The real room's six desks, as the photos show them (positions and sides are estimates).
  { id: 'west', name: 'West desk', x: -10.9, z: -3.1, rotY: 0, along: 'x' },
  { id: 'middle', name: 'Middle desk', x: -10.3, z: -3.95, rotY: Math.PI, along: 'x' },
  { id: 'armoire', name: 'Armoire desk', x: -10.9, z: -6.95, rotY: 0, along: 'x' },
  { id: 'whiteboard', name: 'Whiteboard desk', x: -7, z: -5.95, rotY: 0, along: 'x' },
  { id: 'window', name: 'Window desk', x: -6.5, z: -6.75, rotY: Math.PI, along: 'x' },
  { id: 'door', name: 'Door desk', x: -6.1, z: -2.55, rotY: -ALONG_X, along: 'z' },
  // Made up: two more in the board room, because eight people work on site and the photos show six desks.
  { id: 'board-1', name: 'Board room desk 1', x: 4.8, z: 4.8, rotY: Math.PI, along: 'x' },
  { id: 'board-2', name: 'Board room desk 2', x: 7.4, z: 4.8, rotY: Math.PI, along: 'x' },
];

/** A person's desk as a prop: it is walked round, and drawn by the builder (world/agentix/). */
const personDesk = (d: PersonDesk): PropConfig => ({ kind: 'persondesk', id: d.id, x: d.x, z: d.z, rotY: d.rotY, width: 1.8, length: 0.8 });
props.push(...PEOPLE_DESKS.map(personDesk));

export const AGENTIX: MapConfig = {
  id: 'agentix',
  name: 'agentix',
  icon: '🥨',
  description: 'The agentix office at Widenmayerstraße 48, Munich: one floor up in the Lehel, the Eisbach beyond the trees outside the window.',
  style: 'agentix',
  hall: { width: W, length: L, height: H },
  spawn: { x: -8.6, z: -3.5, rotY: Math.PI },
  door: { x: 11.2, z: 0.4 },
  tables: [
    // All the worker seats are next door, in two long rows: 8 a side, 32 in all. The six real desks and
    // two more are for people instead (see PEOPLE_DESKS).
    { name: 'North row', x: 3.3, z: -6.7, length: 15.2, width: 0.8, rotY: ALONG_X, seats: 8 },
    { name: 'South row', x: 3.3, z: -3.3, length: 15.2, width: 0.8, rotY: ALONG_X, seats: 8 },
  ],
  stations: {
    issues: { x: 10.4, z: 3.6, rotY: ALONG_X },
    pulls: { x: 10.4, z: 7.2, rotY: ALONG_X },
    queue: { x: 1.6, z: 5.4, rotY: -ALONG_X },
  },
  council: { x: -7, z: 5.8, rotY: 0 },
  boards: {
    // The whiteboard on the real room's east wall.
    queue: { x: -5.62, y: 1.85, z: -4.6, rotY: -ALONG_X, width: 2.2, height: 1.3 },
    issues: { x: W / 2 - 0.08, y: 1.9, z: 3.6, rotY: -ALONG_X, width: 2.6, height: 1.7 },
    pulls: { x: W / 2 - 0.08, y: 1.9, z: 7.2, rotY: -ALONG_X, width: 2.6, height: 1.7 },
    services: { x: 6, y: 1.9, z: L / 2 - 0.08, rotY: Math.PI, width: 2.6, height: 1.7 },
  },
  props,
  agents: { outfit: 'none', ageMinutes: 0 },
  palette: { wall: '#f3eee2', trim: '#fbf8f1', floor: '#85888c', wood: '#2e2b2d', desk: '#f4f2ec', frame: '#f1efe9', mesh: '#c8b698' },
};
