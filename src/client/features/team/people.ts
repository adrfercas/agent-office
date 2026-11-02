import * as THREE from 'three';
import { lookFromSeed } from '../../../shared/avatar';
import { boxFootprint } from '../../../shared/maps/props';
import { AVAILABILITY_LOOK, availabilityNow, type Availability, type TeamMember, type TeamState } from '../../../shared/team';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { noOutline } from '../../core/outline';
import { Person } from '../../world/character';
import { TABLE_TOP, lit, placed } from '../../world/station/kit';
import type { Collider, Interactable } from '../../world/types';
import type { World } from '../../world/world';
import { TeamRoom, firstName, laptop, seatSpots, standingSpot, type SeatSpot, type Spot } from './world';

// The team in the room: each colleague who has a desk sits at it, the ones without a desk stand
// together in the corridor, and the remote ones are on the wall screen (world.ts). Everyone has a
// name tag (first name over their role) and a light over the head that follows what the calendar
// says about them now. Press E on someone for their card. Only on the agentix map: nothing is built
// anywhere else. Looks come from the person's id, so they are stable, and are nobody's likeness.

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    person: true;
  }
}

/** What the team's people need from the rest of the office. */
export interface PeopleDeps {
  /** The team as the store has it. */
  team(): TeamState;
  /** Opens someone's card (openPersonCard in ui.ts). */
  open(id: string): void;
}

/** How high the hips are above the floor on a desk chair (its seat is 0.5 m up). */
const SEAT_HIPS = 0.56;
const SHIRTS = ['#6f8fa5', '#a87a70', '#7d9b77', '#b39d6e', '#8c7fa8', '#628390', '#a38d7e', '#82919c'];
/** The hair each look may have (indexes of HAIR_STYLES): never bald, so nobody is a stand-in for anyone. */
const STYLES = { man: [0, 3, 4], woman: [1, 2, 5, 4] } as const;

/** One person's figure: the character, and the light over its head. */
class Figure {
  readonly person: Person;
  private light: THREE.Mesh;
  private state: Availability | null = null;
  private typing: number;

  constructor(
    readonly member: TeamMember,
    readonly at: Spot,
    readonly seated: boolean,
  ) {
    const seed = lookFromSeed(member.id);
    const styles = STYLES[member.look === 'woman' ? 'woman' : 'man'];
    const look = { skin: seed.skin, hair: seed.hair, style: styles[seed.style % styles.length] };
    this.person = new Person(firstName(member.name), SHIRTS[(seed.skin * 7 + seed.hair * 3 + seed.style) % SHIRTS.length], look);
    this.person.setLabel(firstName(member.name), null);
    this.person.setDoing(member.role);
    this.person.root.position.set(at.x, 0, at.z);
    this.person.root.rotation.y = at.rotY;
    this.typing = (seed.hair + seed.style) * 0.9;
    if (seated) this.person.sit(SEAT_HIPS);
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), lit('#9aa0a6'));
    this.light.position.y = this.person.bubbleY - 0.02;
    this.person.root.add(this.light);
    noOutline(this.person.root);
  }

  /** The light takes the colour of what the calendar says now. */
  setAvailability(state: Availability) {
    if (state === this.state) return;
    this.state = state;
    (this.light.material as THREE.MeshBasicMaterial).color.set(AVAILABILITY_LOOK[state].color);
  }

  update(dt: number, t: number) {
    this.person.update(dt, t, false, false);
    this.light.scale.setScalar(1 + Math.sin(t * 2 + this.typing) * 0.06);
    if (!this.seated) return;
    // Hands on the laptop or the keyboard, moving a little, and not all in step.
    const { armL, armR } = this.person.rig;
    armL.rotation.x = -1.15 + Math.sin(t * 9 + this.typing) * 0.05;
    armR.rotation.x = -1.15 + Math.sin(t * 8 + this.typing * 2) * 0.05;
  }

  dispose() {
    this.person.root.removeFromParent();
    this.person.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
  }
}

/** What the team has put into one world: the figures, the room's extras, and the colliders and interactables it added. */
class Stage {
  readonly group = new THREE.Group();
  private room: TeamRoom;
  private figures: Figure[] = [];
  private colliders: Collider[] = [];
  private interactables: Interactable[] = [];
  private things: THREE.Object3D[] = [];
  private seats = seatSpots();
  private sig = '';

  constructor(
    readonly world: World,
    private who: WeakMap<Interactable, string>,
  ) {
    world.group.add(this.group);
    this.room = new TeamRoom(world.group);
  }

  /** Whether a monitor stands on the desk already (the west and door desks have one), so no laptop is needed. */
  private hasMonitor(desk: Spot): boolean {
    return (this.world.plan.config?.props ?? []).some((p) => p.kind === 'monitor' && Math.hypot(p.x - desk.x, p.z - desk.z) < 0.7);
  }

  private clear() {
    for (const f of this.figures) f.dispose();
    this.figures = [];
    for (const o of this.things) o.removeFromParent();
    this.things = [];
    for (const c of this.colliders) this.world.colliders.splice(this.world.colliders.indexOf(c), 1);
    for (const it of this.interactables) this.world.interactables.splice(this.world.interactables.indexOf(it), 1);
    this.colliders = [];
    this.interactables = [];
  }

  private add(m: TeamMember, at: Spot, seated: boolean, desk?: Spot) {
    const fig = new Figure(m, at, seated);
    this.figures.push(fig);
    this.group.add(fig.person.root);
    const size = seated ? 0.55 : 0.5;
    const [minX, maxX, minZ, maxZ] = boxFootprint(at.x, at.z, size, size, 0);
    const col: Collider = { minX, maxX, minZ, maxZ, top: seated ? 1.3 : 2 };
    this.colliders.push(col);
    this.world.colliders.push(col);
    const it: Interactable = { kind: 'person', label: firstName(m.name), x: at.x, z: at.z, radius: 1.8 };
    this.who.set(it, m.id);
    fig.person.root.userData.interact = it;
    this.interactables.push(it);
    this.world.interactables.push(it);
    if (seated && desk && !this.hasMonitor(desk)) {
      const g = placed(desk.x, TABLE_TOP, desk.z, desk.rotY);
      const l = laptop();
      l.position.z = 0.05;
      g.add(l);
      this.group.add(g);
      this.things.push(g);
    }
  }

  /** Puts the team in the room as it is now: one pass, only when something about someone changed. */
  update(team: TeamState, dt: number, t: number, now: number) {
    const sig = team.members.map((m) => [m.id, m.name, m.role, m.look, m.remote, m.self, m.desk, availabilityNow(m.availability, now)].join('|')).join(';');
    if (sig !== this.sig) {
      this.sig = sig;
      this.clear();
      const taken = new Set<string>();
      let standing = 0;
      let mine: SeatSpot | null = null;
      for (const m of team.members) {
        const seat = m.desk ? this.seats.get(m.desk) : undefined;
        if (m.self) {
          // The owner walks about as themselves: no figure, only a plaque on their desk.
          if (seat && m.desk && !taken.has(m.desk)) {
            taken.add(m.desk);
            mine = seat;
          }
          continue;
        }
        if (m.remote) continue;
        if (seat && m.desk && !taken.has(m.desk)) {
          taken.add(m.desk);
          this.add(m, seat, true, seat.desk);
        } else {
          this.add(m, standingSpot(standing++), false);
        }
      }
      this.room.setStanding(standing);
      this.room.setMine(mine ? mine.desk : null);
    }
    this.room.setRemote(
      team.members.filter((m) => m.remote && !m.self),
      now,
    );
    for (const f of this.figures) {
      f.setAvailability(availabilityNow(f.member.availability, now));
      f.update(dt, t);
    }
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
    this.room.dispose();
  }
}

/** Puts the team in the agentix office (and takes it out again when the building is on another map), and says what E does at someone. */
export function installPeople(ctx: Ctx, deps: PeopleDeps) {
  const who = new WeakMap<Interactable, string>();
  let stage: Stage | null = null;

  ctx.interactions.define('person', {
    reach: 3.5,
    hint: (it) => {
      const m = deps.team().members.find((x) => x.id === who.get(it));
      if (!m) return { k: '', parts: [] };
      return { k: `${m.id}|${m.name}|${m.role}`, parts: [hintTitle(firstName(m.name)), aside(m.role), key('E', 'Open card')] };
    },
    use: onE((it) => {
      const id = who.get(it);
      if (id) deps.open(id);
    }),
  });

  ctx.ticks.add('others', ({ dt, t }) => {
    const world = ctx.world();
    const here = world.plan.style === 'agentix' ? world : null;
    if (stage && stage.world !== here) {
      stage.dispose();
      stage = null;
    }
    if (here && !stage) stage = new Stage(here, who);
    stage?.update(deps.team(), dt, t, Date.now());
  });
}
