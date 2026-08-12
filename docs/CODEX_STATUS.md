# Codex task-status boundary

Codex Controller reports only state it can establish itself: controller
connection, mapping dispatch, permission failures, target availability, and
effects explicitly confirmed by the user.

It does not infer Codex task status from files, process inspection, private IPC,
window appearance, logs, or database timestamps. The production app does not
attach to a Codex app-server process owned by another application.

A future opt-in feature may run a dedicated Codex app-server and own the
sessions it starts or resumes. Such a mode must use a documented local
transport, keep authentication inside supported Codex flows, avoid exposing
task contents in diagnostics, and fail without affecting ordinary controller
mappings.
