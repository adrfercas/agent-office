import * as THREE from 'three';
import type { DeskDef } from '../../../shared/layout';
import type { FloorPalette } from '../../../shared/floors';
import type { MapPlan } from '../../../shared/maps';
import type { AgentixPropKind } from '../../../shared/maps/agentix-props';
import { NavGrid, type Pt } from '../../../shared/nav';
import { MAX_LIGHTS, placed } from '../station/kit';
import { agentConsole, buildBriefing, placeSetting } from '../station/seats';
import { mergeByMaterial, textPlane } from '../toon';
import type { Interactable } from '../types';
import type { World } from '../world';
import { FURNISHING_PROPS } from './decor';
import { buildBoards, buildDesks, deskChair } from './furniture';
import { makeKit } from './kit';
import { buildLehel } from './outside';
import { ARCHITECTURE_PROPS, buildShell } from './shell';

/*
 * The agentix style of map (see shared/maps/agentix.ts for the office itself): the office at
 * Widenmayerstraße 48 in Munich's Lehel, one floor up, with a tall window onto the trees. The real
 * room is modelled on two photos; the rooms around it are made up. Everything is placed from the
 * map's plan, so another map in this style is just other numbers.
 *
 * It goes up a part at a time, each in a file beside this one: the shell with the architecture props
 * (shell.ts), the furniture and the boards (furniture.ts), the other props (decor.ts), and what is
 * outside the window (outside.ts). What they build with is in kit.ts. The board agents' consoles, the
 * briefing table and the places at the desks are the station's (../station/seats), in calmer colours.
 */

const PROPS = { ...ARCHITECTURE_PROPS, ...FURNISHING_PROPS };

/** Puts up the office in `plan` (an agentix-style map). */
export function buildAgentix(plan: MapPlan): World {
  const c = plan.config!;
  const H = plan.height;
  const kit = makeKit(plan);
  const { group } = kit;

  const shell = buildShell(kit);
  for (const p of c.props ?? []) PROPS[p.kind as AgentixPropKind](kit, p);
  buildDesks(kit);
  // A place at the desk, with the worker's mesh chair standing where they sit.
  const seat = (def: DeskDef, overflow: boolean) => {
    const made = placeSetting(kit, def, overflow);
    const chair = deskChair(kit);
    chair.position.set(0, 0, 0.85);
    made.view.group.add(chair);
    made.view.chair = chair;
    made.view.seatAnchor.position.y = 0.45;
    return made;
  };
  const overflow = new Map<string, Interactable>();
  for (const def of plan.desks) kit.desks.set(def.id, seat(def, false).view);
  for (const def of plan.overflow) {
    const { view, it } = seat(def, true);
    kit.desks.set(def.id, view);
    overflow.set(def.id, it);
  }
  for (const def of plan.stations) kit.desks.set(def.id, agentConsole(kit, def));
  const briefing = buildBriefing(kit);
  const boardMeshes = buildBoards(kit);
  group.add(mergeByMaterial(kit.still));
  const lehel = buildLehel();
  group.add(lehel.group);

  // The project's name on a small plaque under the "agentix" sign by the door.
  const { doorAt, out } = shell;
  const doorRot = Math.atan2(out[0], out[1]);
  let plaque: THREE.Mesh | null = null;
  let holder: THREE.Group | null = null;
  let name = '';
  let accentHex = '#c8bfa9';
  const hang = () => {
    holder?.removeFromParent();
    holder = null;
    if (plaque) {
      plaque.removeFromParent();
      plaque.geometry.dispose();
      (plaque.material as THREE.MeshBasicMaterial).map?.dispose();
      (plaque.material as THREE.Material).dispose();
      plaque = null;
    }
    if (!name) return;
    const tag = textPlane(name, { bg: '#f7f3ea', color: '#4a4640', border: accentHex, size: 36 });
    tag.scale.multiplyScalar(Math.min(0.36 / tag.geometry.parameters.width, 0.6));
    plaque = tag;
    holder = placed(doorAt.x, 0, doorAt.z, doorRot);
    // On the room's side of the wall, below the sign (see buildShell), facing into the room.
    plaque.position.set(1.0, 1.33, -0.012);
    plaque.rotation.y = Math.PI;
    holder.add(plaque);
    group.add(holder);
  };

  // Walking about: in through the door and out again, round what's in the way.
  const nav = new NavGrid(plan.bounds, plan.obstacles!);
  const inside: Pt = [plan.door.x, plan.door.z];
  const threshold: Pt = [doorAt.x + out[0] * 0.25, doorAt.z + out[1] * 0.25];
  const beyond: Pt = [doorAt.x + out[0] * 4.4, doorAt.z + out[1] * 4.4];
  let doorOpen = 0;

  // How it's lit: see mood.
  const dayCream = new THREE.Color('#fff8ec');
  const nightWarm = new THREE.Color('#ffd9ad');
  const dayGround = new THREE.Color('#cfc6b6');
  const nightGround = new THREE.Color('#6b5a48');
  const accent = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const gongAt = kit.gong?.top;
  const lamps = kit.lights.slice(0, MAX_LIGHTS);

  return {
    plan,
    group,
    colliders: kit.colliders,
    interactables: kit.interactables,
    pickables: [group],
    desks: kit.desks,
    boardMeshes,
    meetingBoard: briefing.board,
    meetingSign: briefing.sign,
    gong: kit.gong,
    nav,
    ways: {
      home: (s, from) => ({ way: [...(from ? nav.route(from, inside) : nav.wayFrom(s, inside)), threshold, beyond], chute: false }),
      in: (s) => [beyond, threshold, ...nav.wayTo(inside, s)],
    },
    rain: [{ area: plan.bounds, top: () => H - 0.5 }],
    device: 'laptop',
    room: { wall: 0.5, enclosed: true },
    // The window is where birds and rain come in from.
    acoustics: {
      gong: gongAt ? { x: gongAt.x, y: gongAt.y - 1.8, z: gongAt.z } : null,
      windows: (c.props ?? []).filter((p) => p.kind === 'window').map((p) => ({ x: p.x, y: (p.y ?? 0.85) + (p.height ?? 2.6) / 2, z: p.z })),
    },
    setBeanbags(outNow) {
      for (const [id, it] of overflow) {
        const show = outNow.has(id);
        kit.desks.get(id)!.group.visible = show;
        it.off = !show;
      }
      return [];
    },
    setLook(p: FloorPalette) {
      // It is a real place, so the walls and the carpet keep their own colours. Only small details
      // (the briefing table's ring, the plaque's border) take a muted tone of the floor's colour.
      new THREE.Color(p.trim).getHSL(hsl);
      kit.mats.accent.color.copy(accent.setHSL(hsl.h, 0.28, 0.66));
      accentHex = `#${accent.getHexString()}`;
      hang();
    },
    setProjectName(n) {
      if (n === name) return;
      name = n;
      hang();
    },
    update(t, dt, people) {
      for (const s of kit.spinners) s.obj.rotation.y += s.speed * dt;
      for (const p of kit.pulses) p.set(0.5 + 0.5 * Math.sin((t * p.rate + p.phase) * Math.PI * 2));
      // The door swings open for anyone coming up to it, from either side.
      let near = false;
      for (const q of people) if (Math.hypot(q.x - doorAt.x, q.z - doorAt.z) < 3.2) near = true;
      const want = near ? 1 : 0;
      if (doorOpen !== want) {
        doorOpen = want > doorOpen ? Math.min(1, doorOpen + dt * 1.8) : Math.max(0, doorOpen - dt * 1.2);
        shell.setDoor(doorOpen);
      }
      for (const d of kit.desks.values()) {
        if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
        d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
        d.vacancy.rotation.y = t * 1.2;
      }
      kit.gong?.update(dt);
    },
    mood(lights, daylight) {
      // Daylight through the window changes with the hour. By day the room is lit evenly; at night the
      // lamps come on, warm, and it stays easy to read. The sky has already set the sun and the moon.
      const day = THREE.MathUtils.clamp(daylight, 0, 1);
      const night = 1 - day;
      lights.hemi.color.copy(nightWarm).lerp(dayCream, day);
      lights.hemi.groundColor.copy(nightGround).lerp(dayGround, day);
      lights.hemi.intensity = 0.78 + 0.42 * day;
      lights.ambient.color.copy(nightWarm).lerp(dayCream, day);
      lights.ambient.intensity = 0.34 + 0.16 * day;
      // The sun only gets in by the window, so it can be strong; the moon stays a hint.
      lights.sun.intensity *= 0.55 + 0.2 * day;
      for (const l of lamps) l.intensity = 14 * night * night * (3 - 2 * night);
      // The window's view must reach the trees 50 m off: the sky's own haze is 40 to 90 m on a clear
      // day, which would half-swallow them, and it closes in for fog and rain (down to 28 m). So the
      // haze here starts further out, and still thickens when the sky's does (see HAZE_MAX in sky.ts).
      const fog = lights.scene.fog as THREE.Fog | null;
      if (fog) {
        const thick = THREE.MathUtils.clamp((90 - fog.far) / 62, 0, 1);
        fog.near = THREE.MathUtils.lerp(110, 30, thick);
        fog.far = THREE.MathUtils.lerp(300, 110, thick);
      }
    },
    dispose() {
      lehel.group.removeFromParent();
      lehel.dispose();
      // Its geometry, and every material with a picture of its own (carpet, dentils, lattice, signs);
      // the cached toon materials are everyone's, and stay.
      const freed = new Set<THREE.Material>();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          const map = (mat as THREE.MeshBasicMaterial).map;
          if (!map || freed.has(mat)) continue;
          map.dispose();
          mat.dispose();
          freed.add(mat);
        }
      });
    },
  };
}
