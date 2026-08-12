import AudioToolbox
import AppKit
import ApplicationServices
import AVFoundation
import CoreAudio
import Foundation

private final class AudioCaptureCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var peak: Float = 0

    func record(_ buffer: AVAudioPCMBuffer) {
        guard let values = buffer.floatChannelData?[0] else { return }
        lock.lock()
        count += 1
        for index in 0..<Int(buffer.frameLength) {
            peak = max(peak, abs(values[index]))
        }
        lock.unlock()
    }

    var snapshot: (count: Int, peak: Float) {
        lock.lock()
        defer { lock.unlock() }
        return (count, peak)
    }
}

/**
 Reports what the controller's audio hardware is doing, and verifies its
 microphone and speaker routes on request.

 This is what remains of the old `DictationMonitor` after dictation moved to
 Codex. Codex Controller no longer captures speech or holds a transcript; Codex owns
 that entirely now, driven by the Create button holding its dictation shortcut.
 What survives is read-only hardware reporting plus the two DualSense route
 verifications, which describe the controller rather than transcribe anything.
 */
@MainActor
final class ControllerAudioMonitor {
    private var audioEngine = AVAudioEngine()
    private let controllerMicrophone = DualSenseBluetoothMicrophone()
    private let usbControllerMicrophone = DualSenseUSBMicrophone()
    /// Verifying the Bluetooth microphone takes over the controller's HID
    /// reports, so mappings are suspended for the duration and restored after.
    private let onControllerCaptureChanged: (Bool) -> Void
    private var preferExperimentalControllerMicrophone = false
    private var controllerMappingsSuspended = false

    init(onControllerCaptureChanged: @escaping (Bool) -> Void = { _ in }) {
        self.onControllerCaptureChanged = onControllerCaptureChanged
    }

    func configure(_ payload: [String: Any]) {
        preferExperimentalControllerMicrophone =
            (payload["experimentalDualSenseMicrophoneEnabled"] as? Bool) ?? false
    }

    func verifyExperimentalControllerMicrophone() async -> (Bool, String) {
        let capability = DualSenseBluetoothMicrophone.capability()
        guard capability.available else { return (false, capability.reason) }
        // Whatever this run learns about the hardware is newer than the cached
        // answer above, and a failure often means the answer itself changed.
        defer { DualSenseBluetoothMicrophone.invalidateCapabilityCache() }
        var unexpectedFailure: String?
        // Suspended before the capture, not after: `start()` takes the
        // controller's HID reports the instant it succeeds, and a mapping still
        // live in that window fires from reports the verification already owns.
        suspendControllerMappings()
        // A backstop for every exit below. The mid-run restore further down is
        // the one that matters for timing; this one is a no-op after it, and
        // the guarantee that no failure path can leave the controller mute.
        defer { restoreControllerMappings() }
        let result = controllerMicrophone.start(
            onSamples: { _ in },
            onUnexpectedStop: { unexpectedFailure = $0 }
        )
        guard case .success = result else {
            if case .failure(let error) = result {
                return (false, error.localizedDescription)
            }
            return (false, "Controller microphone verification could not start.")
        }
        try? await Task.sleep(for: .milliseconds(750))
        controllerMicrophone.stop()
        try? await Task.sleep(for: .milliseconds(2_000))
        restoreControllerMappings()
        if let unexpectedFailure { return (false, unexpectedFailure) }
        let frames = controllerMicrophone.decodedFrameCount
        let failures = controllerMicrophone.decodeFailureCount
        guard frames > 0, failures == 0 else {
            return (
                false,
                "No decodable controller microphone frames arrived (frames \(frames), failures \(failures))."
            )
        }
        return (
            true,
            "Verified \(frames) decoded DualSense microphone frames with mappings safely suspended."
        )
    }

    func verifyUSBControllerMicrophone() async -> (Bool, String) {
        guard await authorizeMicrophone() else {
            return (false, "Microphone permission is required.")
        }
        let capability = DualSenseUSBMicrophone.capability()
        guard capability.available else { return (false, capability.reason) }
        guard let preferred = Self.inputs().first(where: {
            DualSenseUSBMicrophone.isCompatibleInput(
                name: $0.name,
                transportType: $0.transportType,
                channelCount: $0.channelCount
            )
        }) else {
            return (false, "The wired DualSense CoreAudio input disappeared.")
        }
        stopCapture()
        guard case .success = usbControllerMicrophone.start() else {
            return (false, "The controller rejected the internal-microphone route.")
        }
        defer { usbControllerMicrophone.stop() }
        guard let previous = Self.defaultDeviceID(
            selector: kAudioHardwarePropertyDefaultInputDevice
        ) else {
            return (false, "The current macOS input device could not be read.")
        }
        return await TemporaryDefaultAudioDevice.performAsync(
            route: .input,
            previousDevice: previous,
            temporaryDevice: preferred.id,
            previousDeviceUID: AudioDeviceUID.of(previous),
            selectionFailure: "The wired DualSense CoreAudio input could not be selected.",
            restorationFailure: "macOS could not restore the previous input device.",
            setDefault: {
                Self.setDefaultDevice(
                    $0,
                    selector: kAudioHardwarePropertyDefaultInputDevice
                )
            }
        ) {
            // Disable the controller-side route before the lease restores the
            // system default, including the zero-format early-return path.
            defer { self.usbControllerMicrophone.stop() }
            // A fresh engine binds its input node after the default switch.
            self.audioEngine = AVAudioEngine()
            let input = self.audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                return (false, "The wired DualSense microphone has no usable stream.")
            }
            let counter = AudioCaptureCounter()
            input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
                counter.record(buffer)
            }
            self.audioEngine.prepare()
            do {
                try self.audioEngine.start()
            } catch {
                self.stopCapture()
                return (false, "The wired DualSense microphone could not start.")
            }
            try? await Task.sleep(for: .milliseconds(750))
            self.stopCapture()
            let result = counter.snapshot
            guard result.count > 0 else {
                return (false, "No wired DualSense microphone buffers arrived.")
            }
            return (
                true,
                String(
                    format: "Verified %d wired DualSense microphone buffers (peak %.4f) "
                        + "through the internal-only USB route.",
                    result.count,
                    result.peak
                )
            )
        }
    }

    /// Speech Recognition is deliberately absent: nothing in Codex Controller
    /// transcribes any more, so asking for that permission would be asking for
    /// access it never uses.
    func permissionSnapshot() -> [String: Any] {
        var audio = Self.audioSnapshot()
        let capability = DualSenseBluetoothMicrophone.capability()
        audio["experimentalBuiltInMicrophoneAvailable"] = capability.available
        audio["experimentalBuiltInMicrophoneEnabled"] =
            preferExperimentalControllerMicrophone
        audio["experimentalBuiltInMicrophoneReason"] = capability.reason
        let usbMicrophone = DualSenseUSBMicrophone.capability()
        audio["usbBuiltInMicrophoneAvailable"] = usbMicrophone.available
        audio["usbBuiltInMicrophoneReason"] = usbMicrophone.reason
        audio["builtInMicrophoneSupported"] =
            capability.available || usbMicrophone.available
        let usbSpeaker = DualSenseUSBSpeaker.capability()
        audio["usbBuiltInSpeakerAvailable"] = usbSpeaker.available
        audio["usbBuiltInSpeakerReason"] = usbSpeaker.reason
        audio["builtInSpeakerSupported"] = usbSpeaker.available
        return [
            "platform": "darwin",
            "appVersion": "native",
            "codexRunning": !NSRunningApplication.runningApplications(
                withBundleIdentifier: "com.openai.codex"
            ).isEmpty,
            "accessibilityTrusted": AXIsProcessTrusted(),
            "microphonePermission": Self.microphoneStatus(),
            "inputMonitoringTrusted": CGPreflightListenEventAccess(),
            "audio": audio
        ]
    }

    private func stopCapture() {
        controllerMicrophone.stop()
        usbControllerMicrophone.stop()
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine = AVAudioEngine()
        restoreControllerMappings()
    }

    /// Puts back a default device that a killed verification never gave back.
    ///
    /// Called once at startup, before anything else touches audio: the process
    /// that has to undo the switch is by definition not the one that made it.
    static func restoreBorrowedDefaultDevices() {
        do {
            try DefaultAudioDeviceMarker.shared.restorePending { route, deviceUID in
                guard let id = AudioDeviceUID.deviceID(for: deviceUID) else { return true }
                let selector = route == .input
                    ? kAudioHardwarePropertyDefaultInputDevice
                    : kAudioHardwarePropertyDefaultOutputDevice
                return setDefaultDevice(id, selector: selector) == noErr
            }
        } catch {
            BridgeWriter.shared.error(
                "The previous macOS audio route could not be recovered: "
                    + error.localizedDescription
            )
        }
    }

    /// Drops what is cached about the controller's audio hardware, for when the
    /// set of connected devices has changed underneath it.
    func invalidateDeviceCapabilityCache() {
        DualSenseBluetoothMicrophone.invalidateCapabilityCache()
    }

    private func suspendControllerMappings() {
        guard !controllerMappingsSuspended else { return }
        controllerMappingsSuspended = true
        onControllerCaptureChanged(true)
    }

    private func restoreControllerMappings() {
        guard controllerMappingsSuspended else { return }
        controllerMappingsSuspended = false
        onControllerCaptureChanged(false)
    }

    private func authorizeMicrophone() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        case .denied, .restricted: return false
        @unknown default: return false
        }
    }

    private static func microphoneStatus() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not-determined"
        @unknown default: return "unknown"
        }
    }

    private struct AudioInput {
        let id: AudioDeviceID
        let name: String
        let transportType: UInt32
        let channelCount: UInt32
        let jackConnected: Bool?

        var route: ControllerAudioRoute {
            ControllerAudioRoute(
                name: name,
                transportType: transportType,
                channelCount: channelCount
            )
        }
    }

    private static func audioSnapshot() -> [String: Any] {
        let inputDevices = inputs()
        let outputDevices = outputs()
        var result: [String: Any] = [
            "defaultInputName": defaultDeviceName(
                selector: kAudioHardwarePropertyDefaultInputDevice
            ) ?? "No input device",
            "defaultOutputName": defaultDeviceName(
                selector: kAudioHardwarePropertyDefaultOutputDevice
            ) ?? "No output device",
            "builtInMicrophoneSupported": false,
            "builtInSpeakerSupported": false,
            "controllerAudioKind": "none"
        ]
        if let input = inputDevices.first(where: isWiredDualSenseRoute) {
            result["dualSenseInputName"] = input.name
            result["dualSenseInputTransport"] = transportName(input.transportType)
            result["dualSenseInputChannels"] = input.channelCount
            if let jackConnected = input.jackConnected {
                result["dualSenseInputJackConnected"] = jackConnected
            }
        }
        if let output = outputDevices.first(where: isWiredDualSenseRoute) {
            result["dualSenseOutputName"] = output.name
            result["dualSenseOutputTransport"] = transportName(output.transportType)
            result["dualSenseOutputChannels"] = output.channelCount
            if let jackConnected = output.jackConnected {
                result["dualSenseOutputJackConnected"] = jackConnected
            }
        }
        let kind = ControllerAudioRoutePolicy.controllerAudioKind(
            inputs: inputDevices.map(\.route),
            outputs: outputDevices.map(\.route)
        )
        result["controllerAudioKind"] = kind
        result["builtInSpeakerSupported"] = kind == "usbBuiltIn"
        return result
    }

    private static func inputs() -> [AudioInput] {
        devices(scope: kAudioDevicePropertyScopeInput)
    }

    private static func outputs() -> [AudioInput] {
        devices(scope: kAudioDevicePropertyScopeOutput)
    }

    private static func devices(scope: AudioObjectPropertyScope) -> [AudioInput] {
        AudioDeviceUID.allDeviceIDs().compactMap { id in
            let channelCount = channelCount(id, scope: scope)
            guard channelCount > 0, let name = deviceName(id) else { return nil }
            return AudioInput(
                id: id,
                name: name,
                transportType: transportType(id),
                channelCount: channelCount,
                jackConnected: jackConnected(id, scope: scope)
            )
        }
    }

    private static func channelCount(
        _ id: AudioDeviceID,
        scope: AudioObjectPropertyScope
    ) -> UInt32 {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr,
              size >= MemoryLayout<AudioBufferList>.size else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else {
            return 0
        }
        let buffers = UnsafeMutableAudioBufferListPointer(
            raw.assumingMemoryBound(to: AudioBufferList.self)
        )
        return buffers.reduce(0) { $0 + $1.mNumberChannels }
    }

    private static func transportType(_ id: AudioDeviceID) -> UInt32 {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyTransportType,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value = kAudioDeviceTransportTypeUnknown
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else {
            return kAudioDeviceTransportTypeUnknown
        }
        return value
    }

    private static func transportName(_ value: UInt32) -> String {
        switch value {
        case kAudioDeviceTransportTypeUSB: "USB"
        case kAudioDeviceTransportTypeBluetooth: "Bluetooth"
        case kAudioDeviceTransportTypeBluetoothLE: "Bluetooth LE"
        case kAudioDeviceTransportTypeBuiltIn: "Built-in"
        case kAudioDeviceTransportTypeVirtual: "Virtual"
        default: "Unknown"
        }
    }

    private static func jackConnected(
        _ id: AudioDeviceID,
        scope: AudioObjectPropertyScope
    ) -> Bool? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyJackIsConnected,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(id, &address) else { return nil }
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else {
            return nil
        }
        return value != 0
    }

    private static func isWiredDualSenseRoute(_ device: AudioInput) -> Bool {
        ControllerAudioRoutePolicy.isWiredDualSenseRoute(device.route)
    }

    private static func defaultDeviceName(selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id
        ) == noErr, id != 0 else { return nil }
        return deviceName(id)
    }

    private static func defaultDeviceID(
        selector: AudioObjectPropertySelector
    ) -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id
        ) == noErr, id != 0 else { return nil }
        return id
    }

    private static func setDefaultDevice(
        _ id: AudioDeviceID,
        selector: AudioObjectPropertySelector
    ) -> OSStatus {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var selected = id
        return AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            UInt32(MemoryLayout<AudioDeviceID>.size),
            &selected
        )
    }

    private static func deviceName(_ id: AudioDeviceID) -> String? {
        CoreAudioCopiedProperty.string(
            objectID: id,
            selector: kAudioObjectPropertyName
        )
    }

}
