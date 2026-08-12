# Interoperability boundary

Codex Controller is an independent companion. It interoperates with the Codex
desktop app and Sony DualSense hardware without redistributing their code,
firmware, credentials, or private user data.

## Codex

The production integration uses ordinary macOS input, Codex's registered
keyboard commands, user-configured shortcuts, and published `codex://` links.
It does not inject into Codex, modify its bundle, attach to its private process,
intercept IPC, read conversations, or access account credentials.

Some registered Codex commands ship without default keybindings. After a clear
user action, Codex Controller can add only the missing bindings required by the
active profile to `~/.codex/keybindings.json`. The file is parsed and checked
for conflicts, an existing non-empty file is backed up, and replacement is
atomic. Users can instead configure every binding inside Codex.

Command identifiers and behavior are version-specific rather than a stable
third-party API. They are isolated in `src/shared/codexCommands.ts`, exposed as
editable mappings, and reported as unconfirmed until the user verifies the
binding. A Codex update may therefore require a mapping change but not an app
bundle modification.

## DualSense

Normal input, motion, light, and haptic support uses Apple's public Game
Controller framework. Touchpad pointer delivery and some diagnostic/audio
capabilities use public macOS Accessibility, CoreAudio, CoreHaptics, and IOKit
APIs.

The opt-in Bluetooth microphone experiment implements an observed DualSense
HID/Opus interoperability path. It is isolated behind capability checks,
requires libopus supplied by the user, suspends mappings while duplex reports
are active, and fails back to normal system audio. It does not include Sony
firmware or driver code. Bluetooth speaker playback is not exposed because it
has not been verified reliably.

## Trademarks and support

OpenAI and Codex are trademarks of OpenAI. PlayStation and DualSense are
trademarks or registered trademarks of Sony Interactive Entertainment. This
project is not affiliated with, sponsored by, or endorsed by either company.

Treat internal command or protocol observations as compatibility facts, not as
a promise from OpenAI or Sony. Revalidate them after relevant software,
firmware, controller, or macOS updates.
