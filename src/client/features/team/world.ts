import * as THREE from 'three';
import { PEOPLE_DESKS } from '../../../shared/maps/agentix';
import { AVAILABILITY_LOOK, availabilityNow, type TeamMember } from '../../../shared/team';
import { CHAIR_OUT } from '../../world/agentix/furniture';
import { TABLE_TOP, box, lit, placed } from '../../world/station/kit';
import { mesh, textPlane, toon } from '../../world/toon';

// The team's part of the agentix office: where people sit and stand, the small sign over those who
// have no desk yet, the screen the remote ones are on, and a plaque on the owner's own desk. Who is
// who comes from the team file at run time; nothing about a person is in here. Every size and spot is
// an estimate on a made-up layout (see shared/maps/agentix.ts).

/** Where someone is, and which way they face. */
export interface Spot {
  x: number;
  z: number;
  rotY: number;
}

/** A person's desk seat: where they sit, which way they face (toward the desk), and the desk itself. */
export interface SeatSpot extends Spot {
  desk: Spot;
}

/** Every person's desk by id, with where whoever sits there is. The chair is the desk's own (see persondesk). */
export function seatSpots(): Map<string, SeatSpot> {
  const out = new Map<string, SeatSpot>();
  for (const d of PEOPLE_DESKS) {
    out.set(d.id, {
      x: d.x + Math.sin(d.rotY) * CHAIR_OUT,
      z: d.z + Math.cos(d.rotY) * CHAIR_OUT,
      rotY: d.rotY + Math.PI,
      desk: { x: d.x, z: d.z, rotY: d.rotY },
    });
  }
  return out;
}

/**
 * Where the `i`th person without a desk stands: in the corridor east of the real room's door, in two
 * rows facing each other, clear of the doorway and the gong.
 */
export function standingSpot(i: number): Spot {
  const row = Math.floor(i / 4) % 2;
  const col = i % 4;
  return { x: -7.4 + col * 0.8, z: row ? 1.0 : 0.2, rotY: row ? Math.PI : 0 };
}

/** The small sign over the ones standing in the corridor: on the wall (z -0.9), facing the corridor. */
const SIGN_AT = { x: -6.2, y: 2.1, z: -0.79 };
/** The remote screen: on the real room's south wall west of its doorway, facing into the room (north, -z). */
const SCREEN = { x: -10.6, y: 1.75, z: -1.02, width: 1.7, height: 0.96 };
const SCREEN_PX = 640;

/** A laptop, open, facing +z: for the desks of whoever sits at one and has no monitor of their own. */
export function laptop(): THREE.Group {
  const g = new THREE.Group();
  const body = toon('#b9bec4');
  g.add(mesh(box(0.33, 0.014, 0.23), body, 0, 0.007, 0.0, false));
  const lid = new THREE.Group();
  lid.position.set(0, 0.014, -0.11);
  lid.rotation.x = -0.28;
  lid.add(mesh(box(0.33, 0.22, 0.008), body, 0, 0.11, 0, false));
  lid.add(mesh(box(0.3, 0.19, 0.002), lit('#2c3441'), 0, 0.11, 0.005, false));
  g.add(lid);
  return g;
}

/** A flat plaque on a desk, readable from the chair (see Person: whoever sits there faces -z in the desk's own frame). */
function plaque(text: string, at: Spot): THREE.Group {
  const g = placed(at.x, TABLE_TOP + 0.002, at.z, at.rotY);
  const tag = textPlane(text, { color: '#5b5850', bg: '#f6f2e8', border: '#d9d3c3', size: 36 });
  tag.scale.multiplyScalar(0.3 / tag.geometry.parameters.width);
  tag.rotation.x = -Math.PI / 2;
  tag.position.set(0.3, 0, 0.3);
  g.add(tag);
  return g;
}

/** The first word of someone's name: what the tag over their head says. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * What the team adds to the room besides the people: the "no desk yet" sign, the remote screen and
 * the owner's plaque. All of it is put in `parent` and taken out again by `dispose`.
 */
export class TeamRoom {
  readonly group = new THREE.Group();
  private sign: THREE.Mesh;
  private screen: THREE.Group;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private mine: THREE.Group | null = null;
  private drawn = '';

  constructor(parent: THREE.Object3D) {
    this.sign = textPlane('no desk yet', { color: '#6d6a62', bg: '#f6f2e8', border: '#d9d3c3', size: 40 });
    this.sign.scale.multiplyScalar(0.55);
    this.sign.position.set(SIGN_AT.x, SIGN_AT.y, SIGN_AT.z);
    this.sign.visible = false;
    this.group.add(this.sign);

    this.canvas.width = SCREEN_PX;
    this.canvas.height = Math.round((SCREEN_PX * SCREEN.height) / SCREEN.width);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.width, SCREEN.height), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    face.position.z = 0.016;
    this.screen = placed(SCREEN.x, SCREEN.y, SCREEN.z, Math.PI);
    this.screen.add(mesh(box(SCREEN.width + 0.08, SCREEN.height + 0.08, 0.03), toon('#1a1c20'), 0, 0, 0, false));
    this.screen.add(face);
    this.screen.visible = false;
    this.group.add(this.screen);
    parent.add(this.group);
  }

  /** Shows the sign only while someone stands under it. */
  setStanding(count: number) {
    this.sign.visible = count > 0;
  }

  /** Marks the owner's own desk (or none) with a plaque, without saying whose it is by name. */
  setMine(desk: Spot | null) {
    this.mine?.removeFromParent();
    this.mine = null;
    if (!desk) return;
    this.mine = plaque('your desk', desk);
    this.group.add(this.mine);
  }

  /** Paints the remote screen: a tile for each, with their light. Hidden when there is nobody remote. */
  setRemote(members: TeamMember[], now: number) {
    this.screen.visible = members.length > 0;
    const key = members.map((m) => `${m.id}|${firstName(m.name)}|${m.role}|${availabilityNow(m.availability, now)}`).join(';');
    if (!members.length || key === this.drawn) return;
    this.drawn = key;
    const { width: w, height: h } = this.canvas;
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#15181d';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '700 26px Nunito, ui-rounded, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8fa3b5';
    ctx.fillText('remote', 22, 28);
    const cols = members.length > 4 ? 3 : 2;
    const rows = Math.ceil(members.length / cols);
    const tw = (w - 44 - (cols - 1) * 14) / cols;
    const th = Math.min(110, (h - 70 - (rows - 1) * 14) / rows);
    members.slice(0, cols * 4).forEach((m, i) => {
      const x = 22 + (i % cols) * (tw + 14);
      const y = 56 + Math.floor(i / cols) * (th + 14);
      ctx.fillStyle = '#232830';
      ctx.fillRect(x, y, tw, th);
      ctx.fillStyle = AVAILABILITY_LOOK[availabilityNow(m.availability, now)].color;
      ctx.beginPath();
      ctx.arc(x + 26, y + th / 2, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eef2f6';
      ctx.font = '800 30px Nunito, ui-rounded, system-ui, sans-serif';
      ctx.fillText(firstName(m.name), x + 52, y + th / 2 - 14, tw - 62);
      ctx.fillStyle = '#9aa7b4';
      ctx.font = '600 21px Nunito, ui-rounded, system-ui, sans-serif';
      ctx.fillText(m.role, x + 52, y + th / 2 + 18, tw - 62);
    });
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.tex.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat.map) {
        mat.map.dispose();
        mat.dispose();
      }
    });
  }
}
