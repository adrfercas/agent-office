/**
 * The Graphics choice (⚙️ Settings → You): how much the 3D office is drawn with. Full is how it always
 * looked. Light is the default, for an office that stays open all day next to other work: a lower pixel
 * ratio (a 4K or scaled laptop screen draws a quarter of the pixels it would at 2), a smaller sun
 * shadow map, and the shadows redrawn only about ten times a second while nobody is using the office.
 * People and workers keep moving every frame, only their shadows catch up a little later.
 *
 * What Light costs in looks: a little less sharp on a screen scaled over 125%, and shadows with softer
 * edges. Nothing is taken out of the room.
 */
import type * as THREE from 'three';
import type { Graphics } from '../state';
import type { Ctx } from './context';
import { pacer } from './pacing';
import type { Stage } from './scene';

/** The most the renderer draws per CSS pixel (per side): Light stays near 1, Full goes up to 2. */
export const MAX_PIXEL_RATIO: Record<Graphics, number> = { light: 1.25, full: 2 };
/** The sun's shadow map (pixels per side). */
export const SHADOW_MAP: Record<Graphics, number> = { light: 1024, full: 2048 };
/** Light redraws the shadows at most this often (ms) while the office is left alone. */
export const IDLE_SHADOW_MS = 100;

/** What the renderer draws per CSS pixel for `graphics` on a screen whose ratio is `dpr`. */
export const pixelRatioFor = (graphics: Graphics, dpr: number) => Math.min(dpr, MAX_PIXEL_RATIO[graphics]);

/** Sets the renderer and the sun for `graphics`; the next frame draws with them. */
export function applyGraphics(renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight, graphics: Graphics, dpr = window.devicePixelRatio) {
  const ratio = pixelRatioFor(graphics, dpr);
  if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  const size = SHADOW_MAP[graphics];
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    // The map is made again at the new size the next time it's drawn.
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  renderer.shadowMap.autoUpdate = true;
}

/** Applies the setting as it changes, and in Light holds the shadows back while the office is left alone. */
export function installGraphics(ctx: Ctx, stage: () => Pick<Stage, 'sun'>) {
  let applied: Graphics | null = null;
  let shadowAt = -Infinity;
  ctx.ticks.add('pre', ({ now }) => {
    const graphics = ctx.settings.graphics;
    const { renderer } = ctx;
    const { sun } = stage();
    if (graphics !== applied) {
      applyGraphics(renderer, sun, graphics);
      applied = graphics;
    }
    if (graphics === 'full') return;
    // The shadow map keeps what it last drew until it's asked for again.
    const due = pacer.active(now) || now - shadowAt >= IDLE_SHADOW_MS;
    renderer.shadowMap.autoUpdate = false;
    if (due) {
      renderer.shadowMap.needsUpdate = true;
      shadowAt = now;
    }
  });
}
