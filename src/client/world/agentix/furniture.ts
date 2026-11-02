import * as THREE from 'three';
import { BOARD_KEYS, type BoardKey } from '../../../shared/maps';
import type { Interactable } from '../types';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import { TABLE_TOP, box, placed, collide, shade } from '../station/kit';
import type { AgentixKit } from './kit';

// What the agentix office is furnished with: the white sit-stand desks, the beige mesh chairs at them,
// and the boards on the walls. All of it is modelled from two photos, so sizes are estimates. The
// real room's six desks are single desks; the made-up rows next door are the same desk, joined.

const TOP_THICK = 0.03;
const CASTERS = 5;
/** The upper, thinner part of a leg's column: from the top of the lower one up to the rail under the top. */
const UPPER_H = TABLE_TOP - TOP_THICK - 0.03 - 0.39;

/** The things every desk in a build shares, so thirty desks do not each get their own copy. */
interface DeskParts {
  foot: THREE.BufferGeometry;
  lower: THREE.BufferGeometry;
  upper: THREE.BufferGeometry;
  rail: THREE.BufferGeometry;
  tray: THREE.BufferGeometry;
  panel: THREE.BufferGeometry;
}

function deskParts(width: number): DeskParts {
  return {
    foot: roundedBox(0.07, 0.03, Math.max(0.4, width - 0.12), 0.03),
    lower: box(0.075, 0.4, 0.065),
    upper: box(0.058, UPPER_H, 0.05),
    rail: box(0.045, 0.03, Math.max(0.3, width - 0.3)),
    tray: box(0.12, 0.05, 0.34),
    panel: box(0.05, 0.022, 0.1),
  };
}

/** A cable hanging in a loop from under the desk toward the floor, as the photos show. */
function cable(x: number, z: number, dz: number, sag: number): THREE.BufferGeometry {
  const y0 = TABLE_TOP - 0.1;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, y0, z),
    new THREE.Vector3(x, y0 - 0.25, z + dz * 0.3),
    new THREE.Vector3(x, 0.05 + sag, z + dz * 0.8),
    new THREE.Vector3(x, y0 - 0.45, z + dz * 1.4),
    new THREE.Vector3(x, y0 - 0.05, z + dz * 1.6),
  ]);
  return new THREE.TubeGeometry(curve, 14, 0.005, 4, false);
}

/** One desk or one joined row: tops, T-legs with telescoping columns, a cross-beam and some cable. */
function buildDesk(kit: AgentixKit, t: AgentixKit['plan']['tables'][number], parts: DeskParts) {
  const { pal } = kit;
  const top = toon(pal.desk);
  const white = toon(pal.frame);
  const black = toon('#1f2124');
  const g = placed(t.x, 0, t.z, t.rotY);
  // One top to a stretch of about 1.9 m, with a hairline between the desks of a joined row.
  const segs = Math.max(1, Math.round(t.length / 1.9));
  const segLen = t.length / segs;
  const slab = roundedBox(t.width, TOP_THICK, segLen - (segs > 1 ? 0.006 : 0), 0.03);
  for (let i = 0; i < segs; i++) g.add(mesh(slab, top, 0, TABLE_TOP - TOP_THICK / 2, -t.length / 2 + segLen * (i + 0.5)));
  // A leg at each end and one wherever two desks meet.
  const legZ = Array.from({ length: segs + 1 }, (_, i) => -t.length / 2 + 0.16 + (i * (t.length - 0.32)) / segs);
  for (const lz of legZ) {
    g.add(mesh(parts.foot, white, 0, 0.015, lz, false));
    g.add(mesh(parts.lower, white, 0, 0.03 + 0.2, lz, false));
    g.add(mesh(parts.upper, white, 0, 0.39 + UPPER_H / 2, lz, false));
    g.add(mesh(parts.rail, white, 0, TABLE_TOP - TOP_THICK - 0.015, lz, false));
  }
  // The slim cross-beam under the top, tying the legs together.
  g.add(mesh(box(0.04, 0.035, t.length - 0.4), white, 0, TABLE_TOP - TOP_THICK - 0.0175, 0, false));
  // Under each desk: a black power tray, a cable, and the height control by the sitter's knees.
  for (let i = 0; i < segs; i++) {
    const cz = -t.length / 2 + segLen * (i + 0.5);
    const sx = t.sides[0] ?? 1;
    g.add(mesh(parts.tray, black, -sx * 0.1, TABLE_TOP - TOP_THICK - 0.045, cz, false));
    g.add(mesh(cable(-sx * 0.1, cz + 0.1, i % 2 ? 0.3 : -0.3, (i % 3) * 0.04), black, 0, 0, 0, false));
    for (const s of t.sides) g.add(mesh(parts.panel, black, s * (t.width / 2 - 0.1), TABLE_TOP - TOP_THICK - 0.012, cz + 0.55, false));
  }
  kit.still.add(g);
  collide(kit, t.x, t.z, t.width, t.length, t.rotY, TABLE_TOP);
  return g;
}

/** What is on and under the west desk in the photos: a blue drinks crate, a green bottle, a mat and a mouse. */
function westDeskThings(kit: AgentixKit, t: AgentixKit['plan']['tables'][number]) {
  // The desk's local x runs across it; the sitter's side is `s`, and the monitor stands at the far one.
  const s = t.sides[0] ?? -1;
  const g = placed(t.x, 0, t.z, t.rotY);
  const blue = toon('#2f6fb5');
  const blueDark = toon('#235590');
  // The crate under the desk, open at the top, with a few bottle necks showing.
  const crate = new THREE.Group();
  crate.position.set(-s * 0.12, 0, -0.25);
  crate.add(mesh(box(0.3, 0.02, 0.4), blue, 0, 0.01, 0, false));
  for (const sx of [-1, 1]) crate.add(mesh(box(0.02, 0.28, 0.4), blue, sx * 0.14, 0.14, 0, false));
  for (const sz of [-1, 1]) crate.add(mesh(box(0.3, 0.28, 0.02), blue, 0, 0.14, sz * 0.19, false));
  crate.add(mesh(box(0.1, 0.05, 0.022), blueDark, 0, 0.2, 0.19, false));
  crate.add(mesh(box(0.1, 0.05, 0.022), blueDark, 0, 0.2, -0.19, false));
  const cap = new THREE.CylinderGeometry(0.014, 0.014, 0.05, 6);
  const neck = toon('#1d5f4a');
  for (let i = 0; i < 6; i++) crate.add(mesh(cap, neck, ((i % 2) - 0.5) * 0.1, 0.3, (Math.floor(i / 2) - 1) * 0.12, false));
  g.add(crate);
  // On the desk: a black mat, an ergonomic mouse on it, and the green bottle with its yellow sticker.
  g.add(mesh(roundedBox(0.28, 0.004, 0.5, 0.01), toon('#202225'), s * 0.12, TABLE_TOP + 0.002, 0.5, false));
  const mouse = mesh(new THREE.SphereGeometry(1, 10, 8), toon('#1c1d20'), s * 0.12, TABLE_TOP + 0.035, 0.6, false);
  mouse.scale.set(0.034, 0.04, 0.06);
  mouse.rotation.z = s * 0.7;
  g.add(mouse);
  const bottle = new THREE.Group();
  bottle.position.set(-s * 0.2, TABLE_TOP, 0.5);
  bottle.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 12), toon('#1f6b5a'), 0, 0.125, 0, false));
  bottle.add(mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.04, 12), toon('#1f6b5a'), 0, 0.27, 0, false));
  bottle.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), toon('#202225'), 0, 0.305, 0, false));
  const sticker = mesh(new THREE.CircleGeometry(0.03, 14), toon('#e6d64a'), s * 0.0405, 0.15, 0, false);
  sticker.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
  bottle.add(sticker);
  g.add(bottle);
  kit.still.add(g);
}

/** Every table of the plan, as the white sit-stand desks (the seats have chairs, so no benches). */
export function buildDesks(kit: AgentixKit): void {
  const parts = deskParts(kit.plan.tables[0]?.width ?? 0.8);
  for (const t of kit.plan.tables) {
    buildDesk(kit, t, parts);
    if (t.name === 'West desk') westDeskThings(kit, t);
  }
}

/** The pieces of a chair, shared by every chair built for one kit. */
interface ChairParts {
  white: THREE.Material;
  beige: THREE.Material;
  beigeDark: THREE.Material;
  head: THREE.Material;
  leg: THREE.BufferGeometry;
  caster: THREE.BufferGeometry;
  hub: THREE.BufferGeometry;
  lift: THREE.BufferGeometry;
  seat: THREE.BufferGeometry;
  pad: THREE.BufferGeometry;
  side: THREE.BufferGeometry;
  bar: THREE.BufferGeometry;
  net: THREE.BufferGeometry;
  headArc: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  armPad: THREE.BufferGeometry;
  post: THREE.BufferGeometry;
}

const chairParts = new WeakMap<AgentixKit, ChairParts>();

function partsFor(kit: AgentixKit): ChairParts {
  const hit = chairParts.get(kit);
  if (hit) return hit;
  const beige = toon(kit.pal.mesh);
  const head = beige.clone();
  head.side = THREE.DoubleSide;
  const parts: ChairParts = {
    white: toon(kit.pal.frame),
    beige,
    beigeDark: toon(shade(kit.pal.mesh, -0.05)),
    head,
    leg: box(0.04, 0.025, 0.29),
    caster: new THREE.SphereGeometry(0.026, 6, 4),
    hub: new THREE.CylinderGeometry(0.05, 0.06, 0.05, 8),
    lift: new THREE.CylinderGeometry(0.03, 0.04, 0.26, 8),
    seat: roundedBox(0.5, 0.06, 0.48, 0.06),
    pad: roundedBox(0.46, 0.03, 0.44, 0.05),
    side: box(0.03, 0.66, 0.045),
    bar: box(0.47, 0.035, 0.045),
    net: box(0.43, 0.6, 0.012),
    headArc: new THREE.CylinderGeometry(0.34, 0.34, 0.17, 10, 1, true, -0.42, 0.84),
    arm: box(0.05, 0.03, 0.27),
    armPad: roundedBox(0.07, 0.025, 0.24, 0.03),
    post: box(0.03, 0.2, 0.04),
  };
  chairParts.set(kit, parts);
  return parts;
}

/**
 * A beige mesh office chair: five-star white base on casters, a gas lift, a seat pad, a mesh back in a
 * white frame with a curved headrest, and flip-up white armrests. Its origin is the middle of the seat
 * on the floor, and the back is toward +z (so whoever sits on it looks toward -z).
 */
export function deskChair(kit: AgentixKit): THREE.Group {
  const c = partsFor(kit);
  const g = new THREE.Group();
  for (let i = 0; i < CASTERS; i++) {
    const a = (i / CASTERS) * Math.PI * 2;
    const leg = new THREE.Group();
    leg.rotation.y = a;
    leg.add(mesh(c.leg, c.white, 0, 0.075, 0.15, false));
    leg.add(mesh(c.caster, c.white, 0, 0.026, 0.3, false));
    g.add(leg);
  }
  g.add(mesh(c.hub, c.white, 0, 0.09, 0, false));
  g.add(mesh(c.lift, c.white, 0, 0.24, 0, false));
  g.add(mesh(box(0.34, 0.05, 0.3), c.white, 0, 0.395, 0.02, false));
  g.add(mesh(c.seat, c.white, 0, 0.44, 0));
  g.add(mesh(c.pad, c.beigeDark, 0, 0.485, -0.01, false));
  // The back leans a little, and carries the headrest above it.
  const back = new THREE.Group();
  back.position.set(0, 0.46, 0.25);
  back.rotation.x = 0.14;
  for (const sx of [-1, 1]) back.add(mesh(c.side, c.white, sx * 0.235, 0.33, 0, false));
  back.add(mesh(c.bar, c.white, 0, 0.64, 0, false));
  back.add(mesh(c.bar, c.white, 0, 0.04, 0, false));
  back.add(mesh(c.net, c.beige, 0, 0.34, -0.012, false));
  back.add(mesh(c.post, c.white, 0, 0.74, 0.01, false));
  const head = mesh(c.headArc, c.head, 0, 0.84, 0.03 - 0.34, false);
  back.add(head);
  g.add(back);
  // Armrests that flip up: a post from the seat, an arm along the side, a beige pad on it.
  for (const sx of [-1, 1]) {
    g.add(mesh(c.post, c.white, sx * 0.28, 0.5, 0.12, false));
    g.add(mesh(c.arm, c.white, sx * 0.28, 0.61, 0.0, false));
    g.add(mesh(c.armPad, c.beigeDark, sx * 0.28, 0.635, -0.02, false));
  }
  return g;
}

/**
 * The four boards, on the walls the plan puts them on. They are drawn on by the same code as the
 * station's. The task queue is the real room's whiteboard (white aluminium frame, a marker tray); the
 * others are plain framed boards with a quiet label.
 */
export function buildBoards(kit: AgentixKit): Record<BoardKey, THREE.Mesh> {
  const faces = {} as Record<BoardKey, THREE.Mesh>;
  const aluminium = toon('#d6d9dc');
  const framed = toon(shade(kit.pal.wood, 0.06));
  for (const k of BOARD_KEYS) {
    const bd = kit.plan.boards[k];
    const nx = Math.sin(bd.rotY);
    const nz = Math.cos(bd.rotY);
    const whiteboard = k === 'queue';
    const depth = whiteboard ? 0.05 : 0.04;
    const rim = whiteboard ? 0.04 : 0.05;
    const frame = whiteboard ? aluminium : framed;
    const g = new THREE.Group();
    // Its back sits just in the wall, so there is no gap behind it.
    g.position.set(bd.x + nx * (depth / 2 - 0.04), bd.y, bd.z + nz * (depth / 2 - 0.04));
    g.rotation.y = bd.rotY;
    const w = bd.width + rim * 2;
    const h = bd.height + rim * 2;
    g.add(mesh(box(w, rim, depth), frame, 0, bd.height / 2 + rim / 2, 0, false));
    g.add(mesh(box(w, rim, depth), frame, 0, -bd.height / 2 - rim / 2, 0, false));
    for (const sx of [-1, 1]) g.add(mesh(box(rim, h, depth), frame, sx * (bd.width / 2 + rim / 2), 0, 0, false));
    g.add(mesh(box(bd.width, bd.height, depth - 0.02), toon('#e8e8e4'), 0, 0, -0.005, false));
    if (whiteboard) {
      // The marker tray along the bottom edge, with a few markers lying in it.
      g.add(mesh(box(bd.width * 0.7, 0.03, 0.07), aluminium, 0, -bd.height / 2 - rim - 0.015, 0.03, false));
      g.add(mesh(box(bd.width * 0.7, 0.05, 0.012), aluminium, 0, -bd.height / 2 - rim, 0.062, false));
      const marker = new THREE.CylinderGeometry(0.009, 0.009, 0.13, 6).rotateZ(Math.PI / 2);
      for (const [i, color] of ['#1f1f22', '#2b5fb0', '#b5342c'].entries()) g.add(mesh(marker, toon(color), -0.25 + i * 0.07, -bd.height / 2 - rim + 0.012, 0.03 + (i % 2) * 0.012, false));
    }
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bd.width, bd.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    face.position.z = depth / 2 + 0.004;
    g.add(face);
    faces[k] = face;
    const label = textPlane(bd.label, { color: '#6d6a62', bg: '#f6f2e8', border: '#d9d3c3', size: 44 });
    label.scale.multiplyScalar(0.8);
    label.position.set(0, bd.height / 2 + rim + 0.22, depth / 2);
    g.add(label);
    const it: Interactable = { kind: k, x: bd.x + nx * 1.6, z: bd.z + nz * 1.6, radius: 2.4 };
    kit.interactables.push(it);
    g.userData.interact = it;
    kit.group.add(g);
  }
  return faces;
}
