import { useSyncExternalStore } from 'react';

/**
 * Viewport metrics that CSS alone gets wrong on a phone.
 *
 * Two separate problems, both of which the app hit:
 *
 * 1. **The on-screen keyboard hides `position: fixed` bottom bars.** iOS does
 *    not shrink the layout viewport when the keyboard opens, so every "Save" /
 *    "Add" bar pinned to `bottom: 0` — and the sticky footer of every bottom
 *    sheet — ends up *behind* the keyboard the moment a field is focused.
 *    There is no way back to it: the bar cannot be scrolled to, because it is
 *    not in the scroll flow. Editing a portion and saving it was, literally,
 *    impossible. `visualViewport` is the only API that reports how much of the
 *    screen the keyboard took, so we measure it and publish it.
 *
 * 2. **`env(safe-area-inset-bottom)` is not constant while you scroll.** In
 *    mobile Safari it flips between 0 and the home-indicator height as the
 *    toolbars collapse and expand, which re-lays-out anything padded with it —
 *    the bottom nav visibly jitters against the scrolling content. Sampling it
 *    once and holding the largest value seen gives a stable number, which is
 *    what a fixed bar needs.
 *
 * Both are published as custom properties on `<html>`, so plain CSS can use
 * them without every bar subscribing:
 *
 *   --kb-inset     px hidden by the keyboard (0 when closed)
 *   --safe-bottom  stable bottom safe-area inset
 *   --safe-top     stable top safe-area inset
 *
 * `<html>` also carries `data-keyboard="open"` while the keyboard is up, for
 * chrome that should get out of the way rather than move.
 */

export interface ViewportRect {
  /** Top of the visible area, in layout-viewport coordinates. */
  top: number;
  /** Height of the visible area. */
  height: number;
  /**
   * Pixels hidden at the bottom by the keyboard, 0 when it is closed. This is
   * exactly the `bottom` a fixed bar needs to sit on the keyboard's top edge.
   */
  keyboard: number;
}

/**
 * Below this, a shrunken visual viewport is a collapsing browser toolbar, not
 * a keyboard. Without the floor, every scroll that nudges Safari's chrome
 * would read as the keyboard opening and shove the bottom bars around.
 */
const KEYBOARD_MIN_PX = 120;

let current: ViewportRect = { top: 0, height: 0, keyboard: 0 };
const listeners = new Set<() => void>();

/**
 * Held rather than re-read: the inset itself is what flickers, so the largest
 * value seen is the honest one. It only genuinely changes on rotation, where
 * it is re-sampled from scratch.
 */
let safeBottom = 0;
let safeTop = 0;

function measure(): ViewportRect {
  const vv = window.visualViewport;
  if (!vv) return { top: 0, height: window.innerHeight, keyboard: 0 };

  const occluded = window.innerHeight - vv.height - vv.offsetTop;
  return {
    top: Math.round(vv.offsetTop),
    height: Math.round(vv.height),
    keyboard: occluded >= KEYBOARD_MIN_PX ? Math.round(occluded) : 0,
  };
}

/**
 * `env()` is not readable from script, so a throwaway element is sized by it
 * and measured. Kept out of the flow and out of the a11y tree.
 */
function sampleSafeAreas(reset = false): void {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const top = parseFloat(style.paddingTop) || 0;
  const bottom = parseFloat(style.paddingBottom) || 0;
  probe.remove();

  if (reset) {
    safeTop = top;
    safeBottom = bottom;
  } else {
    safeTop = Math.max(safeTop, top);
    safeBottom = Math.max(safeBottom, bottom);
  }

  const root = document.documentElement;
  root.style.setProperty('--safe-top', `${safeTop}px`);
  root.style.setProperty('--safe-bottom', `${safeBottom}px`);
}

function publish(next: ViewportRect): void {
  if (
    next.top === current.top &&
    next.height === current.height &&
    next.keyboard === current.keyboard
  ) {
    return;
  }

  const keyboardChanged = next.keyboard !== current.keyboard;
  current = next;

  const root = document.documentElement;
  root.style.setProperty('--kb-inset', `${next.keyboard}px`);
  if (keyboardChanged) {
    if (next.keyboard > 0) root.setAttribute('data-keyboard', 'open');
    else root.removeAttribute('data-keyboard');
  }

  for (const fn of listeners) fn();
}

let installed = false;
let frame = 0;

/** Coalesced to one write per frame; `visualViewport` fires resize very fast. */
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    publish(measure());
  });
}

/** Idempotent; safe to call from module scope. */
export function installViewportMetrics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  sampleSafeAreas();
  publish(measure());

  const vv = window.visualViewport;
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);

  // Rotation genuinely changes the safe areas, so this is the one place the
  // held maximum is thrown away. The delay lets the new orientation settle —
  // sampled immediately, the probe still reports the old edges.
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      sampleSafeAreas(true);
      schedule();
    }, 300);
  });
}

function subscribe(fn: () => void): () => void {
  installViewportMetrics();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const getSnapshot = () => current;

/**
 * The visible rectangle, for the few places that need the number in JS rather
 * than in CSS — chiefly the bottom sheet, which has to size itself to fit.
 */
export function useViewportRect(): ViewportRect {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** True while the on-screen keyboard is covering part of the page. */
export function useKeyboardOpen(): boolean {
  return useViewportRect().keyboard > 0;
}
