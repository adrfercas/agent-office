/**
 * Zooming and the touchpad: a mouse wheel or a pinch zooms, and two fingers turn the view, in first and
 * third person alike. In first person zooming narrows the field of view (you don't move); in third it
 * brings the camera closer. What each wheel event means is in gesture.ts.
 *
 * ⚙️ Settings → Look speed (Settings.lookSpeed) sets how fast dragging, two fingers and a captured mouse
 * all turn the view. Zoomed in, they turn slower with it, so what's on screen moves the same.
 */
import type { Ctx } from '../../core/context';
import { WheelReader, distanceAfter, zoomBy } from './gesture';

export function installNavigation(ctx: Ctx) {
  const reader = new WheelReader();
  /** How far in you've zoomed in first person (see gesture.ts). Not kept between visits. */
  let zoom = 0;
  /** Whatever has the camera to itself (the golf tee, the dart board) sets its own view. */
  const ownView = () => ctx.player.view === 'first' && !ctx.activities.any('takesCamera');

  ctx.canvas.addEventListener(
    'wheel',
    (e) => {
      // Never the browser's own zoom or scroll, over the office.
      e.preventDefault();
      const { player } = ctx;
      if (!player.enabled) return;
      const meant = reader.read(e, performance.now());
      if (meant.kind === 'turn') {
        if (player.mouseLook) player.lookBy(meant.dx, meant.dy);
      } else if (player.view === 'third') player.camDist = distanceAfter(player.camDist, meant.amount);
      else if (ownView()) zoom = zoomBy(zoom, meant.amount);
    },
    { passive: false },
  );

  ctx.view.add({ fov: (fov) => (ownView() ? fov * Math.exp(-zoom) : fov) });

  ctx.ticks.add('pre', () => {
    ctx.player.lookScale = ctx.settings.lookSpeed * (ownView() ? Math.exp(-zoom) : 1);
  });
}
