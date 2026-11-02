# Privacy Policy for Edge Todo Light

Effective date: November 1, 2026

This policy describes how the Edge Todo Light extension for Microsoft Edge
handles information.

## Local data and its purpose

The extension processes and saves the following information locally in your
Edge profile using `chrome.storage.local`:

- Todo titles, daily recurring templates and date-based Todo history.
- Completion status, creation and completion timestamps, and carry-over dates.
- List view preferences for placing completed Todos last or hiding them.
- Focus timer settings and state, including the selected Todo, duration,
  deadline, pause state and notification status.

This information is used only to provide Todo management, daily checklists,
focus countdowns and backup/restore features. No account or sign-in is required.

## No external collection or transmission

The extension does not send your Todo content, timer information or usage data
to the developer or to external servers. It does not use advertising,
analytics, tracking services or remote executable code.

The extension does not read website content or track your browsing history.
It does not synchronize data with other devices or Edge profiles. The
developer has no remote access to the data stored by the extension.
The developer does not sell or transfer this locally stored information to
third parties.

## Notifications

A focus-completion system notification may contain the selected Todo title.
Depending on your operating system settings, notifications may appear on your
desktop or lock screen. Consider this visibility when entering Todo titles.

You can control or disable notifications through Edge and operating system
settings. Browser and operating system services are governed by their own
privacy policies and settings.

## Backup files

Exporting a backup creates a JSON file containing your Todo data, list view
preferences and timer data.
Importing reads the backup file you explicitly select and replaces the
extension's current local data. The extension does not upload these files.

Backup files are not encrypted by the extension. You control where you keep
them and whether you share them, including whether the chosen folder is
synchronized by another application. Deleting the extension does not delete
previously exported backup files.

## Retention and deletion

Local data remains in your Edge profile until you remove it, clear the
extension's storage or uninstall the extension. Historical Todo records are
retained locally; there is no automatic expiration.

You can edit or remove Todos from today's list and manage daily templates.
Removing an item from today's list does not erase past records. Removing a
daily template stops future occurrences but does not erase past records.
Sorting or hiding completed Todos changes only their display and does not
delete any Todo data or history.

To remove all data stored by the extension, clear its local extension storage
or uninstall it. Delete any exported backup files separately if you no longer
want to retain them.

The extension does not add its own encryption to local storage. Protect access
to your device and Edge profile, and do not enter passwords or highly sensitive
information.

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Save Todos, daily templates, history and timer state locally. |
| `alarms` | Schedule focus completion and local day changes while Edge can run the extension. |
| `notifications` | Show focus completion and user-requested test notifications. |
| `offscreen` | Play a brief alarm sound using a bundled local document. |
| `sidePanel` | Display Todos and the focus timer in the Edge sidebar. |

## Contact and changes

For privacy questions, use the project's
[GitHub Issues page](https://github.com/msdongsoo/edgetodolight/issues).
GitHub is a separate service governed by its own privacy policy. Do not post
private Todo content or unredacted backup files in a public issue.

This policy will be updated if the extension's data handling changes.
