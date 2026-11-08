// Anonymous usage counts, with GoatCounter: what happened ("reached the bench screen", "logged a test"), never
// what was typed. Each event is a name from the fixed list below (no numbers, dates, sex, class or IDs), sent
// as one small request straight to GoatCounter's count endpoint, so no third-party script is loaded.
// GoatCounter sets no cookies and keeps no IP address. Nothing is sent off the live site, when the lifter has
// switched counting off (Your data), or when the browser asks not to be tracked. Offline, an event is dropped.
import * as L from "./ladder.js";
import * as store from "./store.js";

export const COUNT_URL = "https://dotsladder.goatcounter.com/count";
export const LIVE_HOST = "dotsladder.app";

/** Every event that can be sent. Anything else is refused, so a number can never end up in one. */
export const EVENTS = new Set([
  ...L.FIRST_VISIT_SCREENS.map((screen) => `first-visit/${screen}`),
  "first-visit/done-steps",
  "first-visit/done-quick",
  "first-visit/used-sets",
  ...L.ROUTES.map((route) => `tab/${route}`),
  "log/saved",
  "data/backed-up",
  "data/restored",
  "error/data-load",
  "error/save-refused",
]);

/**
 * Whether to send at all: only on the live site, not when the lifter switched counting off (settings.analytics
 * false; on by default), and not when the browser sends Global Privacy Control or Do Not Track.
 */
export function shouldSend({ host, analytics, gpc, dnt }) {
  return host === LIVE_HOST && analytics !== false && !gpc && dnt !== "1";
}

/** The count request for an event (null for a name not on the list); `rnd` stops it being cached. */
export function countUrl(name, rnd) {
  if (!EVENTS.has(name)) return null;
  const query = new URLSearchParams({ p: name, t: name, e: "true", rnd });
  return `${COUNT_URL}?${query}`;
}

/** Counts one event, when allowed; never throws, and never waits. */
export function track(name) {
  try {
    const allowed = shouldSend({
      host: location.hostname,
      analytics: store.getState()?.settings.analytics,
      gpc: navigator.globalPrivacyControl === true,
      dnt: navigator.doNotTrack,
    });
    const url = allowed && countUrl(name, Math.random().toString(36).slice(2));
    if (url && navigator.onLine !== false) navigator.sendBeacon?.(url);
  } catch {
    // Counting is never worth an error.
  }
}
