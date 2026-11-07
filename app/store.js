// The one store: everything the app keeps, and the only code that touches the browser's storage. Screens read it
// through derive.js and change it only with update(); every change is checked, saved and announced to
// subscribers, so no screen keeps its own copy or redraws another by hand.
//
// State = { version, settings, entries, events, view, draft, session }. All but `session` is saved, under one key;
// `session` (today, the rung data, the Ladder's experience tab) lives only while the page is open. `draft` holds a
// first visit's answers until its first record is saved, so a half-finished visit picks up where it stopped.
import * as L from "./ladder.js";

export const DATA_KEY = "dots-ladder:data";
export const VERSION = 2;
// Version 1 kept four keys. They're read once to migrate and left in place (an older cached copy of the app
// still finds its data, and going back a version loses nothing); "clear my numbers" removes them too.
export const V1_KEYS = {
  profile: "dots-ladder:profile",
  tests: "dots-ladder:tests",
  events: "dots-ladder:events",
  view: "dots-ladder:progress-view",
};
const SAVED = ["settings", "entries", "events", "view", "draft"];

/** Nothing saved yet: default settings and view, no entries, events or first-visit draft. */
export function emptyData() {
  return { settings: L.settingsOf(null), entries: [], events: [], view: L.cleanView(null), draft: null };
}

const readJson = (storage, key) => {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
};

/** Version 2's saved data, cleaned; null if there's none. */
function readV2(raw) {
  if (raw == null || typeof raw !== "object" || raw.version !== VERSION) return null;
  return {
    settings: L.settingsOf(raw.settings),
    entries: L.cleanTests(raw.entries) ?? [],
    events: L.cleanEvents(raw.events) ?? [],
    view: L.cleanView(raw.view),
    draft: L.cleanDraft(raw.draft),
  };
}

/**
 * Version 1's four keys as version 2 data. A profile from before the history existed still holds numbers: with
 * no records saved they become the first record, dated `today` (their real date was never recorded).
 */
export function migrateV1(storage, today) {
  const profile = readJson(storage, V1_KEYS.profile);
  const legacy = L.legacyProfile(profile);
  const entries = L.cleanTests(readJson(storage, V1_KEYS.tests), legacy?.sex) ?? (legacy ? [L.testFrom(legacy, today, "first")] : []);
  return {
    settings: L.settingsOf(profile),
    entries,
    events: L.cleanEvents(readJson(storage, V1_KEYS.events)) ?? [],
    view: L.cleanView(readJson(storage, V1_KEYS.view)),
    draft: null,
  };
}

/** What's saved: { data, from: "v2" | "v1" | "none" }. Corrupt, missing or blocked storage gives empty data, never an error. */
export function readSaved(storage, today) {
  if (!storage) return { data: emptyData(), from: "none" };
  const v2 = readV2(readJson(storage, DATA_KEY));
  if (v2) return { data: v2, from: "v2" };
  const v1 = migrateV1(storage, today);
  const any = Object.values(V1_KEYS).some((key) => {
    try {
      return storage.getItem(key) != null;
    } catch {
      return false;
    }
  });
  return any ? { data: v1, from: "v1" } : { data: emptyData(), from: "none" };
}

/** Whether data can be saved: valid entries (the earliest holding all four values) and valid events. */
export function canSave(data) {
  return L.canSaveTests(data.entries) && L.canSaveEvents(data.events);
}

/** Saves the data under one key; returns whether it was saved (invalid data, or storage full, blocked or missing). */
export function writeSaved(storage, data) {
  if (!storage || !canSave(data)) return false;
  try {
    storage.setItem(DATA_KEY, JSON.stringify({ version: VERSION, ...Object.fromEntries(SAVED.map((key) => [key, data[key]])) }));
    return true;
  } catch {
    return false;
  }
}

// --- Backups: everything saved, as one file you keep ------------------------------------
// { app: "dots-ladder", version, exported: "YYYY-MM-DD", settings, entries, events, view } (a half-finished first
// visit's draft isn't part of it). A backup is only ever
// restored whole, and only when every record and event in it is still valid: an edited or damaged file is refused
// rather than half restored. Version 2 is the first with backups, so it's the only one read for now; a later
// version reads older backups by migrating them, like readSaved.

export const BACKUP_APP = "dots-ladder";
const BACKUP_MAX_BYTES = 5_000_000;

/** The backup file for the saved data: { name, text }. Your last backup's date isn't part of it. */
export function backupFile(data, today) {
  const { lastBackup, ...settings } = data.settings;
  const backup = { app: BACKUP_APP, version: VERSION, exported: today, settings, entries: data.entries, events: data.events, view: data.view };
  return { name: `dots-ladder-backup-${today}.json`, text: `${JSON.stringify(backup, null, 2)}\n` };
}

/**
 * A backup file's text as data to restore: { data, summary: { exported, records, events, latest } }, or
 * { problem } with a sentence saying why it can't be. Restored data counts as backed up on the file's date.
 */
export function readBackup(text, today) {
  if (typeof text !== "string" || text.length > BACKUP_MAX_BYTES) return { problem: "This file is too big to be a DOTS Ladder backup." };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  if (raw?.app !== BACKUP_APP || !Number.isInteger(raw.version)) return { problem: "This file isn't a DOTS Ladder backup." };
  if (raw.version > VERSION) return { problem: "This backup is from a newer version of DOTS Ladder. Reload the app to update it, then try again." };
  if (raw.version !== VERSION) return { problem: "This backup is from a version of DOTS Ladder that can't be restored." };
  const entries = L.cleanTests(raw.entries);
  const events = L.cleanEvents(raw.events);
  const damaged = "This backup has been changed or damaged, so it can't be restored. Your numbers haven't changed.";
  if (!entries || !events || entries.length !== raw.entries.length || events.length !== raw.events.length) return { problem: damaged };
  if (!entries.length) return { problem: "This backup has no records to restore." };
  const exported = L.isDay(raw.exported) && raw.exported <= today ? raw.exported : today;
  const data = { settings: L.settingsOf({ ...raw.settings, lastBackup: exported }), entries, events, view: L.cleanView(raw.view), draft: null };
  if (!canSave(data)) return { problem: damaged };
  return { data, summary: { exported, records: entries.length, events: events.length, latest: entries.at(-1).date } };
}

// --- The live store: one per page --------------------------------------------------------

let state = null;
let storage = null;
const listeners = new Set();

/** The browser's storage, or null where it's blocked (then nothing is saved, and the page still works). */
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Loads what's saved (migrating version 1 once, so its first record keeps its date) and starts the store.
 * `deviceStorage` is the browser's unless given (tests pass a stand-in).
 */
export function start(session, deviceStorage = browserStorage()) {
  storage = deviceStorage;
  const { data, from } = readSaved(storage, session.today);
  if (from === "v1") writeSaved(storage, data);
  state = { version: VERSION, ...data, session };
  return state;
}

/** The current state. Treat it as read-only: change it with update(). */
export function getState() {
  return state;
}

/**
 * Changes the state: `change(state)` returns the parts to replace (e.g. `{ entries }`, or `{ session }`).
 * Entries are kept in date order; settings and the view are cleaned; entries and events must be valid, else
 * nothing changes. Saved parts are
 * saved, then every subscriber hears about it. Returns { ok, saved }: saved is false when storage refused.
 */
export function update(change) {
  const parts = change(state);
  const next = { ...state, ...parts };
  if (parts.entries) next.entries = L.sortTests(parts.entries); // saved oldest first, same-day in save order
  if (parts.settings) next.settings = L.settingsOf(parts.settings);
  if (parts.view) next.view = L.cleanView(parts.view);
  if ("draft" in parts) next.draft = L.cleanDraft(parts.draft);
  if (!canSave(next)) return { ok: false, saved: false };
  const saved = SAVED.some((key) => key in parts) ? writeSaved(storage, next) : true;
  state = next;
  for (const listener of listeners) listener(state);
  return { ok: true, saved };
}

/** Calls `listener(state)` after every change; returns a function that stops it. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * "Clear my numbers": forgets your records and settings (events and the chart view stay, as before). Version 1's
 * numbers are removed too, so they can never be migrated back.
 */
export function clearNumbers() {
  for (const key of [V1_KEYS.profile, V1_KEYS.tests]) {
    try {
      storage?.removeItem(key);
    } catch {
      // Nothing to clear.
    }
  }
  state = { ...state, settings: L.settingsOf(null), entries: [], draft: null };
  writeSaved(storage, state);
  for (const listener of listeners) listener(state);
}
