import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_MINUTES, MAX_MINUTES, applyCommand, createState, getVisibleTasks, localDateKey,
  makeBackup, nextMidnight, reconcileState, remainingTime, validateState
} from "../src/model.js";

const dayOne = new Date(2026, 10, 1, 10, 0, 0).getTime();
const dayTwo = new Date(2026, 10, 2, 0, 0, 0).getTime();
const templates = [{ id: "daily-read", title: "책 읽기" }, { id: "daily-exercise", title: "운동" }];
const command = (state, value, now = dayOne) => applyCommand(state, value, now);

test("all built-in application text, accessible labels and error messages are in English", () => {
  for (const path of ["../app.html", "../offscreen.html", "../manifest.json", "../src/app.js", "../src/model.js", "../src/background.js", "../src/offscreen.js"]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /[\uac00-\ud7a3]/u, path);
  }
  assert.match(readFileSync(new URL("../app.html", import.meta.url), "utf8"), /<html lang="en">/);
});

test("starts with an empty local day and a 20 minute countdown", () => {
  const state = createState(dayOne);
  assert.equal(state.currentDate, "2026-11-01");
  assert.deepEqual(state.days[state.currentDate], []);
  assert.equal(state.timer.durationMinutes, DEFAULT_MINUTES);
  assert.equal(remainingTime(state.timer), 20 * 60_000);
  assert.deepEqual(state.listOptions, { doneLast: false, hideDone: false });
  assert.equal(validateState(state), state);
});

test("Done last is stable, opt-in, and never reorders the stored tasks", () => {
  const tasks = Object.freeze([
    { id: "done-first", done: true },
    { id: "open-first", done: false },
    { id: "done-second", done: true },
    { id: "open-second", done: false }
  ]);
  const original = tasks.map((task) => task.id);
  assert.deepEqual(getVisibleTasks(tasks).map((task) => task.id), original);
  assert.deepEqual(getVisibleTasks(tasks, { doneLast: true, hideDone: false }).map((task) => task.id), [
    "open-first", "open-second", "done-first", "done-second"
  ]);
  assert.deepEqual(tasks.map((task) => task.id), original);
  assert.deepEqual(getVisibleTasks(tasks, { doneLast: false, hideDone: false }).map((task) => task.id), original);
  assert.notEqual(getVisibleTasks(tasks), tasks);
});

test("Hide done works alone or with sorting and keeps the original completed items intact", () => {
  const tasks = Object.freeze([{ id: "done", done: true }, { id: "open", done: false }]);
  for (const doneLast of [false, true]) {
    const options = { doneLast, hideDone: true };
    assert.deepEqual(getVisibleTasks(tasks, options), [tasks[1]]);
    assert.deepEqual(getVisibleTasks([], options), []);
    assert.deepEqual(getVisibleTasks([tasks[0]], options), []);
    assert.deepEqual(getVisibleTasks([tasks[1]], options), [tasks[1]]);
  }
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].done, true);
  assert.deepEqual(getVisibleTasks(tasks, { doneLast: false, hideDone: false }), tasks);
});

test("list options update independently without changing Todos or a running timer", () => {
  let state = command(createState(dayOne), { type: "templates.save", templates });
  state = command(state, { type: "timer.start" });
  const previous = structuredClone(state);
  let next = command(state, { type: "list.option", name: "doneLast", enabled: true });
  assert.deepEqual(next.listOptions, { doneLast: true, hideDone: false });
  next = command(next, { type: "list.option", name: "hideDone", enabled: true });
  assert.deepEqual(next.listOptions, { doneLast: true, hideDone: true });
  next = command(next, { type: "list.option", name: "doneLast", enabled: false });
  assert.deepEqual(next.listOptions, { doneLast: false, hideDone: true });
  assert.deepEqual(next.days, previous.days);
  assert.deepEqual(next.templates, previous.templates);
  assert.deepEqual(next.timer, previous.timer);
  assert.deepEqual(state, previous);
  for (const value of [
    { name: "unknown", enabled: true },
    { name: "__proto__", enabled: true },
    { name: "hideDone", enabled: "yes" },
    { name: "doneLast", enabled: null },
    { name: "doneLast" }
  ]) {
    assert.throws(() => command(state, { type: "list.option", ...value }));
  }
  assert.deepEqual(state, previous);
});

test("legacy profiles gain disabled list options without resetting Todo or timer data", () => {
  let legacy = command(createState(dayOne), { type: "templates.save", templates });
  legacy = command(legacy, { type: "task.toggle", id: legacy.days[legacy.currentDate][0].id, done: true });
  legacy = command(legacy, { type: "timer.start" });
  delete legacy.listOptions;
  const previous = structuredClone(legacy);
  assert.equal(validateState(legacy), legacy);
  const migrated = reconcileState(legacy, dayOne + 1000);
  assert.deepEqual(migrated.listOptions, { doneLast: false, hideDone: false });
  assert.deepEqual(migrated.days, previous.days);
  assert.deepEqual(migrated.timer, previous.timer);
  assert.deepEqual(legacy, previous);
  assert.equal(reconcileState(migrated, dayOne + 1000), migrated);
});

test("view settings persist across day rollover while daily completion still resets", () => {
  let state = command(createState(dayOne), { type: "templates.save", templates });
  state = command(state, { type: "task.toggle", id: state.days[state.currentDate][0].id, done: true });
  state = command(state, { type: "list.option", name: "doneLast", enabled: true });
  state = command(state, { type: "list.option", name: "hideDone", enabled: true });
  const next = reconcileState(state, dayTwo);
  assert.deepEqual(next.listOptions, { doneLast: true, hideDone: true });
  assert.equal(next.days["2026-11-01"][0].done, true);
  assert.equal(next.days[next.currentDate].some((task) => task.done), false);
  assert.equal(getVisibleTasks(next.days[next.currentDate], next.listOptions).length, 2);
});

test("backups retain view settings and legacy backups restore with both options off", () => {
  let state = command(createState(dayOne), { type: "templates.save", templates });
  state = command(state, { type: "list.option", name: "doneLast", enabled: true });
  state = command(state, { type: "list.option", name: "hideDone", enabled: true });
  const backup = makeBackup(state, dayOne);
  assert.deepEqual(command(createState(dayOne), { type: "backup.import", backup }), state);
  const legacyBackup = structuredClone(backup);
  delete legacyBackup.state.listOptions;
  const restored = command(state, { type: "backup.import", backup: legacyBackup });
  assert.deepEqual(restored.listOptions, { doneLast: false, hideDone: false });
  assert.deepEqual(restored.days, state.days);
  assert.deepEqual(restored.timer, state.timer);
});

test("malformed saved view settings are reported instead of being silently reset", () => {
  const original = createState(dayOne);
  for (const listOptions of [null, true, [], {}, { doneLast: "yes", hideDone: false }, { doneLast: false, hideDone: null }]) {
    const corrupt = { ...original, listOptions };
    assert.throws(() => validateState(corrupt), /Invalid Todo list options/);
    assert.throws(() => command(original, {
      type: "backup.import",
      backup: { format: "edge-todo-light", state: corrupt }
    }), /Invalid Todo list options/);
  }
  assert.deepEqual(original, createState(dayOne));
});

test("uses local calendar dates and schedules the next local midnight", () => {
  const late = new Date(2026, 10, 1, 23, 59, 59).getTime();
  const early = new Date(2026, 10, 2, 0, 0, 1).getTime();
  assert.equal(localDateKey(late), "2026-11-01");
  assert.equal(localDateKey(early), "2026-11-02");
  assert.equal(nextMidnight(late), dayTwo);
  const monthEnd = new Date(2026, 11, 31, 23).getTime();
  assert.equal(localDateKey(nextMidnight(monthEnd)), "2027-01-01");
  assert.equal(new Date(nextMidnight(monthEnd)).getHours(), 0);
});

test("adds, checks, unchecks, renames and deletes an ad-hoc Todo without mutating previous state", () => {
  const initial = createState(dayOne);
  let state = applyCommand(initial, { type: "task.add", title: "  새 할 일  " }, dayOne, () => "custom");
  assert.equal(initial.days[initial.currentDate].length, 0);
  assert.equal(state.days[state.currentDate][0].title, "새 할 일");
  state = command(state, { type: "task.toggle", id: "custom", done: true });
  assert.equal(state.days[state.currentDate][0].completedAt, dayOne);
  state = command(state, { type: "task.toggle", id: "custom", done: false });
  assert.equal(state.days[state.currentDate][0].completedAt, null);
  state = command(state, { type: "task.rename", id: "custom", title: "수정한 할 일" });
  assert.equal(state.days[state.currentDate][0].title, "수정한 할 일");
  state = command(state, { type: "task.delete", id: "custom" });
  assert.equal(state.days[state.currentDate].length, 0);
});

test("template edits preserve today's completion and update recurring task titles", () => {
  let state = command(createState(dayOne), { type: "templates.save", templates });
  const id = state.days[state.currentDate][0].id;
  state = command(state, { type: "task.toggle", id, done: true });
  state = command(state, { type: "templates.save", templates: [{ id: "daily-read", title: "책 20분 읽기" }, { id: "daily-new", title: "일기" }] });
  assert.equal(state.days[state.currentDate][0].id, id);
  assert.equal(state.days[state.currentDate][0].done, true);
  assert.equal(state.days[state.currentDate][0].title, "책 20분 읽기");
  assert.equal(state.days[state.currentDate][1].done, false);
  assert.equal(state.days[state.currentDate].some((task) => task.templateId === "daily-exercise"), false);
  state = command(state, { type: "task.rename", id, title: "매일 독서" });
  assert.equal(state.templates[0].title, "매일 독서");
  assert.equal(state.days[state.currentDate][0].done, true);
});

test("rollover resets recurring checks, carries only unfinished ad-hoc tasks, and preserves history", () => {
  let state = command(createState(dayOne), { type: "templates.save", templates });
  state = command(state, { type: "task.toggle", id: state.days[state.currentDate][0].id, done: true });
  state = applyCommand(state, { type: "task.add", title: "미완료" }, dayOne, () => "unfinished");
  state = applyCommand(state, { type: "task.add", title: "완료" }, dayOne, () => "finished");
  state = command(state, { type: "task.toggle", id: "finished", done: true });
  const previousDay = structuredClone(state.days[state.currentDate]);
  const next = reconcileState(state, dayTwo);
  assert.equal(next.currentDate, "2026-11-02");
  assert.equal(next.days[next.currentDate].length, 3);
  assert.equal(next.days[next.currentDate].some((task) => task.done), false);
  assert.equal(next.days[next.currentDate][2].id, "unfinished");
  assert.equal(next.days[next.currentDate][2].carriedFrom, "2026-11-01");
  assert.deepEqual(next.days["2026-11-01"], previousDay);
  assert.equal(reconcileState(next, dayTwo), next);
  const later = reconcileState(next, dayTwo + 4 * 86_400_000);
  assert.equal(later.days[later.currentDate].filter((task) => task.id === "unfinished").length, 1);
});

test("deleting a recurring task only removes today's occurrence", () => {
  let state = command(createState(dayOne), { type: "templates.save", templates });
  state = command(state, { type: "task.delete", id: state.days[state.currentDate][0].id });
  assert.equal(state.templates.length, 2);
  assert.equal(state.days[state.currentDate].length, 1);
  const next = reconcileState(state, dayTwo);
  assert.equal(next.days[next.currentDate].length, 2);
});

test("rejects empty and overlong titles, duplicate template IDs, missing tasks and unknown commands", () => {
  const state = createState(dayOne);
  for (const title of ["", "   ", "x".repeat(201), null]) {
    assert.throws(() => command(state, { type: "task.add", title }));
  }
  assert.throws(() => command(state, { type: "templates.save", templates: [templates[0], templates[0]] }));
  assert.throws(() => command(state, { type: "templates.save", templates: [{ id: "x".repeat(101), title: "test" }] }));
  assert.throws(() => command(state, { type: "task.toggle", id: "missing", done: true }));
  assert.throws(() => command(state, { type: "task.toggle", id: "missing", done: "yes" }));
  assert.throws(() => command(state, { type: "unsupported" }));
  assert.deepEqual(state, createState(dayOne));
});

test("enforces whole-minute duration limits and persists the selected task", () => {
  let state = applyCommand(createState(dayOne), { type: "task.add", title: "집중할 작업" }, dayOne, () => "focus");
  state = command(state, { type: "timer.select", id: "focus" });
  state = command(state, { type: "timer.duration", minutes: 25 });
  assert.equal(state.timer.taskId, "focus");
  assert.equal(remainingTime(state.timer), 25 * 60_000);
  for (const minutes of [0, -1, 1.5, MAX_MINUTES + 1, NaN, "20"]) {
    assert.throws(() => command(state, { type: "timer.duration", minutes }));
  }
});

test("countdown survives reopening because it stores an absolute deadline", () => {
  const state = command(createState(dayOne), { type: "timer.start" });
  assert.equal(state.timer.endAt, dayOne + 20 * 60_000);
  const restored = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(remainingTime(restored.timer, dayOne + 3 * 60_000), 17 * 60_000);
  assert.equal(reconcileState(restored, dayOne + 3 * 60_000).timer.status, "running");
  assert.throws(() => command(restored, { type: "timer.start" }));
  assert.throws(() => command(restored, { type: "timer.duration", minutes: 10 }));
});

test("starting atomically applies the entered duration and rejects invalid input instead of using an old duration", () => {
  const initial = createState(dayOne);
  const started = command(initial, { type: "timer.start", minutes: 1 });
  assert.equal(started.timer.durationMinutes, 1);
  assert.equal(started.timer.endAt, dayOne + 60_000);
  assert.equal(started.timer.remainingMs, 60_000);
  for (const minutes of [0, 1.5, MAX_MINUTES + 1, NaN]) {
    assert.throws(() => command(initial, { type: "timer.start", minutes }));
  }
  assert.equal(initial.timer.status, "idle");
  let paused = command(started, { type: "timer.pause" }, dayOne + 1000);
  assert.throws(() => command(paused, { type: "timer.start", minutes: 2 }));
  paused = command(paused, { type: "timer.start", minutes: 1 }, dayOne + 3000);
  assert.equal(paused.timer.endAt, dayOne + 3000 + 59_000);
});

test("pause freezes the remaining time; resume uses only the remainder; reset restores duration", () => {
  let state = command(createState(dayOne), { type: "timer.start" });
  state = command(state, { type: "timer.pause" }, dayOne + 90_000);
  assert.equal(state.timer.status, "paused");
  assert.equal(remainingTime(state.timer, dayOne + 500_000), 1_110_000);
  state = command(state, { type: "timer.start" }, dayOne + 500_000);
  assert.equal(state.timer.endAt, dayOne + 500_000 + 1_110_000);
  assert.equal(state.timer.startedAt, dayOne);
  state = command(state, { type: "timer.reset" }, dayOne + 600_000);
  assert.equal(state.timer.status, "idle");
  assert.equal(state.timer.endAt, null);
  assert.equal(state.timer.remainingMs, 1_200_000);
});

test("finishes at exactly zero and not before, without making remaining time negative", () => {
  const state = command(createState(dayOne), { type: "timer.start" });
  const deadline = state.timer.endAt;
  assert.equal(reconcileState(state, deadline - 1).timer.status, "running");
  const finished = reconcileState(state, deadline);
  assert.equal(finished.timer.status, "finished");
  assert.equal(finished.timer.remainingMs, 0);
  assert.equal(finished.timer.finishedAt, deadline);
  assert.equal(finished.timer.alertedAt, null);
  assert.equal(remainingTime(state.timer, deadline + 60_000), 0);
  assert.equal(reconcileState(finished, deadline + 60_000), finished);
});

test("a countdown spanning midnight keeps its selected task and deadline", () => {
  const late = new Date(2026, 10, 1, 23, 55).getTime();
  let state = command(createState(late), { type: "templates.save", templates }, late);
  state = command(state, { type: "timer.select", id: state.days[state.currentDate][0].id }, late);
  state = command(state, { type: "timer.start" }, late);
  const next = reconcileState(state, dayTwo);
  assert.equal(next.currentDate, "2026-11-02");
  assert.equal(next.timer.taskTitle, "책 읽기");
  assert.equal(next.timer.status, "running");
  assert.equal(next.timer.endAt, late + 20 * 60_000);
  assert.equal(next.days[next.currentDate][0].done, false);
});

test("completed selected tasks cannot start a new focus session, and reset clears stale selection", () => {
  let state = applyCommand(createState(dayOne), { type: "task.add", title: "완료할 일" }, dayOne, () => "done");
  state = command(state, { type: "timer.select", id: "done" });
  state = command(state, { type: "task.toggle", id: "done", done: true });
  assert.throws(() => command(state, { type: "timer.start" }));
  assert.throws(() => command(state, { type: "timer.select", id: "done" }));
  state = command(state, { type: "timer.reset" });
  assert.equal(state.timer.taskId, null);
});

test("backups round-trip all data, reconcile old dates, and reject corrupt data without replacing it", () => {
  const state = command(createState(dayOne), { type: "templates.save", templates });
  const backup = makeBackup(state, dayOne);
  const restored = command(createState(dayOne), { type: "backup.import", backup });
  assert.deepEqual(restored, state);
  const next = command(createState(dayTwo), { type: "backup.import", backup }, dayTwo);
  assert.equal(next.currentDate, "2026-11-02");
  assert.equal(next.days[next.currentDate].length, 2);
  for (const corrupt of [
    { format: "other", state },
    { format: "edge-todo-light", state: { ...state, version: 99 } },
    { format: "edge-todo-light", state: { ...state, days: {} } },
    { format: "edge-todo-light", state: { ...state, timer: { ...state.timer, remainingMs: -1 } } },
    { format: "edge-todo-light", state: { ...state, days: { "2026-02-31": [] } } }
  ]) {
    assert.throws(() => command(state, { type: "backup.import", backup: corrupt }));
  }
  assert.deepEqual(state, backup.state);
});
