import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, applyCommand, createState, nextMidnight } from "../src/model.js";

function event() {
  return { listeners: [], addListener(listener) { this.listeners.push(listener); } };
}

async function setup(t, initial, initialNow = new Date(2026, 10, 1, 10).getTime()) {
  let now = initialNow;
  const data = initial ? { [STORAGE_KEY]: structuredClone(initial) } : {};
  const alarms = new Map();
  const notifications = [];
  const errors = [];
  const audioMessages = [];
  let contexts = [];
  let storageError;
  let audioError;
  const api = {
    runtime: {
      id: "test-extension",
      onMessage: event(), onInstalled: event(), onStartup: event(),
      getURL: (path) => `chrome-extension://test-extension/${path}`,
      getContexts: async () => contexts,
      sendMessage: async (message) => {
        audioMessages.push(message);
        return audioError ? { ok: false, error: audioError } : { ok: true };
      }
    },
    storage: {
      local: {
        get: async () => structuredClone(data),
        set: async (values) => {
          if (storageError) throw new Error(storageError);
          Object.assign(data, structuredClone(values));
        }
      }
    },
    alarms: {
      get: async (name) => alarms.get(name),
      create: async (name, info) => { alarms.set(name, { name, scheduledTime: info.when }); },
      clear: async (name) => alarms.delete(name),
      onAlarm: event()
    },
    notifications: {
      create: async (id, value) => { notifications.push({ id, ...value }); },
      onClicked: event()
    },
    offscreen: {
      createDocument: async () => { contexts = [{ contextType: "OFFSCREEN_DOCUMENT" }]; }
    },
    sidePanel: {
      setPanelBehavior: async (value) => { api.panelBehavior = value; }
    },
    action: {
      setBadgeText: async (value) => { api.badge = value.text; },
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    },
    tabs: { create: async () => {} }
  };
  const oldChrome = globalThis.chrome;
  globalThis.chrome = api;
  t.mock.method(Date, "now", () => now);
  t.mock.method(console, "error", (...args) => { errors.push(args); });
  t.after(() => { globalThis.chrome = oldChrome; });
  await import(`../src/background.js?test=${crypto.randomUUID()}`);
  const listener = api.runtime.onMessage.listeners[0];
  function send(command = { type: "state.get" }, sender = { id: api.runtime.id }) {
    return new Promise((resolve) => {
      listener({ target: "background", command }, sender, resolve);
    });
  }
  await send();
  return {
    api, data, alarms, notifications, audioMessages, errors, send,
    setNow: (value) => { now = value; },
    failStorage: (message) => { storageError = message; },
    failAudio: (message) => { audioError = message; }
  };
}

test("initializes local storage, action sidebar behavior and a local midnight alarm", async (t) => {
  const app = await setup(t);
  assert.equal(app.data[STORAGE_KEY].timer.durationMinutes, 20);
  assert.deepEqual(app.data[STORAGE_KEY].listOptions, { doneLast: false, hideDone: false });
  assert.deepEqual(app.api.panelBehavior, { openPanelOnActionClick: true });
  assert.equal(app.alarms.get("edge-todo-midnight").scheduledTime, nextMidnight(Date.now()));
  assert.equal(app.errors.length, 0);
});

test("serializes concurrent writes from multiple panels without losing Todos", async (t) => {
  const app = await setup(t);
  const results = await Promise.all(Array.from({ length: 15 }, (_, index) => app.send({ type: "task.add", title: `Todo ${index}` })));
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(app.data[STORAGE_KEY].days[app.data[STORAGE_KEY].currentDate].length, 15);
});

test("persists independently changed list options from concurrent panels", async (t) => {
  const app = await setup(t);
  const responses = await Promise.all([
    app.send({ type: "list.option", name: "doneLast", enabled: true }),
    app.send({ type: "list.option", name: "hideDone", enabled: true }),
    app.send({ type: "task.add", title: "Keep this Todo" })
  ]);
  assert.equal(responses.every((response) => response.ok), true);
  const saved = app.data[STORAGE_KEY];
  assert.deepEqual(saved.listOptions, { doneLast: true, hideDone: true });
  assert.equal(saved.days[saved.currentDate][0].title, "Keep this Todo");
});

test("reordering and concurrent additions persist without dropping or overwriting tasks", async (t) => {
  const app = await setup(t);
  await app.send({ type: "task.add", title: "First" });
  const second = await app.send({ type: "task.add", title: "Second" });
  const { currentDate } = second.state;
  const [firstTask, secondTask] = second.state.days[currentDate];
  const results = await Promise.all([
    app.send({ type: "task.move", id: secondTask.id, targetId: firstTask.id, placement: "before", date: currentDate }),
    app.send({ type: "task.add", title: "Third" })
  ]);
  assert.equal(results.every((result) => result.ok), true);
  assert.deepEqual(app.data[STORAGE_KEY].days[currentDate].map((task) => task.title), ["Second", "First", "Third"]);
});

test("failed reorder saves report an error and retain the previously persisted order", async (t) => {
  const app = await setup(t);
  await app.send({ type: "task.add", title: "First" });
  const result = await app.send({ type: "task.add", title: "Second" });
  const before = structuredClone(app.data);
  const [first, second] = result.state.days[result.state.currentDate];
  app.failStorage("Storage quota exceeded");
  const response = await app.send({ type: "task.move", id: second.id, targetId: first.id, placement: "before", date: result.state.currentDate });
  assert.equal(response.ok, false);
  assert.match(response.error, /quota/);
  assert.deepEqual(app.data, before);
  assert.equal(app.errors.length > 0, true);
});

test("startup persists legacy profile defaults without resetting existing data", async (t) => {
  const now = new Date(2026, 10, 1, 10).getTime();
  let legacy = applyCommand(createState(now), { type: "task.add", title: "Legacy Todo" }, now);
  legacy = applyCommand(legacy, { type: "timer.start" }, now);
  delete legacy.listOptions;
  const app = await setup(t, legacy, now);
  assert.deepEqual(app.data[STORAGE_KEY].listOptions, { doneLast: false, hideDone: false });
  assert.deepEqual(app.data[STORAGE_KEY].days, legacy.days);
  assert.deepEqual(app.data[STORAGE_KEY].timer, legacy.timer);
  assert.equal(app.errors.length, 0);
});

test("failed view-setting saves return an explicit error and preserve the previous preferences", async (t) => {
  const app = await setup(t);
  const before = structuredClone(app.data);
  app.failStorage("Storage quota exceeded");
  const response = await app.send({ type: "list.option", name: "hideDone", enabled: true });
  assert.equal(response.ok, false);
  assert.match(response.error, /quota/);
  assert.deepEqual(app.data, before);
  assert.equal(app.errors.length > 0, true);
});

test("recreates the persisted timer alarm when the service worker starts", async (t) => {
  const now = new Date(2026, 10, 1, 10).getTime();
  const state = applyCommand(createState(now), { type: "timer.start" }, now);
  const app = await setup(t, state, now + 60_000);
  assert.equal(app.alarms.get("edge-todo-focus").scheduledTime, state.timer.endAt);
  assert.equal(app.api.badge, "ON");
  const paused = await app.send({ type: "timer.pause" });
  assert.equal(paused.state.timer.remainingMs, 19 * 60_000);
  assert.equal(app.alarms.has("edge-todo-focus"), false);
});

test("expired persisted timers become red/badged, notify and play audio exactly once", async (t) => {
  const now = new Date(2026, 10, 1, 10).getTime();
  const state = applyCommand(createState(now), { type: "timer.start" }, now);
  const app = await setup(t, state, state.timer.endAt + 1000);
  const result = await app.send();
  assert.equal(result.state.timer.status, "finished");
  assert.equal(result.state.timer.remainingMs, 0);
  assert.equal(result.state.timer.alertError, null);
  assert.equal(result.state.timer.alertedAt, state.timer.endAt + 1000);
  assert.equal(app.api.badge, "!");
  assert.equal(app.notifications.length, 1);
  assert.equal(app.audioMessages.length, 1);
  await app.send();
  assert.equal(app.notifications.length, 1);
  assert.equal(app.audioMessages.length, 1);
});

test("alarm events finalize a countdown even without an open UI", async (t) => {
  const app = await setup(t);
  const result = await app.send({ type: "timer.start" });
  app.setNow(result.state.timer.endAt);
  app.api.alarms.onAlarm.listeners[0]({ name: "edge-todo-focus" });
  const finished = await app.send();
  assert.equal(finished.state.timer.status, "finished");
  assert.equal(app.notifications.length, 1);
  assert.equal(app.audioMessages.length, 1);
});

test("storage failures return explicit errors and leave persisted data intact", async (t) => {
  const app = await setup(t);
  const previous = structuredClone(app.data);
  app.failStorage("Storage quota exceeded");
  const result = await app.send({ type: "task.add", title: "저장 실패 테스트" });
  assert.equal(result.ok, false);
  assert.match(result.error, /quota/);
  assert.deepEqual(app.data, previous);
  assert.equal(app.errors.length > 0, true);
});

test("audio failures remain visible in persisted timer state while system notification still fires", async (t) => {
  const app = await setup(t);
  app.failAudio("Audio playback blocked");
  const result = await app.send({ type: "timer.start" });
  app.setNow(result.state.timer.endAt);
  const finished = await app.send();
  assert.equal(finished.state.timer.status, "finished");
  assert.match(finished.state.timer.alertError, /Audio playback blocked/);
  assert.equal(app.notifications.length, 1);
  assert.equal(app.errors.length > 0, true);
  const testResult = await app.send({ type: "alarm.test" });
  assert.equal(testResult.ok, false);
  assert.match(testResult.error, /Audio playback blocked/);
});

test("corrupt or unsupported stored data is not silently reset", async (t) => {
  const bad = { ...createState(), version: 99 };
  const app = await setup(t, bad);
  const result = await app.send();
  assert.equal(result.ok, false);
  assert.match(result.error, /version/);
  assert.deepEqual(app.data[STORAGE_KEY], bad);
});

test("rejects messages from another extension", async (t) => {
  const app = await setup(t);
  const result = await app.send({ type: "task.add", title: "외부 요청" }, { id: "another-extension" });
  assert.equal(result.ok, false);
  assert.equal(app.data[STORAGE_KEY].days[app.data[STORAGE_KEY].currentDate].length, 0);
});
