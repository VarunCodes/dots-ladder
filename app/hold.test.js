// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";

import { HOLD_MS, holdFill, holdTimer } from "./hold.js";

/** A hold timer on a fake clock: `advance(ms)` moves time on and runs the frame that's waiting. */
function fakeHold() {
  let time = 0;
  let waiting = null;
  const progress = [];
  let done = 0;
  const timer = holdTimer({
    onProgress: (p) => progress.push(p),
    onDone: () => done++,
    clock: () => time,
    frame: (tick) => (waiting = tick),
    cancelFrame: () => (waiting = null),
  });
  const advance = (ms) => {
    time += ms;
    const tick = waiting;
    waiting = null;
    tick?.();
  };
  return { timer, advance, progress, done: () => done, waiting: () => waiting };
}

test("hold to clear: 3 seconds held finishes once, filling as it goes", () => {
  const { timer, advance, progress, done } = fakeHold();
  assert.equal(HOLD_MS, 3000);
  timer.start();
  assert.equal(timer.holding, true);
  advance(1500);
  assert.deepEqual(progress, [0, 0.5]);
  advance(1499);
  assert.equal(done(), 0, "not quite 3 seconds");
  advance(1);
  assert.equal(progress.at(-1), 1);
  assert.equal(done(), 1);
  assert.equal(timer.holding, false);
  advance(1000);
  assert.equal(done(), 1, "nothing more after it's done");
});

test("hold to clear: letting go early empties it and clears nothing", () => {
  const { timer, advance, progress, done, waiting } = fakeHold();
  timer.start();
  advance(2000);
  timer.cancel();
  assert.equal(progress.at(-1), 0);
  assert.equal(waiting(), null, "no frame left running");
  advance(5000);
  assert.equal(done(), 0);
  // Holding again starts from the beginning.
  timer.start();
  advance(2000);
  assert.equal(done(), 0);
  advance(1000);
  assert.equal(done(), 1);
});

test("hold to clear: a second start while held (a repeated key) doesn't restart the clock", () => {
  const { timer, advance, done } = fakeHold();
  timer.start();
  advance(2000);
  timer.start();
  advance(1000);
  assert.equal(done(), 1);
});

test("hold to clear: a frame that runs after letting go clears nothing", () => {
  let time = 0;
  const ticks = [];
  let done = 0;
  const timer = holdTimer({
    onProgress: () => {},
    onDone: () => done++,
    clock: () => time,
    frame: (tick) => ticks.push(tick),
    cancelFrame: () => {}, // a frame the browser couldn't take back
  });
  timer.start();
  timer.cancel();
  time = 10_000;
  ticks.forEach((tick) => tick());
  assert.equal(done, 0);
});

test("hold to clear: cancelling when not held does nothing", () => {
  const { timer, progress } = fakeHold();
  timer.cancel();
  assert.deepEqual(progress, []);
});

test("hold to clear: reduced motion fills in thirds, otherwise smoothly", () => {
  assert.equal(holdFill(0.5, false), 0.5);
  assert.deepEqual([0, 0.3, 0.34, 0.7, 0.99, 1].map((p) => holdFill(p, true)), [0, 0, 1 / 3, 2 / 3, 2 / 3, 1]);
});
