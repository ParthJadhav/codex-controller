# DualSense audio protocol probe

This developer-only executable tests the macOS feasibility boundary for proprietary DualSense
Bluetooth audio. Its default mode checks whether an ordinary user-space process can open the
paired controller through `IOHIDManager` and observe raw input reports while Apple’s Game
Controller driver remains attached.

The default mode is intentionally read-only. It sends no reports, seizes no device, installs no
driver, and makes no system changes.

```sh
swift run --package-path native DualSenseAudioProbe 3
```

Explicit developer test modes send time-bounded, low-volume Bluetooth audio reports. They
require `libopus`, accept only a Bluetooth DualSense with the expected report sizes, leave
microphone duplex disabled, and attempt a mute plus automatic-route release before exiting:

```sh
# Valid transport and encoded silence only
swift run --package-path native DualSenseAudioProbe transport-test 0.5 \
  --i-understand-this-writes-to-controller

# A quiet 880 Hz tone, bracketed by silence
swift run --package-path native DualSenseAudioProbe speaker-test 0.75 \
  --i-understand-this-writes-to-controller

# The newer 547-byte, two-Opus-frame container observed in current bridges
swift run --package-path native DualSenseAudioProbe speaker-test-547 0.75 \
  --i-understand-this-writes-to-controller

# Capture/decode the proprietary built-in microphone stream
swift run --package-path native DualSenseAudioProbe microphone-test 0.75 \
  --i-understand-this-writes-to-controller

# Use that microphone as the acoustic sensor for forced speaker routing
swift run --package-path native DualSenseAudioProbe speaker-loopback-forced 2 \
  --i-understand-this-writes-to-controller

# Wired path: select CoreAudio output, route internal speaker, then restore both
swift run --package-path native DualSenseAudioProbe usb-speaker-test 2 \
  --i-understand-this-writes-to-controller

# Hold the internal-only USB microphone route for an external CoreAudio capture
swift run --package-path native DualSenseAudioProbe usb-microphone-test 4 \
  --i-understand-this-writes-to-controller
```

`transport-test` is the safer first write check. A successful `IOHIDDeviceSetReport` result proves
that macOS accepted the proprietary HID output transport; it does not by itself prove that the
controller rendered audio. Loopback modes require an 880 Hz spectral peak in decoded
controller-microphone PCM. The USB mode was independently captured through the MacBook microphone
and produced a 36.40 dB target-to-nearby-bin result, establishing wired acoustic playback on the
tested Mac/controller. With both jack-presence bits false, the USB mic mode captured an external
880 Hz stimulus 26.17 dB above nearby bins through the controller's two-channel input.

The implementation is a clean-room macOS feasibility probe based on independently published
protocol observations. It is not shipped with the app and is not a claim of supported macOS
compatibility. Current result: Bluetooth microphone verified, Bluetooth speaker not detected, USB
built-in speaker verified through standard CoreAudio plus a bounded HID route report.
