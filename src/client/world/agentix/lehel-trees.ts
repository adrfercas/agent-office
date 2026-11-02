import * as THREE from 'three';
import { toon } from '../toon';

// The trees and shrubs of Lehel for the agentix map's outside (outside.ts). From the first-floor window the
// photos show dense green crowns at eye level, a bit of trunk, and shrubs far below. Nothing about where
// single trees stand is known (OpenStreetMap here has no tree nodes), so they are scattered: seeded, so
// the same every time, a thick band between the window and the Eisbach, along the banks, along the streets
// and in the parks. All of them are instanced: a trunk, a crown and a shrub mesh, three draw calls.

export type Pt = [number, number];

/** What stands on the ground, in the hall's frame (x right of the window, -z the way it looks). */
export interface Layout {
  buildings: Pt[][];
  /** Water outlines (the Isar, ponds). */
  water: Pt[][];
  /** Lines with a width: the Eisbach and streams (`water`), roads and paths. */
  lines: { w: number; pts: Pt[]; water: boolean }[];
  green: { kind: number; ring: Pt[] }[];
  /** The hall, which no tree may stand in or against. */
  hall: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** A small seeded random number generator (mulberry32), so the trees are the same on every machine. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bounds = (pts: Pt[]) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
};

export function inRing(x: number, z: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** How far (x, z) is from the line a-b. */
function toSegment(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const k = dx || dz ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))) : 0;
  return Math.hypot(x - a[0] - dx * k, z - a[1] - dz * k);
}

/** Whether something of `r` metres across can't stand at (x, z): in a building, the water, the road or the hall. */
function blocker(l: Layout) {
  const near = (b: ReturnType<typeof bounds>, x: number, z: number, m: number) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
  const buildings = l.buildings.map((ring) => ({ ring, b: bounds(ring) }));
  const water = l.water.map((ring) => ({ ring, b: bounds(ring) }));
  const lines = l.lines.map((s) => ({ ...s, b: bounds(s.pts) }));
  const h = l.hall;
  return (x: number, z: number): boolean => {
    if (x > h.minX - 3 && x < h.maxX + 3 && z > h.minZ - 3 && z < h.maxZ + 3) return true;
    for (const { ring, b } of buildings) {
      if (!near(b, x, z, 2.5)) continue;
      if (inRing(x, z, ring)) return true;
      for (let i = 0; i < ring.length; i++) if (toSegment(x, z, ring[i], ring[(i + 1) % ring.length]) < 2.5) return true;
    }
    for (const { ring, b } of water) if (near(b, x, z, 0) && inRing(x, z, ring)) return true;
    for (const { w, pts, b } of lines) {
      const m = w / 2 + 0.6;
      if (!near(b, x, z, m)) continue;
      for (let i = 1; i < pts.length; i++) if (toSegment(x, z, pts[i - 1], pts[i]) < m) return true;
    }
    return false;
  };
}

interface Tree {
  x: number;
  z: number;
  h: number;
  /** In the thick band by the window: shrubs grow under it. */
  band: boolean;
}

const GREENS = ['#4d7d3a', '#5a8a3e', '#3f6b34', '#6c9a45', '#4a7a42', '#55853c', '#7a9d48', '#3a6a3a'];
/** A few turned: golden and orange, since the photos are autumn, but most of the wood stays green. */
const AUTUMN = ['#c9a23c', '#b8692f', '#a65a2a'];
const SHRUBS = ['#456f35', '#527f3b', '#3d6234', '#5d8a40'];
const RED_SHRUBS = ['#a24a3c', '#b5563f', '#8f3f36'];

export interface Trees {
  group: THREE.Group;
  count: { trees: number; shrubs: number };
  dispose(): void;
}

/** Scatters and builds the trees and the shrubs on ground at height `y0`. */
export function buildTrees(layout: Layout, y0: number): Trees {
  const rand = seeded(48);
  const range = (a: number, b: number) => a + (b - a) * rand();
  const blocked = blocker(layout);
  const trees: Tree[] = [];
  const taken = new Map<string, Tree[]>();
  const KEEP = 3.4;

  const free = (x: number, z: number): boolean => {
    // Not along the window wall: trees start about 6 m out, or the window would look into one.
    if (z > -6 && z < 3 && x > -16 && x < 28) return false;
    const cx = Math.floor(x / KEEP);
    const cz = Math.floor(z / KEEP);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const t of taken.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(t.x - x, t.z - z) < KEEP) return false;
    return !blocked(x, z);
  };
  const plant = (x: number, z: number, h: number, band = false) => {
    if (Math.abs(x) > 300 || Math.abs(z) > 300 || !free(x, z)) return;
    const t = { x, z, h, band };
    trees.push(t);
    const key = `${Math.floor(x / KEEP)},${Math.floor(z / KEEP)}`;
    taken.set(key, [...(taken.get(key) ?? []), t]);
  };

  // The thick band between the window and the Eisbach: from 6 m out to a little short of the water.
  for (let x = -75; x <= 75; x += 4.2) {
    for (let z = -7; z > -53; z -= 4.2) {
      if (rand() < (z > -17 ? 0.55 : 0.42)) continue;
      plant(x + range(-1.8, 1.8), z + range(-1.8, 1.8), range(9, 19), true);
    }
  }
  // Along the banks of the water, on both sides; the Isar's and the ponds' outlines go round, so outwards.
  const bank = (a: Pt, b: Pt, side: number, spacing: number, gap: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) return;
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    for (let d = rand() * spacing; d < len; d += spacing * range(0.7, 1.3)) {
      const off = side * range(gap, gap + 3);
      if (rand() < 0.75) plant(a[0] + ((b[0] - a[0]) * d) / len + nx * off, a[1] + ((b[1] - a[1]) * d) / len + nz * off, range(11, 19), false);
    }
  };
  for (const s of layout.lines) {
    if (!s.water) continue;
    for (let i = 1; i < s.pts.length; i++) for (const side of [-1, 1]) bank(s.pts[i - 1], s.pts[i], side, 6, s.w / 2 + 1);
  }
  for (const ring of layout.water) for (let i = 0; i < ring.length; i++) for (const side of [-1, 1]) bank(ring[i], ring[(i + 1) % ring.length], side, 8, 1.5);
  // Along the streets (plane trees), on both sides.
  for (const s of layout.lines) {
    if (s.water || s.w < 5.5) continue;
    for (let i = 1; i < s.pts.length; i++) for (const side of [-1, 1]) if (rand() < 0.8) bank(s.pts[i - 1], s.pts[i], side, 13, s.w / 2 + 1.5);
  }
  // In the parks and on the lawns.
  for (const g of layout.green) {
    const b = bounds(g.ring);
    const step = g.kind === 0 ? 8 : 16;
    const odds = g.kind === 0 ? 0.65 : g.kind === 1 ? 0.3 : 0;
    for (let x = b.minX; x < b.maxX; x += step) for (let z = b.minZ; z < b.maxZ; z += step) {
      const px = x + range(-3, 3);
      const pz = z + range(-3, 3);
      if (rand() < odds && inRing(px, pz, g.ring)) plant(px, pz, range(9, 18));
    }
  }
  // Courtyards and gardens between the houses.
  for (let i = 0; i < 260; i++) plant(range(-300, 300), range(-300, 300), range(8, 17));

  // The meshes. A trunk, one or two crowns (ellipsoids) and under the band some shrubs.
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0);
  const blobGeo = new THREE.IcosahedronGeometry(1, 1);
  const shrubs: { x: number; z: number; r: number; red: boolean }[] = [];
  const crowns: { x: number; y: number; z: number; rx: number; ry: number }[] = [];
  const trunkAt: { x: number; z: number; r: number; h: number }[] = [];
  const colors: THREE.Color[] = [];
  for (const t of trees) {
    const small = rand() < 0.15;
    const h = small ? t.h * 0.7 : t.h;
    const th = h * range(0.3, 0.42);
    const ry = h * range(0.28, 0.36);
    const rx = h * range(0.2, 0.27) + range(0.4, 1.4);
    const cy = y0 + th + ry * 0.62;
    trunkAt.push({ x: t.x, z: t.z, r: 0.16 + h * 0.011, h: th + ry * 0.7 });
    const tint = new THREE.Color(rand() < 0.07 ? AUTUMN[Math.floor(rand() * AUTUMN.length)] : GREENS[Math.floor(rand() * GREENS.length)]).offsetHSL(0, 0, range(-0.03, 0.03));
    crowns.push({ x: t.x, y: cy, z: t.z, rx, ry });
    colors.push(tint);
    if (!small) {
      const a = rand() * Math.PI * 2;
      crowns.push({ x: t.x + Math.cos(a) * rx * 0.5, y: cy + ry * range(0.1, 0.45), z: t.z + Math.sin(a) * rx * 0.5, rx: rx * 0.66, ry: ry * 0.72 });
      colors.push(tint.clone().offsetHSL(0, 0, range(-0.02, 0.05)));
    }
    if (t.band || rand() < 0.35) {
      for (let k = 0; k < 2; k++) {
        const a = rand() * Math.PI * 2;
        const d = range(1.5, 4.5);
        shrubs.push({ x: t.x + Math.cos(a) * d, z: t.z + Math.sin(a) * d, r: range(0.6, 1.3), red: rand() < 0.2 });
      }
    }
  }
  // Shrubs in the garden right under the window, far below it.
  for (let i = 0; i < 16; i++) shrubs.push({ x: range(-9, 16), z: range(-5, -1.6), r: range(0.6, 1.2), red: rand() < 0.25 });
  const shrubList = shrubs.filter((s) => !blocked(s.x, s.z) || (s.z < -1.5 && s.z > -5.2 && s.x > -9 && s.x < 16));

  const mat = (color: string) => {
    const m = toon(color).clone() as THREE.MeshToonMaterial;
    m.color.set('#ffffff');
    return m;
  };
  const trunkMat = toon('#5b4636').clone() as THREE.MeshToonMaterial;
  const crownMat = mat('#ffffff');
  const shrubMat = mat('#ffffff');
  const m4 = new THREE.Object3D();
  const group = new THREE.Group();
  const instanced = (geo: THREE.BufferGeometry, material: THREE.Material, n: number, fill: (i: number, put: (c?: THREE.Color) => void, im: THREE.InstancedMesh) => void) => {
    const im = new THREE.InstancedMesh(geo, material, Math.max(1, n));
    im.count = n;
    im.frustumCulled = false;
    for (let i = 0; i < n; i++) fill(i, () => im.setMatrixAt(i, m4.matrix), im);
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    return im;
  };

  instanced(trunkGeo, trunkMat, trunkAt.length, (i, put) => {
    const t = trunkAt[i];
    m4.position.set(t.x, y0, t.z);
    m4.rotation.set(0, 0, 0);
    m4.scale.set(t.r, t.h, t.r);
    m4.updateMatrix();
    put();
  });
  instanced(blobGeo, crownMat, crowns.length, (i, put, im) => {
    const c = crowns[i];
    m4.position.set(c.x, c.y, c.z);
    m4.rotation.set(0, i * 1.7, 0);
    m4.scale.set(c.rx, c.ry, c.rx);
    m4.updateMatrix();
    put();
    im.setColorAt(i, colors[i]);
  });
  instanced(blobGeo, shrubMat, shrubList.length, (i, put, im) => {
    const s = shrubList[i];
    m4.position.set(s.x, y0 + s.r * 0.45, s.z);
    m4.rotation.set(0, i * 2.3, 0);
    m4.scale.set(s.r * 1.2, s.r * 0.75, s.r * 1.2);
    m4.updateMatrix();
    put();
    const list = s.red ? RED_SHRUBS : SHRUBS;
    im.setColorAt(i, new THREE.Color(list[i % list.length]));
  });

  return {
    group,
    count: { trees: trees.length, shrubs: shrubList.length },
    dispose() {
      trunkGeo.dispose();
      blobGeo.dispose();
      trunkMat.dispose();
      crownMat.dispose();
      shrubMat.dispose();
      for (const c of group.children) (c as THREE.InstancedMesh).dispose();
    },
  };
}
