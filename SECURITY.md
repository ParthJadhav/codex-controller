# Security policy

## Supported versions

Security fixes are made against the latest release and the `main` branch.

## Report a vulnerability

Please use GitHub's private vulnerability reporting at
`https://github.com/ParthJadhav/codex-controller/security/advisories/new`.
Do not open a public issue for an exploitable vulnerability.

Include the affected version, macOS version, preconditions, reproduction steps,
impact, and any suggested mitigation. Remove credentials, private Codex task
content, and unique controller or machine identifiers.

Particularly sensitive boundaries include:

- Accessibility and synthetic keyboard or pointer events;
- validation of renderer-to-main and main-to-native messages;
- target-app and foreground checks before input dispatch;
- profile import, Codex keymap writes, URLs, and filesystem destinations;
- native bridge process handling and controller HID reports;
- signing, notarization, update artifacts, and GitHub Actions secrets.

You should receive an acknowledgement within seven days. Please allow time to
validate and release a coordinated fix before public disclosure.
