/**
 * How often the office is drawn. Walking about, it's every frame the screen has. Left alone it's a
 * picture of the team, and it doesn't need 60 pictures a second to be one: after a few quiet seconds
 * the frames come less often (people still move, only in smaller steps), less often still while the
 * window sits behind others, and not at all while the tab is hidden.
 *
 * `Pacer` only decides; the frame loop (core/loop.ts) asks it, and `listenForInput` tells it when
 * someone touches the office.
 */

/** Quiet for this long (ms), with nothing held down, and the office is left alone. */
export const IDLE_AFTER = 4000;
/** The most frames a second while it's left alone, in the window that has the focus. */
export const IDLE_FPS = 20;
/** And while another window has the focus: still animated, but as little as keeps it from looking stuck. */
export const BEHIND_FPS = 10;

/** What the page says about itself. */
export interface PageState {
  /** The tab is hidden, or the window is covered or minimised. */
  hidden(): boolean;
  /** The window has the focus. */
  focused(): boolean;
}

export const livePage: PageState = {
  hidden: () => document.hidden,
  focused: () => document.hasFocus(),
};

export class Pacer {
  private lastInput: number;
  private held = new Set<string>();
  private buttons = 0;
  /** Something else that keeps the office busy (you're walking, a trip is under way): see installLoop. */
  busy: () => boolean = () => false;
  /** Whether the last answer `wait` gave was for a slower pace than every frame. */
  relaxed = false;
  /** Called when something happens that may need the loop out of a long wait (set by the frame loop). */
  wake: () => void = () => {};

  constructor(
    private page: PageState = livePage,
    start = 0,
  ) {
    this.lastInput = start;
  }

  /** Someone touched the office at `now`: moved the mouse, pressed a key, scrolled. */
  touch(now: number) {
    this.lastInput = now;
    this.wake();
  }

  key(code: string, down: boolean, now: number) {
    if (down) this.held.add(code);
    else this.held.delete(code);
    this.touch(now);
  }

  button(down: boolean, now: number) {
    this.buttons = Math.max(0, this.buttons + (down ? 1 : -1));
    this.touch(now);
  }

  /** The window lost the focus: whatever was held down will never be let go of here. */
  lostFocus() {
    this.held.clear();
    this.buttons = 0;
  }

  /** Whether someone is using the office, as far as the keys, the mouse and what's under way say. */
  active(now: number): boolean {
    return this.held.size > 0 || this.buttons > 0 || now - this.lastInput < IDLE_AFTER || this.busy();
  }

  /** The least time (ms) between two frames now: 0 for every one, `Infinity` for none (hidden). */
  gap(now: number): number {
    if (this.page.hidden()) return Infinity;
    if (!this.page.focused()) return 1000 / BEHIND_FPS;
    return this.active(now) ? 0 : 1000 / IDLE_FPS;
  }

  /** How long (ms) from `now` until the next frame is due, given the last was drawn at `last`: 0 if it is, `Infinity` if none is. */
  wait(now: number, last: number): number {
    const gap = this.gap(now);
    this.relaxed = gap > 0;
    return gap === Infinity ? Infinity : Math.max(0, last + gap - now);
  }
}

/** The one pacer the office's frame loop asks. Its start is now, so loading and arriving are drawn in full. */
export const pacer = new Pacer(livePage, typeof performance === 'undefined' ? 0 : performance.now());

/** Tells `p` when someone uses the office, and when the tab or the window changes under it. Returns what undoes it. */
export function listenForInput(p: Pacer, win: Window = window, doc: Document = document): () => void {
  const now = () => performance.now();
  const on: [EventTarget, string, (e: never) => void][] = [
    [win, 'keydown', (e: KeyboardEvent) => p.key(e.code, true, now())],
    [win, 'keyup', (e: KeyboardEvent) => p.key(e.code, false, now())],
    [win, 'pointerdown', () => p.button(true, now())],
    [win, 'pointerup', () => p.button(false, now())],
    [win, 'pointercancel', () => p.lostFocus()],
    [win, 'pointermove', () => p.touch(now())],
    [win, 'wheel', () => p.touch(now())],
    [win, 'touchstart', () => p.touch(now())],
    [win, 'blur', () => p.lostFocus()],
    [win, 'focus', () => p.touch(now())],
    [doc, 'visibilitychange', () => p.touch(now())],
  ];
  // Capture, so a part that stops the event never hides it from the pacer.
  for (const [target, type, fn] of on) target.addEventListener(type, fn as EventListener, { capture: true, passive: true });
  return () => {
    for (const [target, type, fn] of on) target.removeEventListener(type, fn as EventListener, { capture: true });
  };
}
