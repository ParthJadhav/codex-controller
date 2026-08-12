# DualSense audio boundary

DualSense audio support in Codex Controller is optional and isolated from
normal controller mappings.

- Wired USB microphone and bounded speaker checks use macOS CoreAudio plus a
  narrowly scoped controller route. The app restores the prior system device.
- Bluetooth exposes no standard CoreAudio device. The experimental microphone
  path is capability-gated, requires a user-supplied compatible `libopus`, and
  suspends mappings while proprietary duplex reports are active.
- Bluetooth speaker playback is not exposed because it has not been verified
  reliably.
- Every audio check is initiated by the user. Samples are analyzed in memory
  and discarded; the app does not create recordings or transcripts.

These are interoperability observations, not a compatibility promise from
Sony or Apple. See [INTEROPERABILITY.md](INTEROPERABILITY.md) for the broader
project boundary.
