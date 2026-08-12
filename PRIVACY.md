# Privacy statement

Codex Controller is a local macOS companion. Its core runtime contains no networking client, analytics SDK, telemetry, advertising, account system, or ChatGPT credential access.

## Data handled

The app reads semantic controller elements delivered by Apple's Game Controller framework. Recent input values are held in memory for the live Diagnostics table and are discarded when the process exits.

The app stores one local, versioned profile library containing 1–24 mapping profiles at:

```text
~/Library/Application Support/codex-controller/profiles.json
```

On first launch after the rename, Codex Controller checks the predecessor's
`controller-controls/profiles.json` path only when the new file does not exist. A valid legacy
library is copied to the new path; the original is left untouched.

Those profiles may contain user-entered names, shortcut labels, URLs, text insertion templates, and action-sequence steps. They do not contain Bluetooth addresses, controller event history, ChatGPT task IDs, conversation contents, credentials, or Accessibility tree data.

Profile and diagnostics exports occur only after the user chooses a destination in a macOS save panel. A profile export is a standalone JSON file containing only the selected profile, not the rest of the library. Importing that file validates it first, assigns new identifiers, and adds it to the existing library without replacing other profiles. Older whole-library export files remain importable, but only the profile marked active in that file is added. The privacy-safe diagnostics report includes versions, permission states, capability names, library/profile schemas, saved-profile count, the user-chosen active profile name, binding count, and a recent in-memory event count; it excludes event values and histories.

When the user starts a physical acceptance session, the app keeps expected/observed input sets, aggregate edge counts, connection/background/system-sleep/system-wake booleans, duplicate-edge candidates, and resting analog maxima in memory. It also counts controller-initiated action outcomes. A dispatch reported as sent remains pending until the user explicitly confirms that the intended Codex effect was observed. Pending action titles and payloads remain in memory; diagnostics export only attempt/result totals, the number of distinct confirmed actions, and confirmed adapter-type counts. These values are cleared on reset or app exit. An export never includes action titles, URLs, shortcuts, text payloads, event timestamps, or a raw input history.

## Permissions

- **Input Monitoring** may be needed to receive controller events while Codex Controller is not frontmost. The app does not register a keyboard listener.
- **Accessibility** is needed only for posting user-configured keyboard shortcuts, Unicode text insertion, and touchpad pointer movement and clicks. Immediately before posting input, the app verifies that the Codex desktop app (`com.openai.codex`) is running and is the intended foreground target.
- **Microphone** is needed only for the DualSense audio verification the user starts explicitly in Settings: the wired controller-microphone route check captures briefly from the controller's own CoreAudio input to confirm the route works, and audio-device state is reported in Diagnostics. Samples are analyzed for that check and discarded; nothing is recorded to disk, kept, or transmitted. The app performs no speech recognition and produces no transcript. Dictation belongs to Codex: the mapped push-to-talk control posts Codex's own dictation shortcut, and Codex records, processes, and keeps whatever it records.
- **Speech Recognition** is never requested. The app does not link macOS Speech and the packaged
  bundle contains no Speech Recognition usage description.
- **Automation** is not requested. The app does not control Codex with Apple Events or AppleScript.
- `codex://` deep links do not require Accessibility.

The user can revoke any permission in System Settings at any time. When Accessibility is absent, the app fails closed and posts no synthetic input. Permission snapshots refresh after an in-app request, periodically while the native bridge is running, and whenever the user presses the Diagnostics refresh control.

## External actions

Mappings can open a published `codex://` destination or an HTTP/HTTPS URL. The companion asks Launch Services to open the destination; it does not fetch the URL itself. No file, shell, or arbitrary URL scheme action is supported in the current profile model.

## The one file outside the app's own storage

Several Codex commands the app can drive are registered by Codex with no keyboard shortcut, so the key the app posts lands nowhere until a binding exists. On an explicit user action — the sidebar's offer to finish setup — the app writes those bindings into Codex's own user keymap:

```text
~/.codex/keybindings.json
```

Nothing about this is implicit or silent:

- it happens only from that explicit action, never on launch, install, or profile change;
- an existing non-empty keymap is copied to `keybindings.json.codex-controller-backup.json` first, so the previous state is restorable;
- the new file is written to a temporary path and renamed into place, so an interrupted write cannot truncate the keymap;
- a file the app cannot parse is left untouched, and so is an accelerator another Codex command already holds;
- only commands Codex ships unbound are ever written, and only those the active profile actually posts;
- the app reads nothing else from `~/.codex` and reads no Codex conversation, thread, or account data.

## Removal

Deleting the app removes the executable. Deleting the Application Support directory above removes
the current saved profile library. A predecessor library remains at
`~/Library/Application Support/controller-controls/profiles.json` unless the user removes it. If
the app wrote Codex bindings, restore `~/.codex/keybindings.json` from
`keybindings.json.codex-controller-backup.json` (or delete the entries by hand in Codex's Keyboard
Shortcuts) and then delete the backup. Permission records can be removed from **System Settings >
Privacy & Security** under **Input Monitoring**, **Accessibility**, and **Microphone**.
