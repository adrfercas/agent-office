// What a wheel event means. A touchpad and a mouse wheel both send the browser `wheel` events, so this
// tells them apart: a pinch comes with ctrlKey set (the browser's own convention), and a mouse wheel
// moves in whole notches, where two fingers send small, uneven steps, often sideways too.
//
// Pure, so the tests can feed it events without a page (see tests/navigation.test.ts).

/** The parts of a WheelEvent that matter here. `wheelDeltaY` is the browser's older field, in 120ths of a notch. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0: pixels. 1 or 2: lines or pages, which only a mouse wheel sends. */
  deltaMode: number;
  ctrlKey: boolean;
  wheelDeltaY?: number;
}

export type WheelMeaning =
  /** Zoom by this much: above 0 is closer. One step of `zoomBy`'s scale. */
  | { kind: 'zoom'; amount: number }
  /** Two fingers on a touchpad: turn the view by this many pixels of dragging. */
  | { kind: 'turn'; dx: number; dy: number };

/** How much zoom one notch of a mouse wheel is. */
const NOTCH_ZOOM = 0.15;
/** How much zoom one pixel of pinching is. */
const PINCH_ZOOM = 0.012;
/** The most a single pinch event zooms, since Ctrl with a mouse wheel looks like one huge pinch. */
const MOST_PINCH = 0.25;
/** A pixel of two fingers against a pixel of dragging: a little less, since fingers cover the pad quickly. */
const FINGER_TO_DRAG = 0.8;
/** A mouse wheel's notch in `deltaY` pixels, in browsers that report pixels. */
const NOTCH_PIXELS = 100;
/** Events this close together (ms) are the same gesture, so it isn't taken for something else halfway through. */
const SAME_GESTURE = 200;

/** Whether this event looks like a mouse wheel, on its own. */
export function looksLikeMouseWheel(e: WheelInput): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.deltaX !== 0 || e.deltaY === 0) return false;
  const notch = e.wheelDeltaY;
  return notch !== undefined && notch !== 0 && Math.abs(notch) % 120 === 0;
}

/**
 * Remembers the last gesture, because two fingers now and then send a step that looks like a notch:
 * once they've started, they stay two fingers until they've stopped.
 */
export class WheelReader {
  private fingersAt = -Infinity;

  read(e: WheelInput, now: number): WheelMeaning {
    if (e.ctrlKey) {
      const amount = -e.deltaY * PINCH_ZOOM;
      return { kind: 'zoom', amount: Math.max(-MOST_PINCH, Math.min(MOST_PINCH, amount)) };
    }
    const stillFingers = now - this.fingersAt < SAME_GESTURE;
    if (!stillFingers && looksLikeMouseWheel(e)) {
      const notches = e.deltaMode === 0 ? e.deltaY / NOTCH_PIXELS : Math.sign(e.deltaY);
      return { kind: 'zoom', amount: -notches * NOTCH_ZOOM };
    }
    this.fingersAt = now;
    return { kind: 'turn', dx: e.deltaX * FINGER_TO_DRAG, dy: e.deltaY * FINGER_TO_DRAG };
  }
}

/** First person: how far in (log scale, 0 is the usual view) the view may go. About 3x closer, and a little wider. */
export const ZOOM_IN_MOST = Math.log(3);
export const ZOOM_OUT_MOST = -Math.log(1.45);

/** The zoom after `amount` more of it, kept in range. */
export function zoomBy(zoom: number, amount: number): number {
  return Math.max(ZOOM_OUT_MOST, Math.min(ZOOM_IN_MOST, zoom + amount));
}

/** Third person: the camera's distance after `amount` of zoom. */
export function distanceAfter(dist: number, amount: number): number {
  return Math.max(2.5, Math.min(16, dist * Math.exp(-amount)));
}

/** The look speed setting's range, as a share of the usual speed. */
export const LOOK_SPEED_MIN = 0.25;
export const LOOK_SPEED_MAX = 3;
