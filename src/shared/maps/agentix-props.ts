import type { Circle, Rect } from '../nav.js';
import { boxFootprint } from './props.js';
import type { PropConfig } from './types.js';

/*
 * The pieces an agentix-style map can put up (MapConfig.props), and how much floor each takes, as
 * ./props.ts has the castle's. How each one looks is the builder's (world/agentix/).
 */

export const AGENTIX_PROP_KINDS = {
  /** An inside wall, floor to ceiling, `length` long along `rotY` (0 runs along z, π/2 along x). */
  wall: 'An inside wall',
  /** The frame of a way through an inside wall, and the wall over it: `width` across, along `rotY`. */
  doorway: 'A doorway through an inside wall',
  /** A tall casement window cut through the outside wall at `z`, its sill at `y`, `width` by `height`. */
  window: 'A tall casement window',
  /** A radiator behind a lattice cover, under a window, `width` wide. */
  radiator: 'A radiator behind a lattice cover',
  /** A potted plant, on the floor or on a sill at `y`. */
  plant: 'A potted plant',
  /** The dark carved wardrobe, with antlers and the Shipping block on top: `width` by `length`, `height` high. */
  armoire: 'A dark carved wardrobe',
  /** A monitor on a desk at `y`, facing `rotY`, `width` across; `height` under 0.4 makes it the curved wide one. */
  monitor: 'A monitor on a desk',
  /** A wire waste basket. */
  basket: 'A wire waste basket',
  /** A ceiling lamp, hanging down to `y`. */
  lamp: 'A ceiling lamp',
  /** The gong a merged pull request rings (one per map). */
  gong: 'The merge gong',
  /** A coffee machine on a counter: a cup perks you up. */
  coffee: 'A coffee machine',
  /**
   * A desk where a person of the team sits (see PEOPLE_DESKS), not a worker. `id` is its id there, `rotY` the way
   * from the desk to the person sitting at it (the same as a seat's: 0 is +z), `width` the desk's length across
   * that (1.8 unless it says) and `length` its depth (0.8).
   */
  persondesk: 'A desk for a person of the team',
} as const;

export type AgentixPropKind = keyof typeof AGENTIX_PROP_KINDS;

const WALL_T = 0.2;

/** How much floor a prop takes (what the workers walk round): nothing for what hangs or stands on a desk. */
export function agentixFootprint(p: PropConfig): { rect?: Rect; circle?: Circle } | null {
  const s = p.scale ?? 1;
  switch (p.kind as AgentixPropKind) {
    case 'wall':
      return { rect: boxFootprint(p.x, p.z, WALL_T, p.length ?? 1, p.rotY ?? 0) };
    case 'radiator':
      return { rect: boxFootprint(p.x, p.z, p.width ?? 2.8, 0.3, p.rotY ?? 0) };
    case 'armoire':
      return { rect: boxFootprint(p.x, p.z, p.width ?? 1.25, p.length ?? 0.65, p.rotY ?? 0) };
    case 'plant':
      return p.y ? null : { circle: [p.x, p.z, 0.3 * s] };
    case 'basket':
      return { circle: [p.x, p.z, 0.2] };
    case 'gong':
      return { circle: [p.x, p.z, 0.7] };
    case 'coffee':
      return { rect: boxFootprint(p.x, p.z, 1.2, 0.6, p.rotY ?? 0) };
    case 'persondesk':
      // The desk runs across the way the person faces: its depth is along rotY.
      return { rect: boxFootprint(p.x, p.z, p.length ?? 0.8, p.width ?? 1.8, (p.rotY ?? 0) + Math.PI / 2) };
    default:
      return null;
  }
}

/** How high a prop reaches. */
export function agentixTop(p: PropConfig): number {
  switch (p.kind as AgentixPropKind) {
    case 'window':
      return (p.y ?? 0.85) + (p.height ?? 2.6);
    case 'armoire':
      return (p.height ?? 2.3) + 0.3;
    case 'lamp':
      return p.y ?? 3;
    case 'monitor':
      return (p.y ?? 0.78) + 0.6;
    case 'plant':
      return (p.y ?? 0) + 1;
    case 'gong':
      return 2.4;
    case 'radiator':
      return 0.85;
    case 'coffee':
      return 1.5;
    case 'persondesk':
      return 1.2;
    case 'basket':
      return 0.4;
    default:
      return 0;
  }
}
