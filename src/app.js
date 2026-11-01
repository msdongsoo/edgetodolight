import { STORAGE_KEY, localDateKey, makeBackup, remainingTime, validateState } from "./model.js";

const element = (id) => document.getElementById(id);
let state;
let selectedDate;
let busy = false;
let templateDraft = [];
let renameId;
let requestedCompletion;
let pendingBackup;

const icons = {
  focus: '<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle>',
  rename: '<path d="m15 4 5 5-11 11H4v-5z"></path><path d="m13 6 5 5"></path>',
  delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"></path>'
};

function showError(error) {
  console.error("Edge Todo UI error:", error);
  const message = error instanceof Error ? error.message : String(error);
  element("error-message").textContent = message;
  element("error-banner").hidden = false;
  const dialogError = document.querySelector("dialog[open] .dialog-error");
  if (dialogError) {
    dialogError.textContent = message;
    dialogError.hidden = false;
  }
}

function clearError() {
  element("error-banner").hidden = true;
  for (const error of document.querySelectorAll(".dialog-error")) error.hidden = true;
}

async function request(command) {
  const response = await chrome.runtime.sendMessage({ target: "background", command });
  if (!response?.ok) throw new Error(response?.error ?? "The extension did not respond. Reload it and try again.");
  state = response.state;
  selectedDate ??= state.currentDate;
  render();
  return state;
}

async function perform(operation) {
  if (busy) return;
  busy = true;
  clearError();
  renderControls();
  try {
    await operation();
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    renderControls();
  }
}

function renderControls() {
  const ready = Boolean(state) && !busy;
  const current = ready && selectedDate === state.currentDate;
  const active = state && ["running", "paused"].includes(state.timer.status);
  for (const id of ["test-alarm", "edit-templates", "history-date", "export-backup", "import-backup"]) {
    element(id).disabled = !ready;
  }
  for (const id of ["new-task", "add-task"]) element(id).disabled = !current;
  element("focus-task").disabled = !ready || active;
  element("focus-minutes").disabled = !ready || active;
  element("timer-start").disabled = !ready;
  element("timer-pause").disabled = !ready;
  element("timer-reset").disabled = !ready || state.timer.status === "idle";
  for (const control of element("task-list").querySelectorAll("input, button")) {
    control.disabled = !current || (control.dataset.action === "focus" && (active || control.dataset.done === "true"));
  }
  for (const control of document.querySelectorAll("dialog button, dialog input")) control.disabled = busy;
  document.body.setAttribute("aria-busy", String(busy));
}

function renderTimer() {
  if (!state) return;
  const timer = state.timer;
  const milliseconds = remainingTime(timer);
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  element("timer-display").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  element("timer-progress").value = 1 - milliseconds / (timer.durationMinutes * 60_000);
  element("timer-card").classList.toggle("is-finished", timer.status === "finished");
  const messages = {
    idle: "Choose one Todo and give it your attention.",
    running: `${timer.taskTitle ?? "Your focus time"} · Focusing`,
    paused: "Paused. Resume when you are ready.",
    finished: "Focus complete! Take a short break."
  };
  const message = messages[timer.status];
  if (element("timer-message").textContent !== message) element("timer-message").textContent = message;
  element("timer-start").hidden = timer.status === "running";
  element("timer-start").textContent = timer.status === "paused" ? "Resume" : timer.status === "finished" ? "Focus again" : "Start focus";
  element("timer-pause").hidden = timer.status !== "running";
  element("timer-reset").textContent = timer.status === "finished" ? "Dismiss / Reset" : "Reset";
  element("alarm-warning").hidden = !timer.alertError;
  element("alarm-warning").textContent = timer.alertError ? `The timer finished, but an alert failed. ${timer.alertError}` : "";
}

function actionButton(action, task) {
  const button = document.createElement("button");
  const label = { focus: "Focus", rename: "Edit", delete: "Delete" }[action];
  button.type = "button";
  button.className = "icon-button";
  button.dataset.action = action;
  button.dataset.done = String(task.done);
  button.setAttribute("aria-label", `${task.title} ${label}`);
  button.title = action === "delete" && task.templateId !== null ? "Remove from today only (keep the daily Todo)" : label;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[action]}</svg>`;
  return button;
}

function tag(text, focus = false) {
  const span = document.createElement("span");
  span.className = focus ? "task-tag focus-tag" : "task-tag";
  span.textContent = text;
  return span;
}

function renderTasks() {
  const tasks = state.days[selectedDate] ?? [];
  const current = selectedDate === state.currentDate;
  const list = element("task-list");
  list.replaceChildren();
  for (const task of tasks) {
    const row = document.createElement("li");
    row.className = `task-row${task.done ? " is-done" : ""}`;
    row.dataset.id = task.id;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `${task.title} complete`);
    const copy = document.createElement("div");
    copy.className = "task-copy";
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;
    copy.append(title);
    const tags = document.createElement("div");
    tags.className = "task-tags";
    if (task.templateId !== null) tags.append(tag("Daily"));
    if (task.carriedFrom !== null) tags.append(tag("Carried over"));
    if (task.id === state.timer.taskId && current) tags.append(tag("Focus Todo", true));
    if (tags.childElementCount > 0) copy.append(tags);
    row.append(checkbox, copy);
    if (current) {
      const actions = document.createElement("div");
      actions.className = "task-actions";
      for (const action of ["focus", "rename", "delete"]) actions.append(actionButton(action, task));
      row.append(actions);
    }
    list.append(row);
  }
  element("completion-count").textContent = `${tasks.filter((task) => task.done).length} / ${tasks.length} done`;
  element("empty-state").hidden = tasks.length > 0;
  element("empty-message").textContent = current ? "What would you like to do today?" : "No Todos were saved for this date.";
  element("empty-state").querySelector(".hint").hidden = !current;
  element("history-notice").hidden = current;
  element("add-task-form").hidden = !current;
  element("go-today").hidden = current;
  element("todo-heading").textContent = current ? "Today's Todos" : "Past Todos";
}

function render() {
  element("history-date").max = state.currentDate;
  element("history-date").value = selectedDate;
  if (document.activeElement !== element("focus-minutes")) element("focus-minutes").value = state.timer.durationMinutes;
  const select = element("focus-task");
  select.replaceChildren(new Option("Focus without a task", ""));
  const available = state.days[state.currentDate].filter((task) => !task.done || task.id === state.timer.taskId);
  for (const task of available) select.add(new Option(task.title, task.id));
  if (state.timer.taskId && !available.some((task) => task.id === state.timer.taskId)) {
    select.add(new Option(state.timer.taskTitle ?? "Previous Todo", state.timer.taskId));
  }
  select.value = state.timer.taskId ?? "";
  renderTimer();
  renderTasks();
  renderControls();
}

function renderTemplateDraft() {
  const list = element("template-list");
  list.replaceChildren();
  for (const [index, template] of templateDraft.entries()) {
    const row = document.createElement("div");
    row.className = "template-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = template.title;
    input.maxLength = 200;
    input.required = true;
    input.placeholder = "e.g. Read for 20 minutes";
    input.setAttribute("aria-label", `Daily Todo ${index + 1}`);
    input.addEventListener("input", () => { template.title = input.value; });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete daily Todo ${index + 1}`);
    remove.addEventListener("click", () => {
      templateDraft = templateDraft.filter((item) => item.id !== template.id);
      renderTemplateDraft();
      element("add-template").focus();
    });
    row.append(input, remove);
    list.append(row);
  }
}

element("dismiss-error").addEventListener("click", clearError);
element("add-task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    await request({ type: "task.add", title: element("new-task").value });
    element("new-task").value = "";
  }).then(() => element("new-task").focus());
});

element("task-list").addEventListener("change", (event) => {
  if (!event.target.matches(".task-checkbox")) return;
  const id = event.target.closest(".task-row").dataset.id;
  void perform(() => request({ type: "task.toggle", id, done: event.target.checked })).then(() => {
    if (state) render();
  });
});

element("task-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const id = button.closest(".task-row").dataset.id;
  const task = state.days[state.currentDate].find((item) => item.id === id);
  if (button.dataset.action === "focus") {
    void perform(() => request({ type: "timer.select", id }));
  } else if (button.dataset.action === "delete") {
    void perform(() => request({ type: "task.delete", id }));
  } else {
    clearError();
    renameId = id;
    element("rename-title").value = task.title;
    element("rename-hint").textContent = task.templateId === null ? "Edit this Todo in today's list." : "This also updates the daily Todo for future days.";
    element("rename-dialog").showModal();
    element("rename-title").select();
  }
});

element("rename-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    await request({ type: "task.rename", id: renameId, title: element("rename-title").value });
    element("rename-dialog").close();
  });
});
element("cancel-rename").addEventListener("click", () => element("rename-dialog").close());

element("focus-task").addEventListener("change", () => {
  void perform(() => request({ type: "timer.select", id: element("focus-task").value || null }));
});
element("focus-minutes").addEventListener("change", () => {
  clearError();
  void request({ type: "timer.duration", minutes: Number(element("focus-minutes").value) }).catch(showError);
});
element("timer-start").addEventListener("click", () => {
  const minutes = Number(element("focus-minutes").value);
  void perform(() => request({ type: "timer.start", minutes }));
});
element("timer-pause").addEventListener("click", () => { void perform(() => request({ type: "timer.pause" })); });
element("timer-reset").addEventListener("click", () => { void perform(() => request({ type: "timer.reset" })); });
element("test-alarm").addEventListener("click", () => { void perform(() => request({ type: "alarm.test" })); });

element("history-date").addEventListener("change", () => {
  selectedDate = element("history-date").value || state.currentDate;
  render();
});
element("go-today").addEventListener("click", () => {
  selectedDate = state.currentDate;
  render();
});

element("edit-templates").addEventListener("click", () => {
  clearError();
  templateDraft = structuredClone(state.templates);
  renderTemplateDraft();
  element("templates-dialog").showModal();
});
element("add-template").addEventListener("click", () => {
  templateDraft.push({ id: crypto.randomUUID(), title: "" });
  renderTemplateDraft();
  element("template-list").lastElementChild.querySelector("input").focus();
});
element("templates-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    await request({ type: "templates.save", templates: templateDraft });
    element("templates-dialog").close();
  });
});
for (const id of ["close-templates", "cancel-templates"]) {
  element(id).addEventListener("click", () => element("templates-dialog").close());
}

element("export-backup").addEventListener("click", () => {
  void perform(async () => {
    const latest = await request({ type: "state.get" });
    const blob = new Blob([JSON.stringify(makeBackup(latest), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `edge-todo-${latest.currentDate}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});
element("import-backup").addEventListener("click", () => element("backup-file").click());
element("backup-file").addEventListener("change", () => {
  const file = element("backup-file").files[0];
  if (!file) return;
  void perform(async () => {
    if (file.size > 10 * 1024 * 1024) throw new Error("Backup files must be 10MB or smaller.");
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch (error) {
      throw new Error("Could not read the backup. Choose a valid JSON file.", { cause: error });
    }
    pendingBackup = backup;
    element("import-dialog").showModal();
  }).finally(() => { element("backup-file").value = ""; });
});

element("import-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    await request({ type: "backup.import", backup: pendingBackup });
    pendingBackup = undefined;
    selectedDate = state.currentDate;
    render();
    element("import-dialog").close();
  });
});
element("cancel-import").addEventListener("click", () => {
  pendingBackup = undefined;
  element("import-dialog").close();
});
element("import-dialog").addEventListener("cancel", () => { pendingBackup = undefined; });

if (globalThis.chrome?.runtime?.id) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]?.newValue) return;
    try {
      const incoming = validateState(changes[STORAGE_KEY].newValue);
      const wasToday = !state || selectedDate === state.currentDate;
      state = incoming;
      if (wasToday) selectedDate = state.currentDate;
      render();
    } catch (error) {
      showError(error);
    }
  });
}

function refresh() {
  if (!globalThis.chrome?.runtime?.id) {
    showError(new Error("Install this as an Edge extension before opening it. Saving is unavailable on a regular web page."));
    return;
  }
  void perform(() => request({ type: "state.get" }));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});
window.addEventListener("focus", refresh);

setInterval(() => {
  if (!state) return;
  renderTimer();
  const expired = state.timer.status === "running" && remainingTime(state.timer) === 0;
  const changedDay = localDateKey() !== state.currentDate;
  if (!busy && (changedDay || (expired && requestedCompletion !== state.timer.startedAt))) {
    requestedCompletion = state.timer.startedAt;
    refresh();
  }
}, 250);

refresh();
