export const STORAGE_KEY = "edgeTodoLight";
export const STATE_VERSION = 1;
export const DEFAULT_MINUTES = 20;
export const MAX_MINUTES = 180;
export const MAX_TITLE_LENGTH = 200;
export const DEFAULT_LIST_OPTIONS = Object.freeze({ doneLast: false, hideDone: false });

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value) {
  return Number.isFinite(value) && value >= 0;
}

function isId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

export function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextMidnight(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1000 && localDateKey(new Date(year, month - 1, day).getTime()) === value;
}

export function cleanTitle(value) {
  requireValue(typeof value === "string", "Todo titles must be text.");
  const title = value.trim();
  requireValue(title.length > 0, "Enter a Todo title.");
  requireValue(title.length <= MAX_TITLE_LENGTH, `Todo titles must be ${MAX_TITLE_LENGTH} characters or fewer.`);
  return title;
}

function validateMinutes(value) {
  requireValue(Number.isInteger(value) && value >= 1 && value <= MAX_MINUTES, `Focus duration must be a whole number from 1 to ${MAX_MINUTES} minutes.`);
}

function createTimer(durationMinutes = DEFAULT_MINUTES) {
  return {
    status: "idle",
    durationMinutes,
    remainingMs: durationMinutes * 60_000,
    endAt: null,
    taskId: null,
    taskTitle: null,
    startedAt: null,
    finishedAt: null,
    alertedAt: null,
    alertError: null
  };
}

export function createState(now = Date.now()) {
  const currentDate = localDateKey(now);
  return {
    version: STATE_VERSION,
    currentDate,
    templates: [],
    days: { [currentDate]: [] },
    listOptions: { ...DEFAULT_LIST_OPTIONS },
    timer: createTimer()
  };
}

function validateTemplates(templates) {
  requireValue(Array.isArray(templates), "Invalid daily Todo list format.");
  const ids = new Set();
  for (const template of templates) {
    requireValue(isObject(template) && isId(template.id) && template.id.length <= 100 && !ids.has(template.id), "Daily Todo IDs must be valid and unique.");
    requireValue(cleanTitle(template.title) === template.title, "Invalid daily Todo title format.");
    ids.add(template.id);
  }
}

export function validateState(state) {
  requireValue(isObject(state) && state.version === STATE_VERSION, "Unsupported saved data version. Your existing data has not been changed.");
  requireValue(isDateKey(state.currentDate) && isObject(state.days) && Array.isArray(state.days[state.currentDate]), "Invalid date-based Todo data format.");
  if (state.listOptions !== undefined) {
    requireValue(isObject(state.listOptions) && typeof state.listOptions.doneLast === "boolean" && typeof state.listOptions.hideDone === "boolean", "Invalid Todo list options.");
  }
  validateTemplates(state.templates);
  for (const [date, tasks] of Object.entries(state.days)) {
    requireValue(isDateKey(date) && Array.isArray(tasks), "Invalid date in Todo history.");
    const ids = new Set();
    for (const task of tasks) {
      requireValue(isObject(task) && isId(task.id) && !ids.has(task.id), "Todo IDs must be valid and unique.");
      requireValue(cleanTitle(task.title) === task.title && typeof task.done === "boolean", "Invalid Todo title or completion status.");
      requireValue(task.templateId === null || isId(task.templateId), "Invalid daily Todo reference.");
      requireValue(isTimestamp(task.createdAt) && (task.completedAt === null || isTimestamp(task.completedAt)), "Invalid Todo timestamp.");
      requireValue(task.done ? task.completedAt !== null : task.completedAt === null, "Invalid Todo completion timestamp.");
      requireValue(task.carriedFrom === null || isDateKey(task.carriedFrom), "Invalid Todo carry-over date.");
      ids.add(task.id);
    }
  }
  const timer = state.timer;
  requireValue(isObject(timer) && ["idle", "running", "paused", "finished"].includes(timer.status), "Invalid timer status.");
  validateMinutes(timer.durationMinutes);
  requireValue(Number.isFinite(timer.remainingMs) && timer.remainingMs >= 0 && timer.remainingMs <= timer.durationMinutes * 60_000, "Invalid remaining timer duration.");
  requireValue(timer.status === "running" ? isTimestamp(timer.endAt) : timer.endAt === null, "Invalid timer deadline.");
  requireValue(timer.status !== "finished" || timer.remainingMs === 0, "A finished timer must have no remaining time.");
  requireValue(timer.status !== "paused" || timer.remainingMs > 0, "A paused timer must have remaining time.");
  requireValue(timer.taskId === null || isId(timer.taskId), "Invalid timer Todo reference.");
  requireValue(timer.taskTitle === null || cleanTitle(timer.taskTitle) === timer.taskTitle, "Invalid timer Todo title.");
  for (const key of ["startedAt", "finishedAt", "alertedAt"]) {
    requireValue(timer[key] === null || isTimestamp(timer[key]), "Invalid timer timestamp.");
  }
  requireValue(timer.status === "idle" || timer.startedAt !== null, "The timer start timestamp is missing.");
  requireValue(timer.status !== "finished" || timer.finishedAt !== null, "The timer completion timestamp is missing.");
  requireValue(timer.alertError === null || typeof timer.alertError === "string", "Invalid timer alert information.");
  return state;
}

function recurringTask(template, date, now, previous) {
  return {
    id: previous?.id ?? `daily:${date}:${template.id}`,
    title: template.title,
    done: previous?.done ?? false,
    templateId: template.id,
    createdAt: previous?.createdAt ?? now,
    completedAt: previous?.completedAt ?? null,
    carriedFrom: null
  };
}

function syncTemplates(state, templates, now) {
  const today = state.days[state.currentDate];
  const previous = new Map(today.filter((task) => task.templateId !== null).map((task) => [task.templateId, task]));
  state.templates = templates;
  state.days[state.currentDate] = [
    ...templates.map((template) => recurringTask(template, state.currentDate, now, previous.get(template.id))),
    ...today.filter((task) => task.templateId === null)
  ];
}

export function remainingTime(timer, now = Date.now()) {
  return timer.status === "running" ? Math.max(0, timer.endAt - now) : timer.remainingMs;
}

export function getVisibleTasks(tasks, options = DEFAULT_LIST_OPTIONS) {
  const visible = options.hideDone ? tasks.filter((task) => !task.done) : [...tasks];
  if (options.doneLast) visible.sort((left, right) => Number(left.done) - Number(right.done));
  return visible;
}

export function reconcileState(state, now = Date.now()) {
  let next = state;
  const date = localDateKey(now);
  if (date !== state.currentDate) {
    next = structuredClone(state);
    if (!next.days[date]) {
      const carried = state.days[state.currentDate]
        .filter((task) => task.templateId === null && !task.done)
        .map((task) => ({ ...task, carriedFrom: task.carriedFrom ?? state.currentDate }));
      next.days[date] = [
        ...state.templates.map((template) => recurringTask(template, date, now)),
        ...carried
      ];
    }
    next.currentDate = date;
    if (next.timer.status === "idle" && !next.days[date].some((task) => task.id === next.timer.taskId)) {
      next.timer.taskId = null;
      next.timer.taskTitle = null;
    }
  }
  if (next.timer.status === "running" && remainingTime(next.timer, now) === 0) {
    if (next === state) next = structuredClone(state);
    next.timer.finishedAt = next.timer.endAt;
    next.timer.endAt = null;
    next.timer.remainingMs = 0;
    next.timer.status = "finished";
  }
  // Existing version-1 profiles and backups did not contain view preferences.
  if (next.listOptions === undefined) {
    if (next === state) next = structuredClone(state);
    next.listOptions = { ...DEFAULT_LIST_OPTIONS };
  }
  return next;
}

function findTask(state, id) {
  const task = state.days[state.currentDate].find((item) => item.id === id);
  requireValue(task !== undefined, "This Todo was not found. Check today's list and try again.");
  return task;
}

function requireStopped(timer) {
  requireValue(timer.status === "idle" || timer.status === "finished", "Reset the active timer before changing it.");
}

export function applyCommand(state, command, now = Date.now(), createId = () => crypto.randomUUID()) {
  requireValue(isObject(command) && typeof command.type === "string", "Invalid request format.");
  const next = structuredClone(reconcileState(state, now));
  const timer = next.timer;
  switch (command.type) {
    case "list.option":
      requireValue(command.name === "doneLast" || command.name === "hideDone", "Unknown Todo list option.");
      requireValue(typeof command.enabled === "boolean", "Todo list options must be true or false.");
      next.listOptions[command.name] = command.enabled;
      break;
    case "task.add":
      next.days[next.currentDate].push({
        id: createId(),
        title: cleanTitle(command.title),
        done: false,
        templateId: null,
        createdAt: now,
        completedAt: null,
        carriedFrom: null
      });
      break;
    case "task.toggle": {
      requireValue(typeof command.done === "boolean", "The completion value must be true or false.");
      const task = findTask(next, command.id);
      task.done = command.done;
      task.completedAt = task.done ? now : null;
      break;
    }
    case "task.rename": {
      const task = findTask(next, command.id);
      const title = cleanTitle(command.title);
      if (task.templateId === null) task.title = title;
      else syncTemplates(next, next.templates.map((template) => template.id === task.templateId ? { ...template, title } : template), now);
      if (timer.taskId === task.id) timer.taskTitle = title;
      break;
    }
    case "task.delete": {
      findTask(next, command.id);
      next.days[next.currentDate] = next.days[next.currentDate].filter((task) => task.id !== command.id);
      if (timer.taskId === command.id && timer.status === "idle") {
        timer.taskId = null;
        timer.taskTitle = null;
      }
      break;
    }
    case "templates.save": {
      requireValue(Array.isArray(command.templates), "Provide a valid daily Todo list.");
      const templates = command.templates.map((template) => {
        requireValue(isObject(template), "Invalid daily Todo format.");
        return { id: template.id, title: cleanTitle(template.title) };
      });
      validateTemplates(templates);
      syncTemplates(next, templates, now);
      const target = next.days[next.currentDate].find((task) => task.id === timer.taskId);
      if (target) timer.taskTitle = target.title;
      else if (timer.status === "idle") {
        timer.taskId = null;
        timer.taskTitle = null;
      }
      break;
    }
    case "timer.duration":
      requireStopped(timer);
      validateMinutes(command.minutes);
      next.timer = { ...createTimer(command.minutes), taskId: timer.taskId, taskTitle: timer.taskTitle };
      break;
    case "timer.select":
      requireStopped(timer);
      if (command.id === null) {
        timer.taskId = null;
        timer.taskTitle = null;
      } else {
        const task = findTask(next, command.id);
        requireValue(!task.done, "This Todo is already complete. Choose another Todo.");
        timer.taskId = task.id;
        timer.taskTitle = task.title;
      }
      break;
    case "timer.start": {
      requireValue(timer.status !== "running", "The timer is already running.");
      if (command.minutes !== undefined) {
        validateMinutes(command.minutes);
        requireValue(timer.status !== "paused" || command.minutes === timer.durationMinutes, "The focus duration cannot change while paused.");
        timer.durationMinutes = command.minutes;
      }
      const duration = timer.status === "paused" ? timer.remainingMs : timer.durationMinutes * 60_000;
      const selected = next.days[next.currentDate].find((task) => task.id === timer.taskId);
      if (timer.status !== "paused") {
        requireValue(timer.taskId === null || (selected && !selected.done), "Choose an unfinished Todo for this focus session.");
        timer.startedAt = now;
        timer.taskTitle = selected?.title ?? null;
      }
      timer.status = "running";
      timer.remainingMs = duration;
      timer.endAt = now + duration;
      timer.finishedAt = null;
      timer.alertedAt = null;
      timer.alertError = null;
      break;
    }
    case "timer.pause":
      requireValue(timer.status === "running", "Only a running timer can be paused.");
      timer.remainingMs = remainingTime(timer, now);
      timer.endAt = null;
      timer.status = "paused";
      break;
    case "timer.reset": {
      const selected = next.days[next.currentDate].find((task) => task.id === timer.taskId && !task.done);
      next.timer = { ...createTimer(timer.durationMinutes), taskId: selected?.id ?? null, taskTitle: selected?.title ?? null };
      break;
    }
    case "backup.import":
      requireValue(isObject(command.backup) && command.backup.format === "edge-todo-light", "This is not an Edge Todo Light backup file.");
      return validateState(reconcileState(structuredClone(validateState(command.backup.state)), now));
    default:
      throw new Error(`Unsupported request: ${command.type}`);
  }
  return validateState(next);
}

export function makeBackup(state, now = Date.now()) {
  return { format: "edge-todo-light", exportedAt: new Date(now).toISOString(), state: structuredClone(validateState(state)) };
}
