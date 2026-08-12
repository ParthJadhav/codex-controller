# Contributing

Thank you for improving Codex Controller.

## Set up

Development requires macOS 14 or newer, Node.js 22 or newer, and Xcode
command-line tools.

```sh
npm ci
npm run native:build
npm test
swift test --package-path native
npm run build:all
```

Use a real DualSense for changes involving controller discovery, transport,
touch, lights, haptics, audio, permissions, reconnects, or sleep/wake. State
clearly which physical cases were and were not exercised.

## Pull requests

- Keep changes focused and include tests for behavior that can be proven without
  hardware.
- Preserve the renderer sandbox, typed preload boundary, IPC validation, target
  checks, and fail-closed permission behavior.
- Do not add private Codex IPC, credential access, app-bundle patching, arbitrary
  URL schemes, shell actions, or silent writes outside the app's data directory.
- Do not commit generated release artifacts, controller identifiers, private
  task content, credentials, downloaded fonts, or media without documented
  redistribution rights.
- Update privacy, permission, interoperability, and third-party notices when a
  change affects those boundaries.

By submitting a contribution, you agree that it may be distributed under the
MIT License in this repository.
