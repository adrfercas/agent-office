// The Graphics choice in ⚙️ Settings (see settings.ts, and core/graphics.ts for what each one does).

import type { Graphics } from '../state';

export const GRAPHICS_CHOICES: readonly (readonly [Graphics, string])[] = [
  ['light', '🍃 Light'],
  ['full', '✨ Full'],
];

export const GRAPHICS_NOTE =
  'Light is easier on the computer, for an office you keep open all day: a little less sharp, with shadows drawn more simply, and drawn less often while you are not using it (the people keep moving). Full draws every shadow at the screen’s full sharpness, as the office used to look.';
