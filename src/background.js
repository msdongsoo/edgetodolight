import { STORAGE_KEY, applyCommand, createState, nextMidnight, reconcileState, validateState } from "./model.js";

export const FOCUS_ALARM = "edge-todo-focus";
export const DAILY_ALARM = "edge-todo-midnight";
let queue = Promise.resolve();

// Serialize UI commands and alarm events so multiple panels cannot overwrite each other.
function enqueue(operation) {
  const result = queue.then(operation);
  queue = result.catch((error) => console.error("Edge Todo operation failed:", error));
  return result;
}

async function save(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function syncAlarms(state, now) {
  const midnight = nextMidnight(now);
  const daily = await chrome.alarms.get(DAILY_ALARM);
  if (!daily || daily.scheduledTime !== midnight) {
    await chrome.alarms.create(DAILY_ALARM, { when: midnight });
  }
  if (state.timer.status === "running") {
    const focus = await chrome.alarms.get(FOCUS_ALARM);
    if (!focus || focus.scheduledTime !== state.timer.endAt) {
      await chrome.alarms.create(FOCUS_ALARM, { when: state.timer.endAt });
    }
  } else {
    await chrome.alarms.clear(FOCUS_ALARM);
  }
}

async function playAlarm() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")]
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play a short sound when the focus countdown finishes."
    });
  }
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type: "alarm.play" });
  if (!response?.ok) throw new Error(response?.error ?? "The alarm audio document did not respond.");
}

async function sendNotification(timer, test = false) {
  await chrome.notifications.create(test ? "edge-todo-test" : `edge-todo-finished:${timer.startedAt}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
    title: test ? "Todo alert test" : "Focus complete!",
    message: test ? "If you see this notification and hear the sound, you are ready." : `${timer.taskTitle ?? "Focus time"} · ${timer.durationMinutes} minutes complete. Take a short break.`,
    priority: 2
  });
}

async function deliverAlerts(timer, test = false) {
  const results = await Promise.allSettled([sendNotification(timer, test), playAlarm()]);
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`${index === 0 ? "System notification" : "Alarm sound"}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
    : []);
  if (failures.length > 0) throw new Error(failures.join(" / "));
}

async function updateBadge(timer) {
  const text = timer.status === "finished" ? "!" : timer.status === "running" ? "ON" : timer.status === "paused" ? "||" : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: timer.status === "finished" ? "#b92b25" : "#286747" });
}

async function processCommand(command = { type: "state.get" }) {
  const now = Date.now();
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const previous = stored[STORAGE_KEY] === undefined ? createState(now) : validateState(stored[STORAGE_KEY]);
  let state = reconcileState(previous, now);
  if (command.type !== "state.get" && command.type !== "alarm.test") {
    state = applyCommand(state, command, now);
  }
  if (state !== previous || stored[STORAGE_KEY] === undefined) await save(state);
  await syncAlarms(state, now);
  if (state.timer.status === "finished" && state.timer.alertedAt === null) {
    let alertError = null;
    try {
      await deliverAlerts(state.timer);
    } catch (error) {
      console.error("Focus completion alert failed:", error);
      alertError = error instanceof Error ? error.message : String(error);
    }
    state = structuredClone(state);
    state.timer.alertedAt = Date.now();
    state.timer.alertError = alertError;
    await save(state);
  }
  await updateBadge(state.timer);
  if (command.type === "alarm.test") await deliverAlerts(state.timer, true);
  return state;
}

async function reportBackgroundError(error) {
  console.error("Edge Todo background error:", error);
  try {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b92b25" });
    await chrome.action.setTitle({ title: "Todo error: open the sidebar for details." });
  } catch (badgeError) {
    console.error("Could not display the background error:", badgeError);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "background") return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: "Only requests from this extension are allowed." });
    return false;
  }
  if (!message.command || typeof message.command.type !== "string") {
    sendResponse({ ok: false, error: "Invalid request format." });
    return false;
  }
  enqueue(() => processCommand(message.command)).then(
    (state) => sendResponse({ ok: true, state }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
  );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FOCUS_ALARM || alarm.name === DAILY_ALARM) {
    void enqueue(() => processCommand()).catch(reportBackgroundError);
  }
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("edge-todo-finished:") || id === "edge-todo-test") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("app.html") }).catch(reportBackgroundError);
  }
});

function initialize() {
  return enqueue(async () => {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    return processCommand();
  }).catch(reportBackgroundError);
}

chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
void initialize();
