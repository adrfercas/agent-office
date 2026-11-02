import * as THREE from 'three';
import type { PropConfig } from '../../../shared/maps';
import { buildGong } from '../../features/gong/world';
import type { Interactable } from '../types';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import { box, collide, lit, placed, shade } from '../station/kit';
import type { AgentixKit } from './kit';

// What stands about the agentix office, as the photos show it: leafy plants (some with red chilies) on
// the sill, the dark wardrobe with its antlers and the "*Shipping." block, the monitors, a wire waste
// basket, the merge gong and the coffee machine. Every size is an estimate from two photos.

/** A group at a prop's spot, turned its way: at `y`, or on the floor there. */
const at = (kit: AgentixKit, p: PropConfig, y = kit.floorAt(p.x, p.z)) => placed(p.x, y, p.z, p.rotY ?? 0);

const LEAVES = ['#3f9b3f', '#57b24a', '#2f7d36', '#6cc055'];
const leafGeo = new THREE.SphereGeometry(1, 6, 4);
const chiliGeo = new THREE.ConeGeometry(0.011, 0.06, 5).rotateX(Math.PI);

/** A potted plant: a few stems, a crown of drooping leaves, and (on a sill) red chilies hanging in it. */
function plant(kit: AgentixKit, p: PropConfig) {
  const s = p.scale ?? 1;
  const onSill = p.y !== undefined;
  const g = at(kit, p, p.y);
  g.scale.setScalar(s);
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.14, 10), toon('#2d3033'), 0, 0.07, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.012, 10), toon('#3b2d22'), 0, 0.14, 0, false));
  // On the floor the plant stands taller, so it reads as a plant and not a sill ornament.
  const height = onSill ? 0.34 : 0.62;
  g.add(mesh(new THREE.CylinderGeometry(0.009, 0.014, height, 5), toon('#4a7a3a'), 0, 0.14 + height / 2, 0, false));
  const seed = Math.abs(Math.round(p.x * 31 + p.z * 17)) % 7;
  const n = 15;
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + seed;
    const k = i / (n - 1);
    const r = 0.06 + (i % 4) * 0.03;
    const leaf = mesh(leafGeo, toon(LEAVES[(i + seed) % LEAVES.length]), Math.cos(a) * r, 0.2 + height * (0.35 + 0.65 * k), Math.sin(a) * r, false);
    leaf.scale.set(0.045, 0.01, 0.1 + (i % 3) * 0.015);
    leaf.rotation.order = 'YXZ';
    leaf.rotation.set(0.35 + (i % 3) * 0.12, Math.PI / 2 - a, 0);
    g.add(leaf);
  }
  if (onSill) {
    const red = toon('#d3302a');
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + seed;
      g.add(mesh(chiliGeo, red, Math.cos(a) * 0.1, 0.2 + height * (0.4 + (i % 3) * 0.15) - 0.04, Math.sin(a) * 0.1, false));
    }
  }
  kit.still.add(g);
  if (!onSill) collide(kit, p.x, p.z, 0.4 * s, 0.4 * s, 0, 0.9 * s);
}

/** A roe-deer trophy: a small wooden plaque, and the two antlers, each a beam with two points, on a skull cap. */
function antlers(wood: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const bone = toon('#cdbf9f');
  const tine = new THREE.CylinderGeometry(0.006, 0.01, 0.1, 5);
  g.add(mesh(roundedBox(0.1, 0.02, 0.08, 0.02), wood, 0, 0.01, 0, false));
  g.add(mesh(new THREE.SphereGeometry(0.04, 7, 5), bone, 0, 0.04, 0, false));
  for (const sx of [-1, 1]) {
    const beam = mesh(tine, bone, sx * 0.035, 0.1, -0.01, false);
    beam.rotation.set(-0.25, 0, -sx * 0.3);
    g.add(beam);
    const front = mesh(tine, bone, sx * 0.05, 0.15, -0.04, false);
    front.scale.set(0.8, 0.5, 0.8);
    front.rotation.set(-0.9, 0, -sx * 0.25);
    g.add(front);
    const back = mesh(tine, bone, sx * 0.06, 0.16, 0.0, false);
    back.scale.set(0.8, 0.45, 0.8);
    back.rotation.set(0.5, 0, -sx * 0.45);
    g.add(back);
  }
  return g;
}

/** The dark carved two-door wardrobe, with its antlers, a long black bag and the "*Shipping." block on top. */
function armoire(kit: AgentixKit, p: PropConfig) {
  const w = p.width ?? 1.3;
  const d = p.length ?? 0.7;
  const h = p.height ?? 2.3;
  const wood = toon(kit.pal.wood);
  const panel = toon(shade(kit.pal.wood, 0.035));
  const groove = toon(shade(kit.pal.wood, -0.05));
  const g = at(kit, p);
  const plinth = 0.14;
  const crown = 0.16;
  const body = h - plinth - crown;
  g.add(mesh(box(w - 0.04, plinth, d - 0.04), groove, 0, plinth / 2, 0));
  g.add(mesh(box(w, body, d - 0.02), wood, 0, plinth + body / 2, 0));
  // The cornice: a stepped crown, wider than the body.
  g.add(mesh(box(w + 0.05, 0.07, d + 0.04), wood, 0, h - crown + 0.035, 0));
  g.add(mesh(box(w + 0.09, 0.05, d + 0.07), wood, 0, h - 0.07, 0));
  g.add(mesh(box(w + 0.03, 0.04, d + 0.03), panel, 0, h - 0.025, 0, false));
  // Two panelled doors: a raised panel above and below a middle rail, with a few carved grooves.
  const front = d / 2 - 0.01;
  const dw = (w - 0.12) / 2;
  const top = plinth + body - 0.08;
  for (const sx of [-1, 1]) {
    const cx = sx * (dw / 2 + 0.005);
    g.add(mesh(box(dw, body - 0.1, 0.03), panel, cx, plinth + body / 2, front, false));
    const upper = (body - 0.1) * 0.58;
    const lower = (body - 0.1) * 0.3;
    g.add(mesh(box(dw - 0.14, upper, 0.025), wood, cx, top - 0.06 - upper / 2, front + 0.02, false));
    g.add(mesh(box(dw - 0.14, lower, 0.025), wood, cx, plinth + 0.1 + lower / 2, front + 0.02, false));
    for (let i = -1; i <= 1; i++) {
      g.add(mesh(box(0.02, upper - 0.12, 0.012), groove, cx + i * 0.11, top - 0.06 - upper / 2, front + 0.04, false));
      g.add(mesh(box(0.02, lower - 0.1, 0.012), groove, cx + i * 0.11, plinth + 0.1 + lower / 2, front + 0.04, false));
    }
    g.add(mesh(box(0.02, 0.14, 0.02), toon('#6a6258'), -sx * 0.04, plinth + body * 0.5, front + 0.03, false));
  }
  // On top: antlers on little mounts, the long black bag behind them, and the white block at the right.
  const topY = h;
  for (const [i, x] of [-0.5, -0.3, -0.12, 0.08].entries()) {
    const t = antlers(wood);
    t.position.set(x, topY, d * 0.12 + (i % 2) * 0.05);
    t.rotation.y = (i - 1.5) * 0.18;
    g.add(t);
  }
  const bag = mesh(roundedBox(1.0, 0.16, 0.22, 0.07), toon('#1d2228'), -0.05, topY + 0.08, -d * 0.2, false);
  bag.rotation.y = 0.05;
  g.add(bag);
  g.add(mesh(box(0.9, 0.03, 0.14), toon('#39424d'), -0.05, topY + 0.17, -d * 0.2, false));
  const blockW = 0.2;
  g.add(mesh(box(blockW, 0.1, 0.07), toon('#f7f6f1'), 0.3, topY + 0.05, d * 0.12, false));
  g.add(mesh(box(0.07, 0.06, 0.06), toon('#f7f6f1'), 0.19, topY + 0.13, d * 0.12, false));
  // Its text is on a plane, a little off the block's face. The block faces the room.
  const text = textPlane('*Shipping.', { color: '#25262a', size: 64 });
  text.scale.setScalar(0.175 / (text.geometry.parameters.width as number));
  text.position.set(0.3, topY + 0.05, d * 0.12 + 0.036);
  g.add(text);
  kit.group.add(g);
  collide(kit, p.x, p.z, w + 0.05, d + 0.04, p.rotY ?? 0, h);
}

/** A monitor on a slim white stand (the big one), or the curved wide dark one (`height` under 0.4). */
function monitor(kit: AgentixKit, p: PropConfig) {
  const w = p.width ?? 0.7;
  const curved = (p.height ?? 0.5) < 0.4;
  const h = curved ? (p.height as number) : w * 0.6;
  const g = at(kit, p, p.y ?? 0.78);
  const white = toon(kit.pal.frame);
  const dark = toon('#191b1f');
  const lift = curved ? 0.1 : 0.16;
  if (curved) {
    // A shallow arc: a bezel, and the screen a hair in front of it, both curving toward the sitter.
    const R = 1.3;
    const bezel = new THREE.CylinderGeometry(R, R, h, 24, 1, true, Math.PI - w / R / 2, w / R);
    const screen = new THREE.CylinderGeometry(R - 0.004, R - 0.004, h - 0.025, 24, 1, true, Math.PI - (w / R - 0.03) / 2, w / R - 0.03);
    const side = (geo: THREE.BufferGeometry, color: string) => {
      const m = toon(color).clone();
      m.side = THREE.DoubleSide;
      const o = mesh(geo, m, 0, lift + h / 2, R, false);
      return o;
    };
    g.add(side(bezel, '#0f1013'));
    g.add(side(screen, '#1b1e24'));
    g.add(mesh(box(0.05, lift, 0.025), dark, 0, lift / 2, -0.04, false));
    g.add(mesh(roundedBox(0.3, 0.015, 0.2, 0.04), dark, 0, 0.0075, -0.02, false));
  } else {
    g.add(mesh(box(w, h, 0.028), white, 0, lift + h / 2, -0.02, false));
    g.add(mesh(box(w - 0.034, h - 0.034, 0.004), toon('#2b2c2f'), 0, lift + h / 2, -0.004, false));
    g.add(mesh(box(0.06, lift + 0.05, 0.022), white, 0, (lift + 0.05) / 2, -0.05, false));
    g.add(mesh(roundedBox(0.26, 0.012, 0.2, 0.04), white, 0, 0.006, -0.02, false));
  }
  kit.still.add(g);
}

/** A wire waste basket: a see-through tapered shell with a few bright rods and rings round it. */
function basket(kit: AgentixKit, p: PropConfig) {
  const g = at(kit, p);
  const H = 0.36;
  const rTop = 0.17;
  const rBot = 0.14;
  const wire = toon('#9ca2a8');
  g.add(mesh(new THREE.CylinderGeometry(rTop, rBot, H, 14, 1, true), lit('#aeb4ba', { opacity: 0.18, side: THREE.DoubleSide }), 0, H / 2, 0, false));
  const rod = new THREE.CylinderGeometry(0.0035, 0.0035, H, 4);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = (rTop + rBot) / 2;
    const m = mesh(rod, wire, Math.cos(a) * r, H / 2, Math.sin(a) * r, false);
    m.rotation.set(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08);
    g.add(m);
  }
  for (const [y, r] of [[0.01, rBot], [H * 0.5, (rTop + rBot) / 2], [H, rTop]] as const) {
    g.add(mesh(new THREE.TorusGeometry(r, 0.005, 4, 16).rotateX(Math.PI / 2), wire, 0, y, 0, false));
  }
  g.add(mesh(new THREE.CylinderGeometry(rBot, rBot, 0.006, 14), lit('#aeb4ba', { opacity: 0.25 }), 0, 0.004, 0, false));
  kit.still.add(g);
  collide(kit, p.x, p.z, 0.3, 0.3, 0, H);
}

/** A coffee machine on a small counter against a wall: a cup from it perks you up, as the station's dispenser does. */
function coffee(kit: AgentixKit, p: PropConfig): Interactable {
  const w = 1.2;
  const d = 0.6;
  const g = at(kit, p);
  const white = toon(kit.pal.desk);
  const steel = toon('#b9bec4');
  const black = toon('#1d1f23');
  g.add(mesh(box(w, 0.86, d), white, 0, 0.43, 0));
  g.add(mesh(box(w + 0.03, 0.04, d + 0.03), toon(kit.pal.wood), 0, 0.88, 0));
  g.add(mesh(box(w - 0.1, 0.5, 0.012), toon(shade(kit.pal.desk, -0.06)), 0, 0.4, d / 2 + 0.002, false));
  // The machine: a dark body with a steel front, a spout, a tray, and a cup waiting.
  const mx = -0.2;
  g.add(mesh(box(0.3, 0.4, 0.4), black, mx, 1.1, -0.05));
  g.add(mesh(box(0.26, 0.05, 0.02), steel, mx, 1.24, 0.16, false));
  g.add(mesh(box(0.2, 0.12, 0.04), steel, mx, 1.14, 0.17, false));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8), steel, mx, 1.05, 0.14, false));
  g.add(mesh(box(0.24, 0.015, 0.2), steel, mx, 0.9, 0.1, false));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.09, 12), toon('#f4f3ee'), mx, 0.955, 0.1, false));
  g.add(mesh(box(0.05, 0.03, 0.01), lit('#7bd88f'), mx + 0.09, 1.28, 0.152, false));
  // A stack of cups and a jar beside it.
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.CylinderGeometry(0.036, 0.03, 0.09, 10), toon('#f4f3ee'), 0.25, 0.945 + i * 0.012, 0.0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 10), toon('#6b4a2f'), 0.42, 0.97, -0.05, false));
  const sign = textPlane('Coffee', { color: '#6d6a62', bg: '#f6f2e8', border: '#d9d3c3', size: 40 });
  sign.scale.multiplyScalar(0.6);
  sign.position.set(0.3, 0.62, d / 2 + 0.01);
  g.add(sign);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, w, d, r, 1.3);
  const it: Interactable = { kind: 'coffee', label: 'Coffee machine', x: p.x + Math.sin(r) * 1.1, y: g.position.y, z: p.z + Math.cos(r) * 1.1, radius: 1.5 };
  g.userData.interact = it;
  return it;
}

/** Each of the furnishings an agentix map can place (the shell puts up the rest). */
export const FURNISHING_PROPS = {
  plant,
  armoire,
  monitor,
  basket,
  gong: (kit: AgentixKit, p: PropConfig) => {
    const gong = buildGong({ x: p.x, y: kit.floorAt(p.x, p.z), z: p.z, rotY: p.rotY ?? 0 });
    kit.group.add(gong.group);
    kit.colliders.push(...gong.colliders);
    kit.interactables.push(gong.interactable);
    kit.gong = gong;
  },
  coffee: (kit: AgentixKit, p: PropConfig) => kit.interactables.push(coffee(kit, p)),
} satisfies Record<'plant' | 'armoire' | 'monitor' | 'basket' | 'gong' | 'coffee', (kit: AgentixKit, p: PropConfig) => void>;
