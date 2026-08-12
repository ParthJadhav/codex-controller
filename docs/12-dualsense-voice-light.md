# DualSense voice and activity light

Status date: 2026-07-24  
Updated 2026-07-26: the voice workflow and light-priority table were rewritten against the shipped
code. Codex Controller's own dictation composer has been removed.

## Voice workflow

Codex Controller no longer recognizes speech or holds a transcript. `SFSpeechRecognizer`, the
`AVAudioEngine` capture path for dictation, and the on-screen editable composer are all gone. Voice
is Codex's, driven from the controller by posting Codex's own commands.

**Push-to-talk (Create).** Two bindings share the Create button: the `holdBegan` half posts Codex's
`composer.startDictation` shortcut (`⌃⇧D`, which Codex ships bound) as a key-down, and the
`holdEnded` half posts the matching key-up. Codex therefore sees one real press held for exactly as
long as the button is held, and records, transcribes, inserts, and keeps the result itself. Both
halves are `focusIfNeeded`, because that command is app-scoped and cannot land otherwise. Codex also
registers an OS-global `globalDictationHold`, but it ships unbound, so it is not what the shipped
profile uses.

**Voice chat (L3 click, plus the L1-hold Voice layer).**

1. **L3 click** posts `composer.startVoiceMode` (`⌃⇧V`, ships bound), which is Codex's own "Toggle
   voice chat" — one shortcut starts and stops a call, so Codex Controller never has to infer call
   state. That matters: a probe of a live call showed the microphone staying open across
   mute/unmute, so mute state is not observable from outside and guessing it could mean
   broadcasting while believing otherwise.
2. **Holding L1** shifts to the `voice` layer for as long as it is held. L1's tap (`⇧⇥`) is
   unaffected.
3. On that layer, Cross mutes/unmutes the microphone (`realtimeVoice.toggleMicrophoneMute`, `⌃⇧U`),
   Circle ends the call (`realtimeVoice.endCall`, `⌃⇧E`), Triangle mutes/unmutes output
   (`realtimeVoice.toggleOutputMute`, `⌃⇧O`), and Square opens the voice control window
   (`openControlWindow`, `⌃⇧C`).
4. All four ship **unbound** in Codex and are `app`-scoped. They do nothing until the user binds
   them — by hand with `⌘/`, or through Codex Controller's explicit offer to write them into
   `~/.codex/keybindings.json` — and they focus Codex first, because an app-scoped command cannot
   land otherwise.

**L2 is not a voice control.** It posts Escape to stop the active task; Codex registers no distinct
stop command.

Microphone permission is therefore needed only for the DualSense audio verification paths described
next — never for dictation.

The native layer enumerates CoreAudio devices and records device name, channel count, transport,
and jack state when the driver provides it. The tested wired controller exposes a two-channel
input and four-channel output on macOS 27. With HID reporting both headphone/headset-microphone
jack bits false, forcing the internal-only mic route captured an 880 Hz stimulus 26.17 dB above
nearby bins. FL/FR PCM plus an internal-speaker HID route produced an independently captured
880 Hz tone 36.40 dB above nearby bins. Settings therefore offers an explicit one-second wired
speaker test and restores the preceding macOS output afterward.

Bluetooth exposes no CoreAudio device. Its proprietary `0x31` microphone frames were nevertheless
captured and decoded as 48 kHz mono Opus, so the app offers that path as an opt-in experiment. It
suspends native and renderer controller mappings while microphone duplex is active, drains late
frames before restoration, and falls back to system audio on setup or runtime failure.

Microphone permission is separate from Input Monitoring and Accessibility, and the app links to the
appropriate privacy settings. Speech Recognition is never requested; no code path uses macOS Speech.

Codex Controller posts keys into the Codex desktop app; it does not own the Codex session or
receive an assistant reply audio stream. Assistant responses therefore remain on the current
macOS system output. Settings and Diagnostics distinguish the normal system routes, experimental
Bluetooth microphone, verified wired built-in microphone/speaker, and still-unverified Bluetooth
speaker.

## Touchpad pointer

Apple’s Game Controller framework exposes both DualSense finger locations. Codex Controller
uses the primary touch location for relative macOS pointer movement and the physical touchpad
button for a primary click.

- Pointer mode is adjustable per profile and includes a speed control.
- Existing profiles with a touchpad mapping migrate with pointer mode off; other profiles gain the
  pointer without losing any mappings.
- While pointer mode is ready, the touchpad click belongs to pointer control. Turning it off
  restores normal mapped touchpad gestures.
- Pointer events require Accessibility. Without it, mapping dispatch remains available and the UI
  reports the exact recovery action.
- New touch sequences reset their baseline, implausible jumps are rejected, coordinates are
  clamped across active displays, and disconnect/disable releases a held primary button.

## Controller light priority

The app treats the DualSense light as a compact state channel. Only one color is shown, selected by
priority. The order below is `dominantLightStatus` in
[`src/renderer/src/core/lightStatus.ts`](../src/renderer/src/core/lightStatus.ts), and the colors are
that file's `lightColors`:

| Priority | State                                       | Color               |
| -------- | ------------------------------------------- | ------------------- |
| 1        | Transient dispatch result — success         | Green `#45d487`     |
| 1        | Transient dispatch result — failure         | Red `#f0525d`       |
| 3        | Action dispatch in flight                   | Cyan `#21c7e8`      |
| 4        | Needs attention — controller disconnected   | Amber `#f4a72f`     |
| 5        | Codex running and mappings enabled          | Blue `#4f76ff`      |
| 6        | Idle or unsupported light                   | Cool gray `#61708a` |

Three things this corrects about the previous table: success and failure share **one** top-priority
slot, because they are the same transient result and both outrank everything else; action dispatch
outranks attention rather than the reverse; and amber means only that the controller is
disconnected — there is no "mappings paused" input to the decision.

Priority 2 is deliberately vacant. It used to be a purple `voice` state whose only input was
`isListening`, and the renderer passed a hard-coded `false` — dictation is Codex's now, so Codex
Controller has no listening state of its own to report. The status was removed from
`controllerLightStatuses` and `lightColors` rather than leaving a colour the light could never show;
the remaining rungs keep their numbers for compatibility.

A transient success or failure clears after 1.2 seconds, at which point the light falls back to the
highest-priority persistent state. The same state and color appear in the sidebar's light-status
readout, which carries an accessible label rather than relying on the color alone.

The companion can observe the actions it dispatches, controller availability, and whether Codex is
running. It cannot observe a Codex voice call or dictation session, and does not claim access to
private desktop Codex task state; deeper live-task feedback still requires an app-server session
owned by this process.
