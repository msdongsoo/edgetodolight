# Edge Todo Light

A local-only Todo list and focus countdown for the Edge sidebar.
The entire application interface is in English. User-entered Todo titles are
preserved as written, in any language.
Everything is saved with `chrome.storage.local`; no server, external database,
account or sign-in is required.

## Install in Edge

Download this repository using **Code > Download ZIP** and extract it, or clone it:

```powershell
git clone https://github.com/msdongsoo/edgetodolight.git
```

1. Open `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted or cloned project folder
   containing `manifest.json`.
4. Pin **Edge Todo Light** from the toolbar's extensions menu.
5. Click its checkmark icon to open the sidebar.

Installing the extension does not require Node.js or `npm install`.
Keep this folder in place: moving or deleting an unpacked extension's files
prevents it from working. After editing the code, click **Reload** on the
extension management page.

## Daily Todos

- Use **Edit daily Todos** to add, edit or remove recurring daily items.
- Changes apply to today's list immediately. Existing completed checks stay checked.
- On a new local calendar day, daily Todos appear with fresh, unchecked boxes.
- Editing a daily item from its row also updates the recurring template.
- Deleting a row removes it **only from today**. Remove it in the daily editor to stop future repetition.

## Additional Todos and completion

- Enter a Todo and click `+` or press Enter.
- Use the checkbox on the left to mark it complete or incomplete.
- Unfinished additional Todos carry over to the next day.
- Completed additions and past daily checklists remain in date-based history.
- Use the date selector to view past records. History is read-only.
- Dates follow the PC's local calendar, not UTC.

## Focus countdown

- Select a Todo using its **Focus** button or the selector above the timer.
  You can also focus without selecting a task.
- The default duration is **20 minutes**. Change it to **1-180 whole minutes** before starting.
- Use **Start focus**, **Pause**, **Resume** and **Reset**.
- At zero, the timer turns red, plays a short sound and shows a system notification.
- Completion notifications may display the selected Todo title. Desktop and lock-screen visibility follow your operating system's notification settings.
- Completing a focus session does not automatically check off the Todo.
- Use **Test alert** to check your sound and notification settings.

The timer stores its absolute deadline, so closing the sidebar or restarting
Edge does not reset it. Time continues to elapse while Edge is closed unless
you pause first.
**An entirely closed browser or a sleeping PC cannot play an alert at that moment.**
After restarting or waking, the extension checks the deadline and processes
any missed completion. Browser alarms may be delayed by the operating system;
this is not a guaranteed real-time alarm.
Windows/Edge notification settings and Do Not Disturb affect system alerts.
Volume and output-device settings affect sound. Alert API failures are displayed
in the application.

## Storage and backup

- Todos, daily templates, date-based completion and timer state are stored
  **only in this Edge profile on this PC**.
- There is no synchronization with other PCs or profiles and no external data transmission.
- Changes are saved immediately, not just when the browser closes.
- Use **Export backup** to download a JSON file and **Import backup** to restore one.
- Import shows an English confirmation dialog and replaces current data and the timer.
  Export first if you need to keep them. Invalid backup files do not replace existing data.
- Uninstalling the extension, deleting the Edge profile or profile corruption can lose data.
- Local extension storage is not an encrypted secret vault. Do not store passwords or other secrets.
- The default local storage quota is approximately 10MB. Failed saves are reported,
  and the last successfully persisted data remains intact.

For details about local processing, notification visibility, backups and deletion,
see the [Privacy Policy](PRIVACY.md).

## Development and verification

Use Node.js 22 or later and an installed Microsoft Edge.

```powershell
npm install
npm run check
npm test
npm run test:browser
```

Browser tests load the actual extension into a **separate temporary Edge profile**.
They do not modify your regular Edge profile or Todos.
The countdown completion test shortens only the test profile's deadline to verify
background alarms, offscreen audio, system notifications and the red completion screen.

To test on a development machine without Edge:

```powershell
npx playwright install chromium
$env:TEST_BROWSER_CHANNEL = "chromium"
npm run test:browser
```

Use `npm run generate:icons` to regenerate the bundled extension icons.
Browser test results and a sidebar screenshot are generated in `test-results`.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Save Todos and timer state locally |
| `alarms` | Handle countdown completion and day changes while the sidebar is closed |
| `notifications` | Show focus completion notifications |
| `offscreen` | Play a short sound on behalf of the service worker |
| `sidePanel` | Display the Edge sidebar |

No website-access permissions or content scripts are used.
