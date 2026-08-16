# Diagnostic logging

Codex Controller writes local diagnostic logs because the beta has no telemetry
or remote crash reporter. A log leaves the Mac only when a user chooses to
attach it to an issue.

## Location and retention

On macOS, open Finder, choose **Go > Go to Folder…**, and enter:

```text
~/Library/Logs/Codex Controller/
```

The directory contains the current `main.log` and up to three archives named
`main.1.log`, `main.2.log`, and `main.3.log`, newest first. Rotation begins when
the current file passes 5 MB. The active file and three archives therefore use
approximately 20 MB at most. Log files are created with owner-only read/write
permissions.

## What is logged

- app, Electron, Chromium, Node.js, macOS, and architecture versions;
- app/window lifecycle, renderer load failures, unresponsive/crashed processes,
  uncaught exceptions, and unhandled promise rejections;
- native-helper startup, shutdown, restart, timeout, and stderr diagnostics;
- controller connected/disconnected state, transport, capability count, light
  and haptic availability—but not controller names or identifiers;
- permission and Codex-running state when those values change;
- action type, focus policy, safety policy, gesture, and outcome status—but not
  the configured action title or payload;
- profile counts, binding counts, import/export completion, and Codex keymap
  operation status—but not profile or binding contents.

The logger does not intentionally record mapping payloads, typed text, shortcut
contents, URLs, controller event values or history, audio samples, profile
names, raw controller identifiers, Codex task content, or credentials. Before a
message reaches disk, it replaces the user's home-directory prefix, MAC
addresses, UUIDs, and common secret/token assignments.

Individual strings are truncated after 64 KiB, and deeply nested or unusually
large structured values are bounded before serialization so one malformed
diagnostic cannot bypass the file-size policy.

An unexpected operating-system, Electron, or native-framework error can still
include context the app did not construct. Review files before sharing them in
a public issue.

## Attach logs to a bug

Open the [bug report form](https://github.com/ParthJadhav/codex-controller/issues/new?template=bug_report.yml),
find **Diagnostic log files**, and drag `main.log` plus the numbered archives
into the text area. If the problem just happened, attach `main.log` first. If it
occurred in an earlier run, include all available archives.

Logs can be deleted at any time while Codex Controller is closed. The app
creates a new `main.log` on its next launch.
