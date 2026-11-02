import * as THREE from 'three';
import type { MapPlan } from '../../../shared/maps';
import { box, lit, materials, shade, type Kit } from '../station/kit';
import { seeded, toonMap } from '../station/textures';
import { mesh, toon } from '../toon';
import { tilingCanvasTexture } from '../texture';

// What the agentix office is built with: its colours, the Kit it hands every part (the station's Kit
// with the palette added, so the station's console, briefing table and place settings can be reused),
// and the pictures and trim the shell and the architecture props share. Colours and sizes are
// estimates from two photos of the real room; nobody has measured it.

/** The colours of the room, as the map's `palette` gives them. */
export interface Palette {
  /** Cream walls. */
  wall: string;
  /** White plaster moulding and woodwork. */
  trim: string;
  /** Mid-grey carpet. */
  floor: string;
  /** The very dark carved wood of the wardrobe. */
  wood: string;
  /** The white desks. */
  desk: string;
  /** The white window frames and chair frames. */
  frame: string;
  /** The beige mesh of the chairs. */
  mesh: string;
}

export type AgentixKit = Kit & { pal: Palette };

/** The map's palette over the colours read off the photos. */
export function agentixPalette(plan: MapPlan): Palette {
  const p = plan.config?.palette ?? {};
  return {
    wall: p.wall ?? '#f3eee2',
    trim: p.trim ?? '#fbf8f1',
    floor: p.floor ?? '#85888c',
    wood: p.wood ?? '#2e2b2d',
    desk: p.desk ?? '#f4f2ec',
    frame: p.frame ?? '#f1efe9',
    mesh: p.mesh ?? '#c8b698',
  };
}

/**
 * The kit for a map. The station's materials are fed from the palette so the parts reused from the
 * station look calm and domestic here: pale warm metal, a charcoal rather than a space-black, beige
 * padding, and an accent that is a muted taupe rather than bright cyan.
 */
export function makeKit(plan: MapPlan): AgentixKit {
  const pal = agentixPalette(plan);
  const mats = {
    ...materials({ hull: pal.wall, panel: pal.trim, metal: shade(pal.frame, -0.12), glow: '#c9a46a' }),
    metalDark: toon(shade(pal.frame, -0.22)),
    black: toon('#2b2a2c'),
    pad: toon(pal.mesh),
    white: toon(pal.desk),
    accent: lit('#b8aa90'),
    lamp: lit('#fff6e4'),
  };
  const kit: AgentixKit = {
    plan,
    pal,
    group: new THREE.Group(),
    still: new THREE.Group(),
    colliders: [],
    interactables: [],
    mats,
    height: plan.height,
    desks: new Map(),
    lights: [],
    spinners: [],
    pulses: [],
    floorAt(x, z) {
      let top = 0;
      for (const c of kit.colliders) if (c.top < 50 && !c.fence && c.top > top && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) top = c.top;
      return top;
    },
  };
  return kit;
}

/** A grey carpet: a fine weave of knots a couple of centimetres across, 1.5 m to the tile. */
export function carpetMaterial(color: string): THREE.MeshToonMaterial {
  const rand = seeded(7);
  return toonMap(
    tilingCanvasTexture(256, 256, (g) => {
      g.fillStyle = color;
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 256; y += 4) {
        for (let x = 0; x < 256; x += 4) {
          g.fillStyle = shade(color, (rand() - 0.5) * 0.05 + ((x + y) / 4 % 2 ? 0.014 : -0.014));
          g.fillRect(x, y, 4, 4);
        }
      }
    }),
  );
}

/** A row of small blocks and gaps, a block every 10 cm: the dentil line under the moulding. */
function dentilMaterial(color: string): THREE.MeshToonMaterial {
  return toonMap(
    tilingCanvasTexture(32, 32, (g) => {
      g.fillStyle = shade(color, -0.14);
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = color;
      g.fillRect(2, 2, 12, 28);
    }),
  );
}

const dentils = new WeakMap<AgentixKit, THREE.MeshToonMaterial>();

/** How tall the moulding is, from the ceiling down (m). */
export const MOULDING = 0.27;

/**
 * The plaster moulding along the top of a wall and the skirting along its foot, on one face of it.
 * Placed so that local +x runs along the wall, local +z comes out of it into the room, and the run
 * is centred on (x, z); `gaps` are the stretches along it to leave without skirting (a door).
 */
export function faceRun(kit: AgentixKit, x: number, z: number, rotY: number, length: number, opts: { skirt?: boolean; gaps?: [number, number][] } = {}) {
  const { pal, height: H } = kit;
  const trim = toon(pal.trim);
  const run = new THREE.Group();
  run.position.set(x, 0, z);
  run.rotation.y = rotY;
  // From the ceiling down: the cove, the ogee under it, the dentil line, and a small bead.
  run.add(mesh(box(length, 0.1, 0.09), trim, 0, H - 0.05, 0.045, false));
  run.add(mesh(box(length, 0.08, 0.05), trim, 0, H - 0.14, 0.025, false));
  run.add(mesh(box(length, 0.03, 0.02), trim, 0, H - 0.25, 0.01, false));
  // The dentil line has a picture on it, so it can't be merged with the rest: it goes in a group of its own.
  let denMat = dentils.get(kit);
  if (!denMat) dentils.set(kit, (denMat = dentilMaterial(pal.trim)));
  const geo = box(length, 0.06, 0.035);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (length / 0.1));
  const den = new THREE.Group();
  den.position.copy(run.position);
  den.rotation.y = rotY;
  den.add(mesh(geo, denMat, 0, H - 0.21, 0.0175, false));
  kit.group.add(den);
  if (opts.skirt !== false) {
    const grey = toon(shade(pal.floor, 0.1));
    let from = -length / 2;
    const pieces: [number, number][] = [];
    for (const [a, b] of [...(opts.gaps ?? [])].sort((p, q) => p[0] - q[0])) {
      if (a > from) pieces.push([from, a]);
      from = Math.max(from, b);
    }
    pieces.push([from, length / 2]);
    for (const [a, b] of pieces) {
      if (b - a < 0.02) continue;
      run.add(mesh(box(b - a, 0.13, 0.022), grey, (a + b) / 2, 0.065, 0.011, false));
      run.add(mesh(box(b - a, 0.02, 0.032), grey, (a + b) / 2, 0.14, 0.016, false));
    }
  }
  kit.still.add(run);
}
