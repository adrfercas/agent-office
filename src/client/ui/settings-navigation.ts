// The Look speed slider in ⚙️ Settings (see settings.ts, and features/navigation for what it changes).

import { LOOK_SPEED_MAX, LOOK_SPEED_MIN } from '../features/navigation/gesture';
import { h } from './dom';

export const LOOK_SPEED_NOTE = 'How fast the view turns when you drag, swipe with two fingers on a touchpad or move a captured mouse. 100% is the usual speed. Pinching or the mouse wheel zooms.';

/** The slider. `get` says the speed now (1 is 100%), and `set` changes it. */
export function lookSpeedRow(get: () => number, set: (speed: number) => void): HTMLElement {
  const slider = h('input', { type: 'range', min: LOOK_SPEED_MIN * 100, max: LOOK_SPEED_MAX * 100, step: 5, 'aria-label': 'Look speed' }) as HTMLInputElement;
  const pct = h('span.vol-pct');
  const paint = () => {
    const v = Math.round(get() * 100);
    slider.value = String(v);
    slider.style.setProperty('--fill', `${((v - LOOK_SPEED_MIN * 100) / ((LOOK_SPEED_MAX - LOOK_SPEED_MIN) * 100)) * 100}%`);
    pct.textContent = `${v}%`;
  };
  paint();
  slider.addEventListener('input', () => {
    set(Number(slider.value) / 100);
    paint();
  });
  return h('div.volume', {}, slider, pct);
}
