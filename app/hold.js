// Hold to confirm: a button that acts only once it's been held down for a while, filling as it goes. Letting go
// early empties it and does nothing. The timing is here, apart from the page, so it's unit-tested with a fake
// clock and frames; yourdata.js wires it to touch, mouse and keyboard.

export const HOLD_MS = 3000;
const REDUCED_STEPS = 3; // with reduced motion the fill moves in thirds (one a second), not smoothly

/**
 * A hold timer: start() begins (again only after it's ended), cancel() ends early, and onProgress(0…1) follows
 * every frame, back to 0 on a cancel. onDone() runs once when the hold reaches `ms`, after a last onProgress(1).
 * `clock` gives milliseconds and `frame`/`cancelFrame` schedule the next tick; the page passes the browser's.
 */
export function holdTimer({ ms = HOLD_MS, onProgress, onDone, clock, frame, cancelFrame }) {
  let started = null;
  let pending = null;
  const tick = () => {
    if (started == null) return; // a frame that ran anyway after a cancel
    const progress = Math.min(1, (clock() - started) / ms);
    onProgress(progress);
    if (progress < 1) {
      pending = frame(tick);
      return;
    }
    started = pending = null;
    onDone();
  };
  return {
    start() {
      if (started != null) return;
      started = clock();
      onProgress(0);
      pending = frame(tick);
    },
    cancel() {
      if (started == null) return;
      cancelFrame(pending);
      started = pending = null;
      onProgress(0);
    },
    get holding() {
      return started != null;
    },
  };
}

/** How full to draw the button: smooth, or in whole steps with reduced motion (so it still shows progress). */
export function holdFill(progress, reducedMotion) {
  return reducedMotion ? Math.floor(progress * REDUCED_STEPS) / REDUCED_STEPS : progress;
}
