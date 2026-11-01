import { test, expect, chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_KEY, applyCommand, createState, localDateKey, makeBackup } from "../../src/model.js";

const extensionPath = fileURLToPath(new URL("../../", import.meta.url));
let context;
let worker;
let extensionId;
let profile;
let page;

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: process.env.TEST_BROWSER_CHANNEL || "msedge",
    headless: true,
    acceptDownloads: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  worker = context.serviceWorkers().find((item) => item.url().includes("/src/background.js"))
    ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
  extensionId = new URL(worker.url()).host;
}

async function openApp() {
  const app = await context.newPage();
  await app.goto(`chrome-extension://${extensionId}/app.html`);
  await expect(app.getByRole("button", { name: "Edit daily Todos", exact: true })).toBeEnabled();
  return app;
}

async function send(command) {
  return page.evaluate((value) => chrome.runtime.sendMessage({ target: "background", command: value }), command);
}

async function addTask(title) {
  await page.getByLabel("New Todo", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add Todo", exact: true }).click();
  await expect(page.locator(".task-title").filter({ hasText: title })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add Todo", exact: true })).toBeEnabled();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), "edge-todo-light-e2e-"));
  await launch();
});

test.afterAll(async () => {
  if (context) await context.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

test.beforeEach(async () => {
  page = await openApp();
  const result = await send({ type: "backup.import", backup: makeBackup(createState()) });
  expect(result.ok).toBe(true);
});

test.afterEach(async () => {
  if (page && !page.isClosed()) await page.close();
});

test("loads the actual extension, opens by toolbar action, and persists checkboxes on reload", async () => {
  const behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
  expect(behavior.openPanelOnActionClick).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.locator("body").innerText()).not.toMatch(/[\uac00-\ud7a3]/u);
  await expect(page.locator("#timer-display")).toHaveText("20:00");
  await addTask("My first Todo");
  await page.getByRole("checkbox", { name: "My first Todo complete", exact: true }).check();
  await expect(page.locator("#completion-count")).toHaveText("1 / 1 done");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "My first Todo complete", exact: true })).toBeChecked();
  await expect(page.locator(".task-row")).toHaveClass(/is-done/);
});

test("edits daily templates and preserves today's completion check", async () => {
  await page.getByRole("button", { name: "Edit daily Todos", exact: true }).click();
  await page.getByRole("button", { name: "+ Add daily Todo", exact: true }).click();
  await page.getByLabel("Daily Todo 1", { exact: true }).fill("Read every day");
  await page.getByRole("button", { name: "+ Add daily Todo", exact: true }).click();
  await page.getByLabel("Daily Todo 2", { exact: true }).fill("Exercise every day");
  await page.locator("#save-templates").click();
  await expect(page.locator("#templates-dialog")).not.toBeVisible();
  await page.getByRole("checkbox", { name: "Read every day complete", exact: true }).check();
  await expect(page.locator("#completion-count")).toHaveText("1 / 2 done");
  await page.getByRole("button", { name: "Edit daily Todos", exact: true }).click();
  await page.getByLabel("Daily Todo 1", { exact: true }).fill("Read for 20 minutes");
  await page.locator("#save-templates").click();
  await expect(page.getByRole("checkbox", { name: "Read for 20 minutes complete", exact: true })).toBeChecked();
  await expect(page.locator(".task-tag").filter({ hasText: "Daily" })).toHaveCount(2);
});

test("selects a task, changes duration, pauses, resumes and resets the countdown", async () => {
  await addTask("Focused work");
  await page.getByRole("button", { name: "Focused work Focus", exact: true }).click();
  await expect(page.locator("#focus-task")).toHaveValue(await page.locator(".task-row").getAttribute("data-id"));
  await page.getByLabel("Duration (minutes)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Start focus", exact: true }).click();
  await expect(page.locator("#timer-message")).toHaveText("Focused work · Focusing");
  await expect(page.locator("#focus-minutes")).toBeDisabled();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  const paused = await page.locator("#timer-display").textContent();
  await page.waitForTimeout(1200);
  await expect(page.locator("#timer-display")).toHaveText(paused);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator("#timer-display")).toHaveText("01:00");
  await expect(page.getByRole("button", { name: "Start focus", exact: true })).toBeEnabled();
});

test("invalid entered duration shows an English error without starting the old duration", async () => {
  await page.getByLabel("Duration (minutes)", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Start focus", exact: true }).click();
  await expect(page.locator("#error-banner")).toBeVisible();
  await expect(page.locator("#error-message")).toHaveText("Focus duration must be a whole number from 1 to 180 minutes.");
  const result = await send({ type: "state.get" });
  expect(result.state.timer.status).toBe("idle");
  expect(result.state.timer.durationMinutes).toBe(20);
});

test("retains Todo data and the running countdown across a full browser restart", async () => {
  await addTask("Keep this Todo after closing Edge");
  await page.getByRole("button", { name: "Start focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  const before = (await send({ type: "state.get" })).state;
  await context.close();
  await launch();
  page = await openApp();
  await expect(page.locator(".task-title")).toHaveText("Keep this Todo after closing Edge");
  const after = (await send({ type: "state.get" })).state;
  expect(after.timer.status).toBe("running");
  expect(after.timer.endAt).toBe(before.timer.endAt);
  expect(after.days[after.currentDate][0].id).toBe(before.days[before.currentDate][0].id);
  const alarm = await worker.evaluate(() => chrome.alarms.get("edge-todo-focus"));
  expect(alarm.scheduledTime).toBe(before.timer.endAt);
});

test("a new day resets common checks, carries unfinished additions and keeps read-only history", async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(12, 0, 0, 0);
  const at = yesterday.getTime();
  let old = applyCommand(createState(at), { type: "templates.save", templates: [{ id: "daily", title: "Daily work" }] }, at);
  old = applyCommand(old, { type: "task.toggle", id: old.days[old.currentDate][0].id, done: true }, at);
  old = applyCommand(old, { type: "task.add", title: "Unfinished work" }, at, () => "carry");
  const result = await send({ type: "backup.import", backup: makeBackup(old) });
  expect(result.ok).toBe(true);
  await expect(page.getByRole("checkbox", { name: "Daily work complete", exact: true })).not.toBeChecked();
  await expect(page.locator(".task-title").filter({ hasText: "Unfinished work" })).toBeVisible();
  await expect(page.getByText("Carried over", { exact: true })).toBeVisible();
  await page.getByLabel("Todo date", { exact: true }).fill(localDateKey(at));
  await page.getByLabel("Todo date", { exact: true }).dispatchEvent("change");
  await expect(page.getByRole("checkbox", { name: "Daily work complete", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Daily work complete", exact: true })).toBeDisabled();
  await expect(page.locator("#add-task-form")).not.toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator("#add-task-form")).toBeVisible();
});

test("updates multiple open views without losing concurrent additions", async () => {
  const second = await openApp();
  try {
    const responses = await Promise.all([
      page.evaluate(() => chrome.runtime.sendMessage({ target: "background", command: { type: "task.add", title: "First window" } })),
      second.evaluate(() => chrome.runtime.sendMessage({ target: "background", command: { type: "task.add", title: "Second window" } }))
    ]);
    expect(responses.every((response) => response.ok)).toBe(true);
    await expect(page.locator(".task-row")).toHaveCount(2);
    await expect(second.locator(".task-row")).toHaveCount(2);
  } finally {
    await second.close();
  }
});

test("finishes with the UI closed, plays an offscreen alarm, notifies and shows red at zero", async () => {
  await addTask("Short focus test");
  await page.getByRole("button", { name: "Short focus test Focus", exact: true }).click();
  await page.getByRole("button", { name: "Start focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key];
    state.timer.endAt = Date.now() + 1200;
    await chrome.storage.local.set({ [key]: state });
    await chrome.alarms.create("edge-todo-focus", { when: state.timer.endAt });
  }, STORAGE_KEY);
  await page.close();
  await expect.poll(async () => worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key].timer.status, STORAGE_KEY), {
    timeout: 35_000
  }).toBe("finished");
  await expect.poll(async () => worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key].timer.alertedAt, STORAGE_KEY)).not.toBeNull();
  const stored = await worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STORAGE_KEY);
  expect(stored.timer.alertError).toBeNull();
  const notifications = await worker.evaluate(() => chrome.notifications.getAll());
  expect(Object.keys(notifications)).toContain(`edge-todo-finished:${stored.timer.startedAt}`);
  const audio = await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }));
  expect(audio.length).toBe(1);
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/app.html`);
  await expect(page.locator("#timer-display")).toHaveText("00:00");
  await expect(page.locator("#timer-card")).toHaveClass(/is-finished/);
  await expect(page.locator("#timer-message")).toHaveText("Focus complete! Take a short break.");
  await page.getByRole("button", { name: "Dismiss / Reset", exact: true }).click();
  await expect(page.locator("#timer-card")).not.toHaveClass(/is-finished/);
});

test("exports a complete backup and rejects corrupt import data without losing Todos", async () => {
  await addTask("Todo to back up");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(backup.format).toBe("edge-todo-light");
  expect(backup.state.days[backup.state.currentDate][0].title).toBe("Todo to back up");
  await page.locator("#backup-file").setInputFiles({
    name: "bad-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "edge-todo-light", state: { version: 99 } }))
  });
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(page.locator("#error-banner")).toBeVisible();
  await expect(page.locator("#import-dialog .dialog-error")).toContainText("version");
  await expect(page.locator(".task-title")).toHaveText("Todo to back up");
  await page.locator("#cancel-import").click();
  await addTask("Temporary Todo");
  const validFile = {
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup))
  };
  await page.locator("#backup-file").setInputFiles(validFile);
  await page.locator("#cancel-import").click();
  await expect(page.locator(".task-row")).toHaveCount(2);
  await page.locator("#backup-file").setInputFiles(validFile);
  await page.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(page.locator("#import-dialog")).not.toBeVisible();
  await expect(page.locator(".task-title")).toHaveText("Todo to back up");
});

test("renders titles as text, displays template validation errors, and fits a narrow sidebar", async () => {
  await page.setViewportSize({ width: 320, height: 850 });
  await addTask('<img src=x onerror="alert(1)">');
  await expect(page.locator("#task-list img")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit daily Todos", exact: true }).click();
  await page.getByRole("button", { name: "+ Add daily Todo", exact: true }).click();
  await page.getByLabel("Daily Todo 1", { exact: true }).fill("   ");
  await page.locator("#save-templates").click();
  await expect(page.locator("#templates-dialog .dialog-error")).toBeVisible();
  await expect(page.locator("#templates-dialog .dialog-error")).toHaveText("Enter a Todo title.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await page.locator("#dismiss-error").click();
  const clean = createState();
  const at = Date.now();
  const display = applyCommand(clean, {
    type: "templates.save",
    templates: [{ id: "read", title: "Read for 20 minutes" }, { id: "exercise", title: "Go for a walk" }]
  }, at);
  const checked = applyCommand(display, { type: "task.toggle", id: display.days[display.currentDate][1].id, done: true }, at);
  await send({ type: "backup.import", backup: makeBackup(checked) });
  await addTask("Write the project plan");
  await page.getByRole("button", { name: "Write the project plan Focus", exact: true }).click();
  await expect(page.locator("#focus-task")).not.toHaveValue("");
  await page.screenshot({ path: join(extensionPath, "test-results", "sidebar.png"), fullPage: true });
});
