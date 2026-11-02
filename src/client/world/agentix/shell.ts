import * as THREE from 'three';
import { HULL, type WallSide } from '../../../shared/maps';
import type { AgentixPropKind } from '../../../shared/maps/agentix-props';
import type { PropConfig } from '../../../shared/maps/types';
import type { Bounds, Pt } from '../../../shared/nav';
import { Batch, MAX_LIGHTS, box, collide, placed, tileBox } from '../station/kit';
import { wallFrame } from '../station/shell';
import { toonMap } from '../station/textures';
import { tilingCanvasTexture } from '../texture';
import { mesh, textPlane, toon } from '../toon';
import { carpetMaterial, faceRun, type AgentixKit } from './kit';

// The shell of the agentix office: the carpet, the ceiling, the thick outer walls with the casement
// windows cut right through them, the plaster moulding and skirting, and the way out with its door.
// The inside walls, the doorways, the windows themselves, the radiators and the lamps are props
// (ARCHITECTURE_PROPS), put up where the map says. Sizes are estimates from two photos.

/** The way out: a plain door, a little narrower than a hatch. */
const DOOR = { width: 1.3, height: 2.2 };
/** How thick the inside walls are (see agentixFootprint). */
const INSIDE_T = 0.2;
/** How far the window's frame sits in from the room's face of the wall: a deep reveal. */
const SET_BACK = 0.3;
/** The landing outside the door, where workers step out of sight. */
const LANDING = { width: 2.6, length: 4.8 };

const SIDES: readonly WallSide[] = ['west', 'east', 'north', 'south'];

/** The wall of the room that (x, z) is nearest to. */
function sideOf(b: Bounds, x: number, z: number): WallSide {
  const gap: Record<WallSide, number> = { west: x - b.minX, east: b.maxX - x, north: z - b.minZ, south: b.maxZ - z };
  return SIDES.reduce((a, k) => (gap[k] < gap[a] ? k : a));
}

/** A hole through an outer wall: `u` along the wall (x on the north and south walls, z on the others), `y0` to `y1` high. */
interface Cut {
  side: WallSide;
  u: number;
  width: number;
  y0: number;
  y1: number;
}

/** A window prop's hole in the wall. */
function windowCut(b: Bounds, p: PropConfig): Cut {
  const side = sideOf(b, p.x, p.z);
  const y0 = p.y ?? 0.85;
  return { side, u: side === 'north' || side === 'south' ? p.x : p.z, width: p.width ?? 2.6, y0, y1: y0 + (p.height ?? 2.6) };
}

/**
 * Puts up the shell. Returns where the way out is and which way is out through it, and how to
 * swing its door (0 shut, 1 open).
 */
export function buildShell(kit: AgentixKit): { doorAt: THREE.Vector3; out: Pt; setDoor(open: number): void } {
  const { plan, group, still, mats, pal } = kit;
  const b = plan.bounds;
  const H = plan.height;
  const T = HULL;
  const W = b.maxX - b.minX;
  const L = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;

  // The carpet, and a ceiling the size of the room: so the Sun only gets in by the windows.
  const floor = new Batch();
  floor.add(tileBox(W + 2 * T, T, L + 2 * T, 1.5, { x: cx, y: -T / 2, z: cz }), carpetMaterial(pal.floor));
  group.add(floor.build(false));
  still.add(mesh(box(W + 2 * T, T, L + 2 * T), toon(pal.trim), cx, H + T / 2, cz, false));
  kit.colliders.push({ minX: b.minX - 8, maxX: b.maxX + 8, minZ: b.minZ - 8, maxZ: b.maxZ + 8, top: 0 });

  // The way out is in the wall nearest the door the map names.
  const doorSide = sideOf(b, plan.door.x, plan.door.z);
  const df = wallFrame(b, doorSide);
  const doorU = df.alongX ? plan.door.x : plan.door.z;
  const cuts: Cut[] = [{ side: doorSide, u: doorU, width: DOOR.width, y0: 0, y1: DOOR.height }];
  for (const p of plan.config?.props ?? []) if (p.kind === 'window') cuts.push(windowCut(b, p));

  for (const side of SIDES) {
    const f = wallFrame(b, side);
    // The side walls run past the end walls, to close the corners.
    const [lo, hi] = f.alongX ? [b.minX - T, b.maxX + T] : [b.minZ - T, b.maxZ + T];
    const piece = (u0: number, u1: number, y0: number, y1: number) => {
      if (u1 - u0 < 0.01 || y1 - y0 < 0.01) return;
      const [x, z] = f.at((u0 + u1) / 2, T / 2);
      still.add(mesh(f.box(u1 - u0, y1 - y0, T), mats.hull, x, (y0 + y1) / 2, z));
    };
    const mine = cuts.filter((c) => c.side === side).sort((p, q) => p.u - q.u);
    let from = lo;
    for (const c of mine) {
      const a = c.u - c.width / 2;
      const z = c.u + c.width / 2;
      piece(from, a, 0, H);
      piece(a, z, 0, c.y0);
      piece(a, z, c.y1, H);
      from = z;
    }
    piece(from, hi, 0, H);
    // You stay inside: the windows and the door are for workers to go through, and for the eye.
    const [x0, z0] = f.at(lo, 0);
    const [x1, z1] = f.at(hi, T);
    kit.colliders.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top: 99, fence: true });

    // The moulding along the top of the room's face of the wall, and the skirting, broken at the door.
    const mid = (f.alongX ? b.minX + b.maxX : b.minZ + b.maxZ) / 2;
    const [mx, mz] = f.at(mid, 0);
    const inward = Math.atan2(-f.out[0], -f.out[1]);
    // The run's own x axis may run against the wall's coordinate.
    const dir = Math.round(f.alongX ? Math.cos(inward) : -Math.sin(inward));
    const gap = side === doorSide ? dir * (doorU - mid) : 0;
    const gaps: [number, number][] = side === doorSide ? [[gap - DOOR.width / 2 - 0.1, gap + DOOR.width / 2 + 0.1]] : [];
    faceRun(kit, mx, mz, inward, hi - lo - 2 * T, { gaps });
  }

  // The way out: a casing round the opening, and a plain white door that swings out for anyone coming up to it.
  const [dx, dz] = df.at(doorU, 0);
  const doorAt = new THREE.Vector3(dx, 0, dz);
  const w = DOOR.width;
  const h = DOOR.height;
  const frame = placed(dx, 0, dz, df.rotY);
  for (const sx of [-1, 1]) frame.add(mesh(box(0.1, h + 0.1, T + 0.05), mats.white, sx * (w / 2 + 0.05), (h + 0.1) / 2, T / 2, false));
  frame.add(mesh(box(w + 0.2, 0.1, T + 0.05), mats.white, 0, h + 0.05, T / 2, false));
  const hinge = new THREE.Group();
  hinge.position.set(-w / 2 + 0.02, 0, T * 0.4);
  hinge.add(mesh(box(w - 0.04, h - 0.02, 0.045), mats.white, (w - 0.04) / 2, h / 2, 0));
  hinge.add(mesh(box(w - 0.3, h * 0.38, 0.055), mats.hull, (w - 0.04) / 2, h * 0.7, 0, false));
  hinge.add(mesh(box(w - 0.3, h * 0.28, 0.055), mats.hull, (w - 0.04) / 2, h * 0.28, 0, false));
  hinge.add(mesh(box(0.1, 0.03, 0.09), mats.metal, w - 0.14, h * 0.48, 0, false));
  frame.add(hinge);
  // A small plain sign by the door on the room's side. The project's plaque goes under it (see index.ts).
  const sign = textPlane('agentix', { bg: '#f7f3ea', color: '#4a4640', border: '#d5cebd', size: 44 });
  sign.scale.multiplyScalar(0.34 / (sign.geometry.parameters.width * sign.scale.x));
  sign.position.set(w / 2 + 0.35, 1.55, -0.012);
  sign.rotation.y = Math.PI;
  frame.add(sign);
  group.add(frame);

  // The landing outside, where workers step out of sight: a plain walled passage, with a door at the far end.
  const landing = placed(dx, 0, dz, df.rotY);
  const { width: lw, length: ll } = LANDING;
  const grey = toon('#9d9a94');
  landing.add(mesh(box(lw, 0.2, ll), grey, 0, -0.1, T + ll / 2, false));
  landing.add(mesh(box(lw + 0.4, 0.2, ll), mats.white, 0, H + 0.1, T + ll / 2, false));
  for (const sx of [-1, 1]) landing.add(mesh(box(0.2, H, ll), mats.hull, sx * (lw / 2 + 0.1), H / 2, T + ll / 2));
  landing.add(mesh(box(lw + 0.4, H, 0.2), mats.hull, 0, H / 2, T + ll + 0.1));
  landing.add(mesh(box(1.0, 2.1, 0.05), mats.white, 0, 1.05, T + ll - 0.02, false));
  still.add(landing);

  return {
    doorAt,
    out: df.out,
    setDoor(open) {
      const e = open * open * (3 - 2 * open);
      // Outward: the free edge swings toward +z.
      hinge.rotation.y = -e * 1.7;
    },
  };
}

// ---- The architecture props -----------------------------------------------------------------------

/** The lattice of a radiator cover: pale diamonds on a shadowed ground. */
const lattices = new WeakMap<AgentixKit, THREE.MeshToonMaterial>();
function latticeMaterial(kit: AgentixKit): THREE.MeshToonMaterial {
  let m = lattices.get(kit);
  if (!m) {
    m = toonMap(
      tilingCanvasTexture(64, 64, (g) => {
        g.fillStyle = '#a9a69e';
        g.fillRect(0, 0, 64, 64);
        g.strokeStyle = kit.pal.frame;
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(0, 32);
        g.lineTo(32, 0);
        g.lineTo(64, 32);
        g.lineTo(32, 64);
        g.closePath();
        g.stroke();
      }),
    );
    lattices.set(kit, m);
  }
  return m;
}

/** An inside wall: floor to ceiling, `length` long along `rotY`, with moulding and skirting on both faces. */
function wall(kit: AgentixKit, p: PropConfig) {
  const r = p.rotY ?? 0;
  const len = p.length ?? 1;
  const H = kit.height;
  const g = placed(p.x, 0, p.z, r);
  g.add(mesh(box(INSIDE_T, H, len), kit.mats.hull, 0, H / 2, 0));
  kit.still.add(g);
  collide(kit, p.x, p.z, INSIDE_T, len, r, 99, { fence: true });
  facesOf(kit, p.x, p.z, r, len, true);
}

/** The moulding (and skirting) on both faces of a wall piece `len` long at (x, z) running along `r`. */
function facesOf(kit: AgentixKit, x: number, z: number, r: number, len: number, skirt: boolean) {
  const n = [Math.cos(r), -Math.sin(r)];
  for (const s of [-1, 1]) faceRun(kit, x + s * n[0] * (INSIDE_T / 2), z + s * n[1] * (INSIDE_T / 2), Math.atan2(s * n[0], s * n[1]), len, { skirt });
}

/** A way through an inside wall: a white casing round the opening, and the wall over it from 2.3 m. */
function doorway(kit: AgentixKit, p: PropConfig) {
  const r = p.rotY ?? 0;
  const w = p.width ?? 1.4;
  const H = kit.height;
  const top = 2.3;
  const g = placed(p.x, 0, p.z, r);
  const white = kit.mats.white;
  // Local z runs along the wall, local x across it.
  g.add(mesh(box(INSIDE_T, H - top, w), kit.mats.hull, 0, (top + H) / 2, 0));
  for (const s of [-1, 1]) g.add(mesh(box(INSIDE_T + 0.05, top, 0.1), white, 0, top / 2, s * (w / 2 + 0.05), false));
  g.add(mesh(box(INSIDE_T + 0.05, 0.1, w + 0.2), white, 0, top + 0.05, 0, false));
  kit.still.add(g);
  facesOf(kit, p.x, p.z, r, w, false);
}

/**
 * A tall white casement window in the thick wall: a deep reveal, 3 panes across by 2 rows with a
 * transom between, thin glazing bars, handles on the lower row, a sill, and clear glass. The shell
 * cut the hole (see windowCut), so the wall stops at the reveal and nothing blocks the view.
 */
function windowProp(kit: AgentixKit, p: PropConfig) {
  const b = kit.plan.bounds;
  const cut = windowCut(b, p);
  const f = wallFrame(b, cut.side);
  const w = cut.width;
  const h = cut.y1 - cut.y0;
  const [x, z] = f.at(cut.u, 0);
  const g = placed(x, cut.y0, z, f.rotY);
  const white = toon(kit.pal.frame);
  const bar = (bx: number, by: number, sw: number, sh: number, depth = 0.08) => g.add(mesh(box(sw, sh, depth), white, bx, by, SET_BACK, false));
  // The outer frame, the bottom rail on the sill, and the sill itself, standing out into the room.
  bar(-w / 2 + 0.04, h / 2, 0.08, h, 0.1);
  bar(w / 2 - 0.04, h / 2, 0.08, h, 0.1);
  bar(0, h - 0.04, w, 0.08, 0.1);
  bar(0, 0.07, w - 0.16, 0.08, 0.1);
  g.add(mesh(box(w + 0.14, 0.04, HULL + 0.07), toon(kit.pal.trim), 0, 0.01, (HULL - 0.07) / 2, false));
  // Two rows of three: the transom between them is a little over two thirds of the way up.
  const iw = w - 0.16;
  const y0 = 0.11;
  const y1 = h - 0.08;
  const ty = y0 + (y1 - y0) * 0.68;
  const cw = (iw - 0.1) / 3;
  bar(0, ty, iw, 0.07);
  for (let k = 0; k < 3; k++) {
    const left = -iw / 2 + k * (cw + 0.05);
    const mid = left + cw / 2;
    if (k > 0) bar(left - 0.025, (y0 + y1) / 2, 0.05, y1 - y0);
    // Each pane has thin glazing bars round its glass.
    for (const [lo, hi] of [
      [y0, ty - 0.035],
      [ty + 0.035, y1],
    ]) {
      const ph = hi - lo;
      bar(mid, lo + 0.012, cw, 0.024, 0.05);
      bar(mid, hi - 0.012, cw, 0.024, 0.05);
      bar(left + 0.012, lo + ph / 2, 0.024, ph, 0.05);
      bar(left + cw - 0.012, lo + ph / 2, 0.024, ph, 0.05);
    }
    // A handle on the lower row's panes, by the pane's free edge.
    const hx = k === 2 ? left + 0.07 : left + cw - 0.07;
    g.add(mesh(box(0.03, 0.14, 0.02), kit.mats.metal, hx, (y0 + ty) / 2, SET_BACK - 0.05, false));
    g.add(mesh(box(0.02, 0.02, 0.05), kit.mats.metal, hx, (y0 + ty) / 2 + 0.06, SET_BACK - 0.035, false));
  }
  kit.still.add(g);
  // The glass is clear and sees through: one pane for the lot, apart from the merged parts.
  const [gx, gz] = f.at(cut.u, SET_BACK);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(iw, y1 - y0), kit.mats.glass);
  glass.rotation.y = f.rotY;
  glass.position.set(gx, cut.y0 + (y0 + y1) / 2, gz);
  kit.group.add(glass);
}

/** A radiator behind a white cover with diamond lattice panels, under a window. */
function radiator(kit: AgentixKit, p: PropConfig) {
  const w = p.width ?? 2.8;
  const r = p.rotY ?? 0;
  const g = placed(p.x, 0, p.z, r);
  const white = kit.mats.white;
  g.add(mesh(box(w, 0.7, 0.28), white, 0, 0.45, 0, false));
  g.add(mesh(box(w + 0.04, 0.03, 0.3), white, 0, 0.815, 0, false));
  g.add(mesh(box(w, 0.08, 0.28), white, 0, 0.04, 0, false));
  kit.still.add(g);
  const n = Math.max(1, Math.round(w / 0.9));
  const pw = (w - 0.1) / n - 0.06;
  const mat = latticeMaterial(kit);
  const panels = placed(p.x, 0, p.z, r);
  for (let i = 0; i < n; i++) {
    const geo = new THREE.PlaneGeometry(pw, 0.52);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * (pw / 0.1), uv.getY(j) * (0.52 / 0.1));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(-w / 2 + 0.05 + 0.03 + pw / 2 + i * (pw + 0.06), 0.46, 0.141);
    panels.add(m);
  }
  kit.group.add(panels);
  collide(kit, p.x, p.z, w, 0.3, r, 0.83);
}

/** A simple white pendant lamp; the first few also light the room for real at night (see index.ts mood). */
function lamp(kit: AgentixKit, p: PropConfig) {
  const H = kit.height;
  const y = p.y ?? H - 0.8;
  const g = placed(p.x, 0, p.z);
  g.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, H - y, 6), kit.mats.white, 0, (H + y) / 2, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 14), kit.mats.white, 0, H - 0.0125, 0, false));
  const globe = mesh(new THREE.SphereGeometry(0.2, 20, 14), kit.mats.lamp, 0, y - 0.17, 0, false);
  globe.scale.y = 0.85;
  g.add(globe);
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.09, 12), kit.mats.white, 0, y + 0.0, 0, false));
  kit.still.add(g);
  if (kit.lights.length >= MAX_LIGHTS) return;
  const light = new THREE.PointLight('#ffd9a8', 0, 16, 1.5);
  light.position.set(p.x, y - 0.4, p.z);
  kit.group.add(light);
  kit.lights.push(light);
}

export const ARCHITECTURE_PROPS: Pick<Record<AgentixPropKind, (kit: AgentixKit, p: PropConfig) => void>, 'wall' | 'doorway' | 'window' | 'radiator' | 'lamp'> = {
  wall,
  doorway,
  window: windowProp,
  radiator,
  lamp,
};
