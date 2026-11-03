// What a wheel event means: a pinch and a mouse wheel zoom, two fingers turn the view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WheelReader, ZOOM_IN_MOST, ZOOM_OUT_MOST, distanceAfter, looksLikeMouseWheel, zoomBy, type WheelInput } from '../src/client/features/navigation/gesture';

const wheel = (some: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...some });

test('a pinch zooms, in with fingers apart and out with them together', () => {
  const r = new WheelReader();
  const apart = r.read(wheel({ deltaY: -10, ctrlKey: true }), 0);
  const together = r.read(wheel({ deltaY: 10, ctrlKey: true }), 10);
  assert.equal(apart.kind, 'zoom');
  assert.ok(apart.kind === 'zoom' && apart.amount > 0);
  assert.ok(together.kind === 'zoom' && together.amount < 0);
});

test('Ctrl with a mouse wheel is taken for one big pinch, without jumping', () => {
  const meant = new WheelReader().read(wheel({ deltaY: -100, wheelDeltaY: 120, ctrlKey: true }), 0);
  assert.ok(meant.kind === 'zoom' && meant.amount <= 0.25);
});

test('a mouse wheel notch zooms, reported in pixels or in lines', () => {
  const pixels = new WheelReader().read(wheel({ deltaY: -100, wheelDeltaY: 120 }), 0);
  assert.ok(pixels.kind === 'zoom' && pixels.amount > 0);
  const lines = new WheelReader().read(wheel({ deltaY: 3, deltaMode: 1 }), 0);
  assert.ok(lines.kind === 'zoom' && lines.amount < 0);
});

test('two fingers turn the view, both ways at once, with the sign the browser gives', () => {
  const meant = new WheelReader().read(wheel({ deltaX: 12, deltaY: -5, wheelDeltaY: 15 }), 0);
  assert.equal(meant.kind, 'turn');
  assert.ok(meant.kind === 'turn' && meant.dx > 0 && meant.dy < 0);
});

test('a two-finger step that happens to look like a notch stays part of the swipe, until the swipe has stopped', () => {
  const r = new WheelReader();
  assert.equal(r.read(wheel({ deltaY: 4, wheelDeltaY: -12 }), 0).kind, 'turn');
  const notchLike = wheel({ deltaY: -100, wheelDeltaY: 120 });
  assert.equal(r.read(notchLike, 50).kind, 'turn');
  assert.equal(r.read(notchLike, 1000).kind, 'zoom');
});

test('what counts as a mouse wheel on its own', () => {
  assert.equal(looksLikeMouseWheel(wheel({ deltaY: 100, wheelDeltaY: -120 })), true);
  assert.equal(looksLikeMouseWheel(wheel({ deltaY: 200, wheelDeltaY: -240 })), true);
  assert.equal(looksLikeMouseWheel(wheel({ deltaY: 3, deltaMode: 1 })), true);
  assert.equal(looksLikeMouseWheel(wheel({ deltaY: 7, wheelDeltaY: -21 })), false);
  assert.equal(looksLikeMouseWheel(wheel({ deltaX: 3, deltaY: 100, wheelDeltaY: -120 })), false);
  assert.equal(looksLikeMouseWheel(wheel({ deltaY: 7 })), false);
});

test('zoom and the camera distance stay in range', () => {
  assert.equal(zoomBy(0, 100), ZOOM_IN_MOST);
  assert.equal(zoomBy(0, -100), ZOOM_OUT_MOST);
  assert.equal(zoomBy(0.2, 0.1), 0.2 + 0.1);
  assert.equal(distanceAfter(7.5, 100), 2.5);
  assert.equal(distanceAfter(7.5, -100), 16);
  assert.ok(distanceAfter(7.5, 0.15) < 7.5);
});
