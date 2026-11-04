import * as THREE from 'three';
import { OUTLOOK } from '../../../shared/maps/agentix';
import { tilingCanvasTexture } from '../texture';
import { toon } from '../toon';
import { BUILDINGS, GREEN, ROADS, STREAMS, WATER } from './lehel-data';
import { buildTrees, seeded, type Layout, type Pt } from './lehel-trees';

/*
 * What is outside the agentix office's window: Lehel, Munich, from OpenStreetMap (lehel-data.ts, made by
 * scripts/lehel-from-osm.py; map data (c) OpenStreetMap contributors, ODbL). Ground, green areas, water
 * (the Eisbach and the Isar, with a slow shimmer), roads, extruded houses in old-town colours, and trees
 * (lehel-trees.ts). All of it merges into seven draw calls. The sizes of the houses are guesses from the
 * storeys OpenStreetMap lists. OpenStreetMap does not say which outline is No. 48, so none is.
 */

/** Where the address point is in the hall's own coordinates: at the real room's window, in the wall (x = -8.7, z = -9 in agentix.ts). */
export const LEHEL_ORIGIN = { x: -8.7, z: -9 } as const;
/** A storey, in metres. */
const STOREY = 3.4;
/** How far apart the layers on the ground sit (m), so they do not flicker through each other; the haze hides the far ones. */
const LAYER = 0.07;

const B = (OUTLOOK.bearing * Math.PI) / 180;
const COS = Math.cos(B);
const SIN = Math.sin(B);

/**
 * East and north (metres from the address point) to the frame outside the window: x to the right of it,
 * z away from it (the window looks along -z, so a point due along the bearing lands at -z).
 */
export function toLehel(e: number, n: number): Pt {
  return [e * COS - n * SIN, -(e * SIN + n * COS)];
}

/**
 * A direction in the app's compass frame (north is -z, as the sky has it) turned into this map's: its
 * -z is the bearing 314, not north. For the map's `mood` to point the sun's light the real way.
 */
export function turnToLehel<V extends THREE.Vector3>(v: V): V {
  const x = v.x * COS + v.z * SIN;
  v.z = v.z * COS - v.x * SIN;
  v.x = x;
  return v;
}

const points = (flat: number[], from = 0): Pt[] => {
  const out: Pt[] = [];
  for (let i = from; i + 1 < flat.length; i += 2) out.push(toLehel(flat[i], flat[i + 1]));
  return out;
};

const area = (r: Pt[]) => r.reduce((s, p, i) => s + (p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1]), 0) / 2;

/** Flat colored triangles, textured or not, collected and made into one geometry. */
class Soup {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();

  /** One triangle, wound so that it faces `want` (a, b and c are [x, y, z]; uvs are [u, v] each). */
  tri(a: number[], b: number[], c: number[], want: number[], color: string, uv?: number[][]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const v = flip ? [a, c, b] : [a, b, c];
    const t = uv ? (flip ? [uv[0], uv[2], uv[1]] : uv) : v.map((p) => [p[0] / 14, p[2] / 14]);
    this.c.set(color);
    v.forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(want[0], want[1], want[2]);
      this.uv.push(t[i][0], t[i][1]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    });
  }

  /** A flat polygon lying at height `y`. */
  fill(ring: Pt[], y: number, color: string) {
    const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [i, j, k] of tris) this.tri([ring[i][0], y, ring[i][1]], [ring[j][0], y, ring[j][1]], [ring[k][0], y, ring[k][1]], [0, 1, 0], color);
  }

  /** A strip of road `w` wide along a line, at height `y`. */
  ribbon(line: Pt[], w: number, y: number, color: string) {
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len;
      const nz = (b[0] - a[0]) / len;
      // Where two pieces meet the strip is wider by 1 / cos of the bend (not more than twice).
      let k = 1;
      if (i > 0 && i < line.length - 1) {
        const p = line[i - 1];
        const q = line[i + 1];
        const l1 = Math.hypot(line[i][0] - p[0], line[i][1] - p[1]) || 1;
        const l2 = Math.hypot(q[0] - line[i][0], q[1] - line[i][1]) || 1;
        const dot = ((line[i][0] - p[0]) * (q[0] - line[i][0]) + (line[i][1] - p[1]) * (q[1] - line[i][1])) / (l1 * l2);
        k = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + dot) / 2)));
      }
      left.push([line[i][0] + nx * (w / 2) * k, line[i][1] + nz * (w / 2) * k]);
      right.push([line[i][0] - nx * (w / 2) * k, line[i][1] - nz * (w / 2) * k]);
    }
    for (let i = 1; i < line.length; i++) {
      const p = (q: Pt) => [q[0], y, q[1]];
      this.tri(p(left[i - 1]), p(right[i - 1]), p(left[i]), [0, 1, 0], color);
      this.tri(p(right[i - 1]), p(right[i]), p(left[i]), [0, 1, 0], color);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

/** One window in a bay of a storey, on a pale wall that the building's own color is multiplied into. */
function wallTexture(): THREE.CanvasTexture {
  return tilingCanvasTexture(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#d9d6cf';
    g.fillRect(0, 118, 128, 10);
    g.fillStyle = '#c9c6bf';
    g.fillRect(34, 22, 60, 80);
    g.fillStyle = '#5d6f7d';
    g.fillRect(39, 27, 50, 70);
    g.fillStyle = '#f2f2ee';
    g.fillRect(62, 27, 4, 70);
    g.fillRect(39, 57, 50, 4);
    g.fillStyle = '#8fa3b2';
    g.fillRect(41, 29, 19, 26);
    g.fillRect(68, 29, 19, 26);
    g.fillStyle = '#e4e1da';
    g.fillRect(30, 102, 68, 5);
  });
}

/** Soft light streaks drifting on dark green water. */
function waterTexture(): THREE.CanvasTexture {
  const rand = seeded(7);
  return tilingCanvasTexture(128, 128, (g) => {
    g.fillStyle = '#5f8683';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 46; i++) {
      const x = rand() * 128;
      const y = rand() * 128;
      const w = 8 + rand() * 26;
      g.fillStyle = rand() < 0.5 ? 'rgba(215,236,230,0.22)' : 'rgba(40,78,80,0.22)';
      // Drawn twice, once a tile over, so they wrap round the edges.
      for (const dx of [-128, 0, 128]) g.fillRect(x + dx, y, w, 1.6 + rand() * 1.4);
    }
  });
}

const WALLS = ['#efe6cf', '#e0c88f', '#d2d1cb', '#ead9a8', '#e6c8b2', '#f3eee2'];
const ROOFS = ['#9c5b47', '#7d7f86', '#8a4f3d', '#a56a4f'];

/** The smallest rectangle round a ring, turned to fit it: [center x, center z, along x', along z', angle]. */
function fitRect(ring: Pt[]) {
  let best = { a: Infinity, cx: 0, cz: 0, w: 0, d: 0, ang: 0 };
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of ring) {
      const u = r[0] * c + r[1] * s;
      const v = -r[0] * s + r[1] * c;
      x0 = Math.min(x0, u);
      x1 = Math.max(x1, u);
      z0 = Math.min(z0, v);
      z1 = Math.max(z1, v);
    }
    if ((x1 - x0) * (z1 - z0) < best.a) {
      const u = (x0 + x1) / 2;
      const v = (z0 + z1) / 2;
      best = { a: (x1 - x0) * (z1 - z0), cx: u * c - v * s, cz: u * s + v * c, w: x1 - x0, d: z1 - z0, ang };
    }
  }
  return best;
}

/** A house: its walls (a window texture), and a pitched roof when it is nearly a rectangle, else a flat one. */
function house(ring: Pt[], levels: number, seed: number, y0: number, walls: Soup, roofs: Soup) {
  const rand = seeded(seed * 7919 + 13);
  const wall = WALLS[Math.floor(rand() * WALLS.length)];
  const roof = ROOFS[Math.floor(rand() * ROOFS.length)];
  const h = levels * STOREY;
  const sign = Math.sign(area(ring)) || 1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 0.2) continue;
    // The outside is to the right of the way round when the ring runs counter-clockwise (x right, z up on paper).
    const out = [((q[1] - p[1]) / len) * sign, 0, (-(q[0] - p[0]) / len) * sign];
    const bays = Math.max(1, Math.round(len / STOREY));
    const a = [p[0], y0, p[1]];
    const b = [q[0], y0, q[1]];
    const at = [p[0], y0 + h, p[1]];
    const bt = [q[0], y0 + h, q[1]];
    walls.tri(a, b, bt, out, wall, [[0, 0], [bays, 0], [bays, levels]]);
    walls.tri(a, bt, at, out, wall, [[0, 0], [bays, levels], [0, levels]]);
  }
  const r = fitRect(ring);
  const rect = r.w * r.d;
  if (levels >= 3 && Math.abs(area(ring)) / rect > 0.8 && Math.min(r.w, r.d) < 24) {
    // Pitched: the ridge runs along the long side.
    const long = r.w >= r.d;
    const [hw, hd] = long ? [r.w / 2 + 0.3, r.d / 2 + 0.3] : [r.d / 2 + 0.3, r.w / 2 + 0.3];
    const rise = Math.min(3.6, Math.min(r.w, r.d) * 0.3);
    const c = Math.cos(r.ang + (long ? 0 : Math.PI / 2));
    const s = Math.sin(r.ang + (long ? 0 : Math.PI / 2));
    const P = (u: number, v: number, up: number) => [r.cx + u * c - v * s, y0 + h + up, r.cz + u * s + v * c];
    const c1 = P(-hw, -hd, -0.2);
    const c2 = P(hw, -hd, -0.2);
    const c3 = P(hw, hd, -0.2);
    const c4 = P(-hw, hd, -0.2);
    const r1 = P(-hw + 0.3, 0, rise);
    const r2 = P(hw - 0.3, 0, rise);
    const side = (a: number[], b: number[], c: number[], d: number[], col: string) => {
      const n = ([(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]);
      const want = n[1] < 0 ? n.map((v) => -v) : n;
      roofs.tri(a, b, c, want, col);
      roofs.tri(a, c, d, want, col);
    };
    side(c1, c2, r2, r1, roof);
    side(c4, c3, r2, r1, roof);
    // The gable ends, in the wall's color.
    const gable = (a: number[], b: number[], top: number[], ox: number) => roofs.tri(a, b, top, [ox * c, 0, ox * s], wall);
    gable(c1, c4, r1, -1);
    gable(c2, c3, r2, 1);
  } else {
    roofs.fill(ring.map((p) => [p[0], p[1]] as Pt), y0 + h + 0.1, '#8d8a85');
  }
}

/** The merged mesh for `soup` in `material`; empty soups give an empty mesh. */
const meshOf = (soup: Soup, material: THREE.Material) => {
  const m = new THREE.Mesh(soup.geometry(), material);
  m.frustumCulled = false;
  return m;
};

/**
 * Lehel, Munich, for the agentix map: a group in the hall's coordinates (x right of the window, -z the way
 * it looks, which is bearing 314), its ground `OUTLOOK.floorY` below the floor. See LEHEL_ORIGIN for where
 * the address point is.
 */
export function buildLehel(): { group: THREE.Group; dispose(): void } {
  const y0 = -OUTLOOK.floorY;
  const group = new THREE.Group();
  group.name = 'lehel';
  group.position.set(LEHEL_ORIGIN.x, 0, LEHEL_ORIGIN.z);
  const gradientMap = (toon('#ffffff') as THREE.MeshToonMaterial).gradientMap;

  // The ground, then the green, then (in a layer of its own) the roads and paths.
  const ground = new THREE.Group();
  const flat = new Soup();
  const disc: Pt[] = Array.from({ length: 40 }, (_, i) => [Math.cos((i / 40) * Math.PI * 2) * 340, -Math.sin((i / 40) * Math.PI * 2) * 340]);
  flat.fill(disc, y0, '#9aa57f');
  const layout: Layout = {
    buildings: [],
    water: [],
    lines: [],
    green: [],
    hall: { minX: -12 - LEHEL_ORIGIN.x, maxX: 12 - LEHEL_ORIGIN.x, minZ: -9 - LEHEL_ORIGIN.z, maxZ: 9 - LEHEL_ORIGIN.z },
  };
  for (const g of GREEN) {
    const ring = points(g, 1);
    layout.green.push({ kind: g[0], ring });
    flat.fill(ring, y0 + LAYER, g[0] === 0 ? '#7fa062' : g[0] === 1 ? '#8cab68' : '#b4693f');
  }
  for (const [w, lines] of ROADS) {
    for (const l of lines) {
      const pts = points(l);
      layout.lines.push({ w, pts, water: false });
      // Streets in grey, paths in warm sand.
      flat.ribbon(pts, w, y0 + LAYER * (w >= 3 ? 3 : 4), w >= 3 ? '#7f8084' : '#c1b79f');
    }
  }
  ground.add(meshOf(flat, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap })));

  // The water, which drifts: a texture slid along the surface.
  const wet = new Soup();
  for (const w of WATER) {
    const ring = points(w);
    layout.water.push(ring);
    wet.fill(ring, y0 + LAYER * 2, '#ffffff');
  }
  for (const [w, lines] of STREAMS) {
    for (const l of lines) {
      const pts = points(l);
      layout.lines.push({ w, pts, water: true });
      wet.ribbon(pts, w, y0 + LAYER * 2, '#ffffff');
    }
  }
  const shimmer = waterTexture();
  const watery = new THREE.MeshToonMaterial({ map: shimmer, vertexColors: true, gradientMap });
  const water = meshOf(wet, watery);
  water.onBeforeRender = () => {
    const t = performance.now() / 1000;
    shimmer.offset.set((t * 0.011) % 1, (t * 0.017) % 1);
  };
  ground.add(water);
  group.add(ground);

  // The houses.
  const walls = new Soup();
  const roofs = new Soup();
  BUILDINGS.forEach((b, i) => {
    const ring = points(b, 1);
    layout.buildings.push(ring);
    house(ring, b[0], i, y0, walls, roofs);
  });
  const wallTex = wallTexture();
  group.add(meshOf(walls, new THREE.MeshToonMaterial({ map: wallTex, vertexColors: true, gradientMap })));
  group.add(meshOf(roofs, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap })));

  const trees = buildTrees(layout, y0);
  group.add(trees.group);
  group.userData.counts = { buildings: BUILDINGS.length, ...trees.count, drawCalls: 7 };

  group.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return {
    group,
    dispose() {
      trees.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        m.geometry.dispose();
        const mat = m.material as THREE.MeshToonMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
      group.removeFromParent();
    },
  };
}
