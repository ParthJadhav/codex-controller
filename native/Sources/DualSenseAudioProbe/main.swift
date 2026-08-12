import AudioToolbox
import AVFoundation
import CoreAudio
import CoreFoundation
import COpusShim
import Foundation
import IOKit.hid

private let sonyVendorID = 0x054c
private let dualSenseProductIDs = [0x0ce6, 0x0df2]
private let writeAcknowledgement = "--i-understand-this-writes-to-controller"
private let stateAcknowledgementMarker: UInt32 = 0xc0de_c0de

private enum Mode: String {
    case inspect
    case transportTest = "transport-test"
    case speakerTest = "speaker-test"
    case speakerTest547 = "speaker-test-547"
    case speakerTestState = "speaker-test-state"
    case speakerTestAuto = "speaker-test-auto"
    case speakerTestPCM = "speaker-test-pcm"
    case microphoneTest = "microphone-test"
    case speakerLoopbackAuto = "speaker-loopback-auto"
    case speakerLoopbackForced = "speaker-loopback-forced"
    case usbSpeakerTest = "usb-speaker-test"
    case usbMicrophoneTest = "usb-microphone-test"

    var writesToController: Bool {
        self != .inspect
    }

    var isolatesInput: Bool {
        self == .microphoneTest
            || self == .speakerLoopbackAuto
            || self == .speakerLoopbackForced
    }
}

private struct Options {
    let mode: Mode
    let listenSeconds: Double
    let acknowledgedWrite: Bool

    static func parse() -> Options? {
        var arguments = Array(CommandLine.arguments.dropFirst())
        let acknowledgedWrite = arguments.contains(writeAcknowledgement)
        arguments.removeAll { $0 == writeAcknowledgement }

        let mode: Mode
        if let first = arguments.first, let parsedMode = Mode(rawValue: first) {
            mode = parsedMode
            arguments.removeFirst()
        } else {
            mode = .inspect
        }

        let defaultSeconds = mode == .inspect ? 2.0 : 0.75
        let listenSeconds = arguments.first.flatMap(Double.init) ?? defaultSeconds
        guard arguments.count <= 1, listenSeconds > 0, listenSeconds <= 30 else {
            return nil
        }
        return Options(
            mode: mode,
            listenSeconds: listenSeconds,
            acknowledgedWrite: acknowledgedWrite
        )
    }
}

private func usage() {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).lastPathComponent
    fputs(
        """
        usage:
          \(executable) [inspect] [listen-seconds]
          \(executable) transport-test [listen-seconds] \(writeAcknowledgement)
          \(executable) speaker-test [listen-seconds] \(writeAcknowledgement)
          \(executable) speaker-test-547 [listen-seconds] \(writeAcknowledgement)
          \(executable) speaker-test-state [listen-seconds] \(writeAcknowledgement)
          \(executable) speaker-test-auto [listen-seconds] \(writeAcknowledgement)
          \(executable) speaker-test-pcm [listen-seconds] \(writeAcknowledgement)
          \(executable) microphone-test [listen-seconds] \(writeAcknowledgement)
          \(executable) speaker-loopback-auto [listen-seconds] \(writeAcknowledgement)
          \(executable) speaker-loopback-forced [listen-seconds] \(writeAcknowledgement)
          \(executable) usb-speaker-test [listen-seconds] \(writeAcknowledgement)
          \(executable) usb-microphone-test [listen-seconds] \(writeAcknowledgement)

        inspect is read-only. transport-test sends valid speaker setup, encoded silence,
        and a release report. speaker-test replaces the middle report-0x36 frames with a
        quiet 880 Hz tone; speaker-test-547 tests the newer two-frame report-0x39 layout.
        speaker-test-state precedes 0x39 with explicit audio state/config subreports.
        speaker-test-auto also preserves Sony's automatic output route and continuous
        report sequence/counter state.
        speaker-test-pcm tests the older 6 kHz signed-mono report-0x32/PID-0x12 path.
        microphone-test temporarily seizes controller input, captures and decodes the
        proprietary microphone stream, then restores microphone-off state.
        speaker-loopback-auto and speaker-loopback-forced additionally send an 880 Hz
        Opus signal to the built-in-speaker PID while using the controller's verified
        microphone as an acoustic sensor. Success requires spectral evidence in captured
        microphone PCM; accepted HID writes alone are reported but never count.
        usb-speaker-test requires a data-capable USB connection. It temporarily selects
        the enumerated DualSense CoreAudio output, routes FL/FR to the internal membrane
        with a bounded HID state report, plays a tone, and restores the previous system
        output and controller route before returning.
        usb-microphone-test holds the internal-microphone HID route while an external
        CoreAudio capture harness records the enumerated two-channel USB input.
        Write modes are opt-in, Bluetooth-only, bounded to 0.25...2 seconds, and
        always attempt to mute/release the controller audio path before exiting.
        """,
        stderr
    )
}

private func integerProperty(_ device: IOHIDDevice, _ key: String) -> Int? {
    (IOHIDDeviceGetProperty(device, key as CFString) as? NSNumber)?.intValue
}

private func stringProperty(_ device: IOHIDDevice, _ key: String) -> String? {
    IOHIDDeviceGetProperty(device, key as CFString) as? String
}

private func hex(_ value: IOReturn) -> String {
    String(format: "0x%08x", UInt32(bitPattern: value))
}

private final class ProbeContext {
    private let lock = NSLock()
    private(set) var reportCount = 0
    private(set) var reportIDs: [Int: Int] = [:]
    private(set) var firstReportPrefix: String?
    private(set) var possibleMicrophonePrefixes: [String] = []
    private(set) var sawStateAcknowledgement = false
    private(set) var microphoneFrames: [[UInt8]] = []
    private(set) var usbHeadphonesPlugged: Bool?
    private(set) var usbMicrophonePlugged: Bool?

    func receive(reportID: UInt32, report: UnsafeMutablePointer<UInt8>, length: CFIndex) {
        lock.lock()
        defer { lock.unlock() }

        reportCount += 1
        reportIDs[Int(reportID), default: 0] += 1
        let count = min(Int(length), 16)
        let prefix = UnsafeBufferPointer(start: report, count: count)
            .map { String(format: "%02x", $0) }
            .joined(separator: " ")
        if firstReportPrefix == nil {
            firstReportPrefix = prefix
        }
        // Bluetooth 0x31 has a one-byte flags field before the 63-byte common
        // state. The controller mirrors output HostTimestamp (common offset 43)
        // into input, giving an automatic device-side acknowledgement.
        if reportID == 0x31, length >= 49 {
            let value = UInt32(report[45])
                | (UInt32(report[46]) << 8)
                | (UInt32(report[47]) << 16)
                | (UInt32(report[48]) << 24)
            if value == stateAcknowledgementMarker {
                sawStateAcknowledgement = true
            }
        }

        // Known implementations see a 0xd4 Opus TOC near the beginning of the
        // 0x31 input report while microphone duplex is active. This probe does
        // not enable duplex, but records the marker if another process does.
        if reportID == 0x31, count >= 6, (2..<6).contains(where: { report[$0] == 0xd4 }),
           possibleMicrophonePrefixes.count < 4 {
            possibleMicrophonePrefixes.append(prefix)
        }
        if reportID == 0x31, length == 78, report[1] & 0x02 != 0,
           report[3] == 0xd4, microphoneFrames.count < 512 {
            microphoneFrames.append(Array(UnsafeBufferPointer(start: report + 3, count: 71)))
        }
        if reportID == 0x01, length >= 55 {
            usbHeadphonesPlugged = report[54] & 0x01 != 0
            usbMicrophonePlugged = report[54] & 0x02 != 0
        }
    }
}

private let inputReportCallback: IOHIDReportCallback = {
    context, result, _, _, reportID, report, reportLength in
    guard result == kIOReturnSuccess, let context else { return }
    Unmanaged<ProbeContext>.fromOpaque(context)
        .takeUnretainedValue()
        .receive(reportID: reportID, report: report, length: reportLength)
}

private func matchingDictionaries() -> [[String: Any]] {
    dualSenseProductIDs.map {
        [
            kIOHIDVendorIDKey: sonyVendorID,
            kIOHIDProductIDKey: $0
        ]
    }
}

private func sonyCRC32(_ bytes: ArraySlice<UInt8>) -> UInt32 {
    var crc = UInt32.max
    for byte in CollectionOfOne(UInt8(0xa2)) + bytes {
        crc ^= UInt32(byte)
        for _ in 0..<8 {
            let mask = UInt32(bitPattern: -Int32(crc & 1))
            crc = (crc >> 1) ^ (0xedb88320 & mask)
        }
    }
    return crc ^ UInt32.max
}

private func writeCRC(_ report: inout [UInt8]) {
    let crcOffset = report.count - 4
    let crc = sonyCRC32(report[..<crcOffset])
    report[crcOffset] = UInt8(truncatingIfNeeded: crc)
    report[crcOffset + 1] = UInt8(truncatingIfNeeded: crc >> 8)
    report[crcOffset + 2] = UInt8(truncatingIfNeeded: crc >> 16)
    report[crcOffset + 3] = UInt8(truncatingIfNeeded: crc >> 24)
}

private func speakerRouteReport(
    path: UInt8,
    volume: UInt8,
    preGain: UInt8 = 0
) -> [UInt8] {
    var report = [UInt8](repeating: 0, count: 78)
    report[0] = 0x31
    report[1] = 0x10
    let common = 3
    report[common] = 0xa0 // speaker-volume and audio-control valid
    report[common + 1] = 0x80 // audio-control-2 valid
    report[common + 5] = min(max(volume, 0x3d), 0x64)
    report[common + 7] = path
    report[common + 37] = min(preGain, 0x07)
    writeCRC(&report)
    return report
}

private let mutedStateSnapshot: [UInt8] = [
    0xfd, 0xe3, 0x00, 0x00, 0x7f, 0x64,
    0x00, 0x09, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a,
    0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
    0xff,
] + [UInt8](repeating: 0, count: 16)

private func audioReport(sequence: UInt8, counter: UInt8, opusFrame: [UInt8]) -> [UInt8] {
    precondition(opusFrame.count <= 200)
    precondition(mutedStateSnapshot.count == 63)
    var report = [UInt8](repeating: 0, count: 398)
    report[0] = 0x36
    report[1] = (sequence & 0x0f) << 4

    report[2] = 0x91
    report[3] = 7
    report[4] = 0xfe // speaker/haptics, microphone duplex explicitly disabled
    for index in 5...9 {
        report[index] = 64
    }
    report[10] = counter

    report[11] = 0x90
    report[12] = 63
    report.replaceSubrange(13..<76, with: mutedStateSnapshot)

    report[76] = 0x92
    report[77] = 64

    report[142] = 0x93 // built-in membrane speaker (0x96 is headset jack)
    report[143] = 200
    report.replaceSubrange(144..<(144 + opusFrame.count), with: opusFrame)
    writeCRC(&report)
    return report
}

private func audioReport547(
    sequence: UInt8,
    counter: UInt8,
    firstOpusFrame: [UInt8],
    secondOpusFrame: [UInt8],
    microphoneEnabled: Bool = false
) -> [UInt8] {
    precondition(firstOpusFrame.count == 200)
    precondition(secondOpusFrame.count == 200)
    var report = [UInt8](repeating: 0, count: 547)
    report[0] = 0x39
    report[1] = (sequence & 0x0f) << 4

    report[2] = 0x91
    report[3] = 6
    report[4] = microphoneEnabled ? 0x7f : 0x7e
    for index in 5...8 {
        report[index] = 64
    }
    report[9] = counter

    report[10] = 0xd2 // two 64-byte haptics frames
    report[11] = 64

    report[140] = 0xd3 // two 200-byte built-in speaker Opus frames
    report[141] = 200
    report.replaceSubrange(142..<342, with: firstOpusFrame)
    report.replaceSubrange(342..<542, with: secondOpusFrame)
    writeCRC(&report)
    return report
}

private func stateReport142(path: UInt8, volume: UInt8) -> [UInt8] {
    var report = [UInt8](repeating: 0, count: 142)
    report[0] = 0x32
    report[1] = 0x10
    report[2] = 0x90
    report[3] = 0x3f
    let state = 4
    report[state] = 0xa0 // speaker-volume and audio-control valid
    report[state + 1] = 0x80 // audio-control-2 valid
    report[state + 5] = volume
    report[state + 7] = path
    report[state + 32] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker)
    report[state + 33] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker >> 8)
    report[state + 34] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker >> 16)
    report[state + 35] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker >> 24)
    report[state + 37] = 0
    writeCRC(&report)
    return report
}

private func audioConfigReport142(microphoneEnabled: Bool) -> [UInt8] {
    var report = [UInt8](repeating: 0, count: 142)
    report[0] = 0x32
    report[1] = 0x20
    report[2] = 0x91
    report[3] = 1
    report[4] = microphoneEnabled ? 0x03 : 0x02
    writeCRC(&report)
    return report
}

private func microphoneStateReport142(enabled: Bool) -> [UInt8] {
    var report = [UInt8](repeating: 0, count: 142)
    report[0] = 0x32
    report[1] = 0x10
    report[2] = 0x90
    report[3] = 0x3f
    let state = 4
    report[state] = 0xc0 // microphone-volume and audio-control valid
    report[state + 1] = 0x02 // audio-mute state valid
    report[state + 6] = enabled ? 0x40 : 0x00
    report[state + 7] = enabled ? 0x01 : 0x00 // internal mic only / automatic
    report[state + 9] = enabled ? 0x00 : 0x10 // microphone mute on cleanup
    writeCRC(&report)
    return report
}

private func duplexStateReport142(path: UInt8, volume: UInt8) -> [UInt8] {
    var report = [UInt8](repeating: 0, count: 142)
    report[0] = 0x32
    report[1] = 0x10
    report[2] = 0x90
    report[3] = 0x3f
    let state = 4
    report[state] = 0xe0 // speaker volume, microphone volume, and audio control valid
    report[state + 1] = 0x83 // mute LED, mute/power state, and audio-control-2 valid
    report[state + 5] = volume
    report[state + 6] = 0x08
    report[state + 7] = path | 0x09 // requested route, internal mic, noise cancellation
    report[state + 9] = 0x00 // microphone unmuted
    report[state + 32] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker)
    report[state + 33] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker >> 8)
    report[state + 34] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker >> 16)
    report[state + 35] = UInt8(truncatingIfNeeded: stateAcknowledgementMarker >> 24)
    report[state + 37] = 0x02 // compensation pre-gain used by working implementations
    writeCRC(&report)
    return report
}

private func pcmAudioReport142(sequence: UInt8, counter: UInt8, samples: [UInt8]) -> [UInt8] {
    precondition(samples.count == 64)
    var report = [UInt8](repeating: 0, count: 142)
    report[0] = 0x32
    report[1] = (sequence & 0x0f) << 4
    report[2] = 0x91
    report[3] = 7
    report[4] = 0xfe
    report[5] = 0
    report[6] = 0
    report[7] = 0
    report[8] = 0
    report[9] = 0xff
    report[10] = counter
    report[11] = 0x92 // PID 0x12, sized
    report[12] = 64
    report.replaceSubrange(13..<77, with: samples)
    writeCRC(&report)
    return report
}

private final class OpusEncoder {
    private let encoder: OpaquePointer

    init?() {
        var error: Int32 = 0
        guard let created = ds_opus_encoder_create(&error), error == 0 else {
            fputs(
                "error: libopus unavailable or rejected required CBR settings (\(error)); "
                    + "install Opus (for example: brew install opus)\n",
                stderr
            )
            return nil
        }
        encoder = created
    }

    deinit {
        ds_opus_encoder_destroy(encoder)
    }

    func encode(samples: [Int16]) -> [UInt8]? {
        guard samples.count == 960 else { return nil }
        var output = [UInt8](repeating: 0, count: 200)
        let count = samples.withUnsafeBufferPointer { input in
            output.withUnsafeMutableBufferPointer { destination in
                ds_opus_encode(encoder, input.baseAddress, 480, destination.baseAddress, 200)
            }
        }
        guard count == 200 else {
            fputs("error: expected a 200-byte Opus CBR frame, got \(count)\n", stderr)
            return nil
        }
        return output
    }
}

private final class OpusDecoder {
    private let decoder: OpaquePointer

    init?() {
        var error: Int32 = 0
        guard let created = ds_opus_decoder_create(&error), error == 0 else {
            fputs("error: could not create Opus microphone decoder (\(error))\n", stderr)
            return nil
        }
        decoder = created
    }

    deinit {
        ds_opus_decoder_destroy(decoder)
    }

    func decode(frame: [UInt8]) -> [Int16]? {
        var output = [Int16](repeating: 0, count: 480)
        let count = frame.withUnsafeBufferPointer { input in
            output.withUnsafeMutableBufferPointer { samples in
                ds_opus_decode(
                    decoder,
                    input.baseAddress,
                    Int32(input.count),
                    samples.baseAddress,
                    Int32(samples.count)
                )
            }
        }
        guard count > 0 else { return nil }
        return Array(output.prefix(Int(count)))
    }
}

private func pcmFrame(
    tone: Bool,
    frameIndex: Int,
    amplitude: Double = 2_500
) -> [Int16] {
    return (0..<480).flatMap { sample -> [Int16] in
        let absoluteSample = frameIndex * 480 + sample
        let value = tone
            ? Int16((sin(2 * .pi * 880 * Double(absoluteSample) / 48_000) * amplitude).rounded())
            : 0
        return [value, value]
    }
}

private func sendOutputReport(_ report: [UInt8], to device: IOHIDDevice) -> IOReturn {
    report.withUnsafeBytes { bytes in
        IOHIDDeviceSetReport(
            device,
            kIOHIDReportTypeOutput,
            CFIndex(report[0]),
            bytes.bindMemory(to: UInt8.self).baseAddress!,
            report.count
        )
    }
}

private func usbSpeakerStateReport(enabled: Bool) -> [UInt8] {
    var report = [UInt8](repeating: 0, count: 48)
    report[0] = 0x02
    let state = 1
    report[state] = 0xa0 // speaker-volume and audio-control valid
    report[state + 1] = 0x80 // audio-control-2 valid
    report[state + 5] = enabled ? 0x64 : 0x3d
    report[state + 7] = enabled ? 0x30 : 0x00
    report[state + 37] = enabled ? 0x02 : 0x00
    return report
}

private func usbMicrophoneStateReport(enabled: Bool) -> [UInt8] {
    var report = [UInt8](repeating: 0, count: 48)
    report[0] = 0x02
    let state = 1
    report[state] = 0xc0 // microphone-volume and audio-control valid
    report[state + 1] = 0x83 // mute LED, power/mute state, and audio-control-2 valid
    report[state + 6] = enabled ? 0x40 : 0
    report[state + 7] = enabled ? 0x01 : 0 // internal microphone only
    report[state + 9] = enabled ? 0 : 0x10 // mic power-save/mute on release
    return report
}

private func coreAudioDeviceName(_ id: AudioDeviceID) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioObjectPropertyName,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var name: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &name) == noErr else {
        return nil
    }
    // kAudioObjectPropertyName returns a caller-owned CFString.
    return name?.takeRetainedValue() as String?
}

private func coreAudioOutputChannelCount(_ id: AudioDeviceID) -> UInt32 {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamConfiguration,
        mScope: kAudioDevicePropertyScopeOutput,
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
    return UnsafeMutableAudioBufferListPointer(
        raw.assumingMemoryBound(to: AudioBufferList.self)
    ).reduce(0) { $0 + $1.mNumberChannels }
}

private func coreAudioDevices() -> [AudioDeviceID] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size
    ) == noErr else { return [] }
    var ids = Array(
        repeating: AudioDeviceID(0),
        count: Int(size) / MemoryLayout<AudioDeviceID>.size
    )
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids
    ) == noErr else { return [] }
    return ids
}

private func defaultCoreAudioDevice(
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

private func setDefaultCoreAudioDevice(
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

private func makeUSBTestTone(seconds: Double) throws -> URL {
    let duration = min(max(seconds, 0.5), 3)
    let sampleRate: UInt32 = 48_000
    let channelCount: UInt16 = 4
    let bitsPerSample: UInt16 = 16
    let frameCount = Int(duration * Double(sampleRate))
    let dataByteCount = UInt32(frameCount * Int(channelCount) * 2)
    var data = Data()

    func appendASCII(_ value: String) {
        data.append(contentsOf: value.utf8)
    }
    func appendLE<T: FixedWidthInteger>(_ value: T) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }

    appendASCII("RIFF")
    appendLE(UInt32(36) + dataByteCount)
    appendASCII("WAVE")
    appendASCII("fmt ")
    appendLE(UInt32(16))
    appendLE(UInt16(1))
    appendLE(channelCount)
    appendLE(sampleRate)
    appendLE(sampleRate * UInt32(channelCount) * UInt32(bitsPerSample / 8))
    appendLE(channelCount * bitsPerSample / 8)
    appendLE(bitsPerSample)
    appendASCII("data")
    appendLE(dataByteCount)

    for index in 0..<frameCount {
        let envelope = min(1, min(Double(index) / 2_400, Double(frameCount - 1 - index) / 2_400))
        let value = Int16(
            (sin(2 * .pi * 880 * Double(index) / Double(sampleRate))
                * 0.18 * Double(Int16.max) * envelope).rounded()
        )
        appendLE(UInt16(bitPattern: value))
        appendLE(UInt16(bitPattern: value))
        appendLE(UInt16(0))
        appendLE(UInt16(0))
    }

    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("dualsense-usb-speaker-\(UUID().uuidString).wav")
    try data.write(to: url, options: .atomic)
    return url
}

private func runUSBSpeakerTest(
    seconds: Double,
    device: IOHIDDevice
) -> Bool {
    guard let dualSenseOutput = coreAudioDevices().first(where: {
        coreAudioOutputChannelCount($0) >= 4
            && (coreAudioDeviceName($0)?.localizedCaseInsensitiveContains("DualSense") == true)
    }) else {
        fputs("error: no four-channel DualSense CoreAudio USB output is enumerated\n", stderr)
        return false
    }
    guard let previousOutput = defaultCoreAudioDevice(
        selector: kAudioHardwarePropertyDefaultOutputDevice
    ) else {
        fputs("error: could not read the current CoreAudio output\n", stderr)
        return false
    }
    let routeResult = sendOutputReport(usbSpeakerStateReport(enabled: true), to: device)
    let selectResult = setDefaultCoreAudioDevice(
        dualSenseOutput,
        selector: kAudioHardwarePropertyDefaultOutputDevice
    )
    print(
        "usbSpeakerRoute=\(hex(routeResult)) coreAudioSelect=\(selectResult) "
            + "output=\(coreAudioDeviceName(dualSenseOutput) ?? "unknown") "
            + "channels=\(coreAudioOutputChannelCount(dualSenseOutput))"
    )
    guard routeResult == kIOReturnSuccess, selectResult == noErr else { return false }

    defer {
        let restoreResult = setDefaultCoreAudioDevice(
            previousOutput,
            selector: kAudioHardwarePropertyDefaultOutputDevice
        )
        let releaseResult = sendOutputReport(usbSpeakerStateReport(enabled: false), to: device)
        print(
            "coreAudioRestore=\(restoreResult) restoredOutput="
                + "\(coreAudioDeviceName(previousOutput) ?? "unknown") "
                + "usbSpeakerRelease=\(hex(releaseResult))"
        )
    }

    do {
        let toneURL = try makeUSBTestTone(seconds: seconds)
        defer { try? FileManager.default.removeItem(at: toneURL) }
        let player = Process()
        player.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
        player.arguments = [toneURL.path]
        try player.run()
        while player.isRunning {
            let keepAlive = sendOutputReport(usbSpeakerStateReport(enabled: true), to: device)
            guard keepAlive == kIOReturnSuccess else {
                player.terminate()
                return false
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        player.waitUntilExit()
        print("coreAudioPlaybackExit=\(player.terminationStatus)")
        return player.terminationStatus == 0
    } catch {
        fputs("error: USB CoreAudio playback failed: \(error)\n", stderr)
        return false
    }
}

private func runUSBMicrophoneTest(seconds: Double, device: IOHIDDevice) -> Bool {
    let duration = min(max(seconds, 0.5), 5)
    let first = sendOutputReport(usbMicrophoneStateReport(enabled: true), to: device)
    print("usbMicrophoneRoute=\(hex(first)) selection=internal-only")
    guard first == kIOReturnSuccess else { return false }
    defer {
        let release = sendOutputReport(usbMicrophoneStateReport(enabled: false), to: device)
        print("usbMicrophoneRelease=\(hex(release))")
    }
    let deadline = Date().addingTimeInterval(duration)
    var writes = 1
    while Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
        let result = sendOutputReport(usbMicrophoneStateReport(enabled: true), to: device)
        guard result == kIOReturnSuccess else { return false }
        writes += 1
    }
    print("usbMicrophoneKeepAlives=\(writes)")
    return true
}

private func runPCMTest(seconds: Double, device: IOHIDDevice) -> Bool {
    let duration = min(max(seconds, 0.25), 2.0)
    let setupVolume: UInt8 = 0x52
    let stateResult = sendOutputReport(
        stateReport142(path: 0x00, volume: setupVolume),
        to: device
    )
    let setupResult = sendOutputReport(
        speakerRouteReport(path: 0x00, volume: setupVolume),
        to: device
    )
    print("audioState=\(hex(stateResult)) speakerSetup=\(hex(setupResult))")
    guard stateResult == kIOReturnSuccess, setupResult == kIOReturnSuccess else {
        return false
    }
    Thread.sleep(forTimeInterval: 0.05)

    defer {
        let silence = [UInt8](repeating: 0, count: 64)
        let muteResult = sendOutputReport(
            pcmAudioReport142(sequence: 0, counter: 0, samples: silence),
            to: device
        )
        let releaseResult = sendOutputReport(
            speakerRouteReport(path: 0x00, volume: 0x3d),
            to: device
        )
        print("finalMute=\(hex(muteResult)) speakerRelease=\(hex(releaseResult))")
    }

    let reportCount = max(48, Int((duration * 6_000 / 64).rounded()))
    var sequence: UInt8 = 2
    var counter: UInt8 = 0
    let start = ContinuousClock.now
    var successfulReports = 0

    for reportIndex in 0..<reportCount {
        let tone = reportIndex >= 24 && reportIndex < reportCount - 12
        var samples = [UInt8]()
        samples.reserveCapacity(64)
        for sample in 0..<64 {
            guard tone else {
                samples.append(0)
                continue
            }
            let absoluteSample = reportIndex * 64 + sample
            let phase = 2.0 * Double.pi * 880.0 * Double(absoluteSample) / 6_000.0
            let amplitude = (sin(phase) * 24.0).rounded()
            samples.append(UInt8(bitPattern: Int8(amplitude)))
        }
        let result = sendOutputReport(
            pcmAudioReport142(sequence: sequence, counter: counter, samples: samples),
            to: device
        )
        if result != kIOReturnSuccess {
            print("pcmReport[\(reportIndex)]=\(hex(result))")
            return false
        }
        successfulReports += 1
        sequence = (sequence + 1) & 0x0f
        counter &+= 1

        let target = start + .nanoseconds(Int64(reportIndex + 1) * 10_666_667)
        let remaining = ContinuousClock.now.duration(to: target)
        if remaining > .zero {
            Thread.sleep(
                forTimeInterval: Double(remaining.components.attoseconds) / 1e18
                    + Double(remaining.components.seconds)
            )
        }
    }
    print(
        "audioFrames=\(successfulReports)/\(reportCount) "
            + "payload=report-0x32/142-byte signed-mono-6kHz microphoneDuplex=disabled"
    )
    return successfulReports == reportCount
}

private func spectralPower(
    samples: [Int16],
    frequency: Double,
    sampleRate: Double = 48_000
) -> Double {
    guard !samples.isEmpty else { return 0 }
    let mean = samples.reduce(0.0) { $0 + Double($1) } / Double(samples.count)
    var real = 0.0
    var imaginary = 0.0
    for (index, sample) in samples.enumerated() {
        let centered = Double(sample) - mean
        let angle = 2 * Double.pi * frequency * Double(index) / sampleRate
        real += centered * cos(angle)
        imaginary -= centered * sin(angle)
    }
    let scale = Double(samples.count * samples.count)
    return (real * real + imaginary * imaginary) / scale
}

private func runMicrophoneTest(
    mode: Mode,
    seconds: Double,
    device: IOHIDDevice,
    context: ProbeContext
) -> Bool {
    let duration = min(max(seconds, 0.25), 2.0)
    let isLoopback = mode == .speakerLoopbackAuto || mode == .speakerLoopbackForced
    let route: UInt8 = mode == .speakerLoopbackForced ? 0x30 : 0x00
    let volume: UInt8 = isLoopback ? 0x64 : 0x3d
    guard let opus = OpusEncoder(), let decoder = OpusDecoder(),
          let silence = opus.encode(samples: pcmFrame(tone: false, frameIndex: 0)) else {
        return false
    }

    let routeResult = isLoopback
        ? sendOutputReport(
            speakerRouteReport(path: route, volume: volume, preGain: 0x02),
            to: device
        )
        : kIOReturnSuccess
    let stateReport = isLoopback
        ? duplexStateReport142(path: route, volume: volume)
        : microphoneStateReport142(enabled: true)
    let stateResult = sendOutputReport(stateReport, to: device)
    let configResult = sendOutputReport(
        audioConfigReport142(microphoneEnabled: true),
        to: device
    )
    print(
        "inputIsolation=exclusive-IOHIDManager "
            + "microphoneState=\(hex(stateResult)) microphoneConfig=\(hex(configResult)) "
            + "speakerRoute=\(hex(routeResult)) route="
            + (route == 0x30 ? "forced-internal" : "automatic")
    )
    guard stateResult == kIOReturnSuccess,
          configResult == kIOReturnSuccess,
          routeResult == kIOReturnSuccess else {
        return false
    }

    defer {
        let muteStream = audioReport547(
            sequence: 0,
            counter: 0,
            firstOpusFrame: silence,
            secondOpusFrame: silence,
            microphoneEnabled: false
        )
        let streamResult = sendOutputReport(muteStream, to: device)
        let configOff = sendOutputReport(
            audioConfigReport142(microphoneEnabled: false),
            to: device
        )
        let stateOff = sendOutputReport(microphoneStateReport142(enabled: false), to: device)
        let routeOff = isLoopback
            ? sendOutputReport(speakerRouteReport(path: 0x00, volume: 0x3d), to: device)
            : kIOReturnSuccess
        print(
            "microphoneCleanup=stream:\(hex(streamResult)),"
                + "config:\(hex(configOff)),state:\(hex(stateOff)),route:\(hex(routeOff))"
        )
    }

    Thread.sleep(forTimeInterval: 0.05)
    let reportCount = max(12, Int((duration * 48_000 / 1_024).rounded()))
    let start = ContinuousClock.now
    var routeKeepAlives = 0
    for reportIndex in 0..<reportCount {
        if isLoopback, reportIndex > 0, reportIndex % 8 == 0 {
            let routeKeepAlive = sendOutputReport(
                speakerRouteReport(path: route, volume: volume, preGain: 0x02),
                to: device
            )
            let stateKeepAlive = sendOutputReport(
                duplexStateReport142(path: route, volume: volume),
                to: device
            )
            guard routeKeepAlive == kIOReturnSuccess,
                  stateKeepAlive == kIOReturnSuccess else {
                print(
                    "speakerRouteKeepAlive[\(reportIndex)]="
                        + "\(hex(routeKeepAlive))/\(hex(stateKeepAlive))"
                )
                return false
            }
            routeKeepAlives += 1
        }
        let firstFrameIndex = reportIndex * 2
        let tone = isLoopback && reportIndex >= 6 && reportIndex < reportCount - 4
        guard let firstFrame = tone
            ? opus.encode(
                samples: pcmFrame(tone: true, frameIndex: firstFrameIndex, amplitude: 8_000)
            )
            : Optional(silence),
            let secondFrame = tone
            ? opus.encode(
                samples: pcmFrame(tone: true, frameIndex: firstFrameIndex + 1, amplitude: 8_000)
            )
            : Optional(silence) else {
            return false
        }
        let result = sendOutputReport(
            audioReport547(
                sequence: UInt8((reportIndex + 2) & 0x0f),
                counter: UInt8(truncatingIfNeeded: (reportIndex + 1) * 2),
                firstOpusFrame: firstFrame,
                secondOpusFrame: secondFrame,
                microphoneEnabled: true
            ),
            to: device
        )
        if result != kIOReturnSuccess {
            print("microphoneClock[\(reportIndex)]=\(hex(result))")
            return false
        }
        CFRunLoopRunInMode(.defaultMode, 0.005, true)
        let target = start + .nanoseconds(Int64(reportIndex + 1) * 21_333_334)
        let remaining = ContinuousClock.now.duration(to: target)
        if remaining > .zero {
            Thread.sleep(
                forTimeInterval: Double(remaining.components.attoseconds) / 1e18
                    + Double(remaining.components.seconds)
            )
        }
    }
    for _ in 0..<10 {
        CFRunLoopRunInMode(.defaultMode, 0.01, true)
    }

    let frames = context.microphoneFrames
    var decodedSamples: [Int16] = []
    var decodeFailures = 0
    for frame in frames {
        if let decoded = decoder.decode(frame: frame) {
            decodedSamples.append(contentsOf: decoded)
        } else {
            decodeFailures += 1
        }
    }
    let sumSquares = decodedSamples.reduce(0.0) {
        let value = Double($1) / 32_768
        return $0 + value * value
    }
    let rms = decodedSamples.isEmpty ? 0 : sqrt(sumSquares / Double(decodedSamples.count))
    let peak = decodedSamples.map { abs(Int($0)) }.max() ?? 0
    print(
        String(
            format: "microphoneFrames=%d decodedSamples=%d decodeFailures=%d rms=%.6f peak=%d",
            frames.count,
            decodedSamples.count,
            decodeFailures,
            rms,
            peak
        )
    )
    let microphoneSucceeded = !frames.isEmpty && !decodedSamples.isEmpty && peak > 0
    guard isLoopback else { return microphoneSucceeded }
    print("speakerRouteKeepAlives=\(routeKeepAlives)")

    let targetPower = spectralPower(samples: decodedSamples, frequency: 880)
    let comparisonPowers = [680.0, 740.0, 1_020.0, 1_080.0].map {
        spectralPower(samples: decodedSamples, frequency: $0)
    }.sorted()
    let nearbyPower = (comparisonPowers[1] + comparisonPowers[2]) / 2
    let ratioDB = 10 * log10((targetPower + 1e-12) / (nearbyPower + 1e-12))
    let acousticallyVerified = microphoneSucceeded && ratioDB >= 12
    print(
        String(
            format: "speakerLoopback targetHz=880 targetPower=%.3f nearbyPower=%.3f "
                + "targetToNearbyDB=%.2f acousticResult=%@",
            targetPower,
            nearbyPower,
            ratioDB,
            acousticallyVerified ? "verified" : "not-detected"
        )
    )
    return acousticallyVerified
}

private func printFeatureReport(
    id: UInt8,
    expectedLength: Int,
    from device: IOHIDDevice
) {
    var report = [UInt8](repeating: 0, count: expectedLength)
    report[0] = id
    var length = CFIndex(expectedLength)
    let result = report.withUnsafeMutableBytes { bytes in
        IOHIDDeviceGetReport(
            device,
            kIOHIDReportTypeFeature,
            CFIndex(id),
            bytes.bindMemory(to: UInt8.self).baseAddress!,
            &length
        )
    }
    let prefixCount = min(Int(length), 32)
    let prefix = report.prefix(prefixCount)
        .map { String(format: "%02x", $0) }
        .joined(separator: " ")
    print(
        String(format: "feature=0x%02x result=%@ length=%d prefix=%@", id, hex(result), length, prefix)
    )
}

private func runAudioTest(mode: Mode, seconds: Double, device: IOHIDDevice) -> Bool {
    let duration = min(max(seconds, 0.25), 2.0)
    guard let opus = OpusEncoder() else { return false }
    guard pcmFrame(tone: false, frameIndex: 0).count == 960 else { return false }

    let setupVolume: UInt8 = mode == .transportTest ? 0x3d : 0x50
    let usesStateSequence = mode == .speakerTestState || mode == .speakerTestAuto
    let route: UInt8 = mode == .speakerTestAuto ? 0x00 : 0x30
    if usesStateSequence {
        let stateResult = sendOutputReport(
            stateReport142(path: route, volume: setupVolume),
            to: device
        )
        let configResult = sendOutputReport(
            audioConfigReport142(microphoneEnabled: false),
            to: device
        )
        print("audioState=\(hex(stateResult)) audioConfig=\(hex(configResult))")
        guard stateResult == kIOReturnSuccess, configResult == kIOReturnSuccess else {
            return false
        }
        Thread.sleep(forTimeInterval: 0.05)
    }
    let setup = speakerRouteReport(path: route, volume: setupVolume)
    let setupResult = sendOutputReport(setup, to: device)
    print("speakerSetup=\(hex(setupResult))")
    guard setupResult == kIOReturnSuccess else { return false }
    Thread.sleep(forTimeInterval: 0.05)

    defer {
        if let silence = opus.encode(samples: pcmFrame(tone: false, frameIndex: 0)) {
            let muteReport = mode == .speakerTest547
                || mode == .speakerTestState
                || mode == .speakerTestAuto
                ? audioReport547(
                    sequence: 0,
                    counter: 0,
                    firstOpusFrame: silence,
                    secondOpusFrame: silence
                )
                : audioReport(sequence: 0, counter: 0, opusFrame: silence)
            let muteResult = sendOutputReport(muteReport, to: device)
            print("finalMute=\(hex(muteResult))")
        }
        let releaseResult = sendOutputReport(
            speakerRouteReport(path: 0x00, volume: 0x3d),
            to: device
        )
        print("speakerRelease=\(hex(releaseResult))")
    }

    var frameCount = max(24, Int((duration * 48_000 / 512).rounded()))
    if mode == .speakerTest547
        || mode == .speakerTestState
        || mode == .speakerTestAuto,
       frameCount % 2 != 0 {
        frameCount += 1
    }
    var sequence: UInt8 = mode == .speakerTestAuto ? 3 : 0
    var counter: UInt8 = mode == .speakerTestAuto ? 2 : 0
    var successfulFrames = 0
    let start = ContinuousClock.now

    var frameIndex = 0
    while frameIndex < frameCount {
        let isToneMode = mode != .transportTest
        // Published working implementations use 24 silence frames to let the
        // controller's Bluetooth audio path and Opus decoder settle.
        let firstTone = isToneMode && frameIndex >= 24 && frameIndex < frameCount - 12
        guard let firstEncoded = opus.encode(
            samples: pcmFrame(tone: firstTone, frameIndex: frameIndex)
        ) else {
            return false
        }

        let report: [UInt8]
        let framesInReport: Int
        if mode == .speakerTest547 || mode == .speakerTestState || mode == .speakerTestAuto {
            let secondIndex = frameIndex + 1
            let secondTone = isToneMode && secondIndex >= 24 && secondIndex < frameCount - 12
            guard let secondEncoded = opus.encode(
                samples: pcmFrame(tone: secondTone, frameIndex: secondIndex)
            ) else {
                return false
            }
            report = audioReport547(
                sequence: sequence,
                counter: counter,
                firstOpusFrame: firstEncoded,
                secondOpusFrame: secondEncoded
            )
            framesInReport = 2
        } else {
            report = audioReport(
                sequence: sequence,
                counter: counter,
                opusFrame: firstEncoded
            )
            framesInReport = 1
        }

        let result = sendOutputReport(report, to: device)
        if result != kIOReturnSuccess {
            print("audioFrame[\(frameIndex)]=\(hex(result))")
            return false
        }
        successfulFrames += framesInReport
        sequence = (sequence + 1) & 0x0f
        counter &+= UInt8(framesInReport)
        frameIndex += framesInReport

        let target = start + .nanoseconds(Int64(frameIndex) * 10_666_667)
        let remaining = ContinuousClock.now.duration(to: target)
        if remaining > .zero {
            Thread.sleep(
                forTimeInterval: Double(remaining.components.attoseconds) / 1e18
                    + Double(remaining.components.seconds)
            )
        }
    }

    let reportDescription = mode == .speakerTest547
        || mode == .speakerTestState
        || mode == .speakerTestAuto
        ? "report-0x39/547-byte/two-frame"
        : "report-0x36/398-byte/one-frame"
    print(
        "audioFrames=\(successfulFrames)/\(frameCount) "
            + "payload=\(reportDescription) opus=48kHz-stereo-cbr-200 "
            + "microphoneDuplex=disabled"
    )
    return successfulFrames == frameCount
}

private func main() -> Int32 {
    guard let options = Options.parse() else {
        usage()
        return 64
    }
    if options.mode.writesToController, !options.acknowledgedWrite {
        fputs("error: write mode requires \(writeAcknowledgement)\n", stderr)
        usage()
        return 64
    }

    let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
    IOHIDManagerSetDeviceMatchingMultiple(manager, matchingDictionaries() as CFArray)

    let context = ProbeContext()
    let opaqueContext = Unmanaged.passUnretained(context).toOpaque()
    IOHIDManagerRegisterInputReportCallback(manager, inputReportCallback, opaqueContext)
    IOHIDManagerScheduleWithRunLoop(
        manager,
        CFRunLoopGetCurrent(),
        CFRunLoopMode.defaultMode.rawValue
    )

    let managerOptions = options.mode.isolatesInput
        ? IOOptionBits(kIOHIDOptionsTypeSeizeDevice)
        : IOOptionBits(kIOHIDOptionsTypeNone)
    let managerOpen = IOHIDManagerOpen(manager, managerOptions)
    print("mode=\(options.mode.rawValue) managerOpen=\(hex(managerOpen))")
    guard managerOpen == kIOReturnSuccess else { return 1 }

    let devices = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
    print("deviceCount=\(devices.count)")
    guard !devices.isEmpty else {
        IOHIDManagerClose(manager, managerOptions)
        return 2
    }

    var bluetoothDevice: IOHIDDevice?
    var usbDevice: IOHIDDevice?
    for device in devices {
        let name = stringProperty(device, kIOHIDProductKey) ?? "Unknown"
        let transport = stringProperty(device, kIOHIDTransportKey) ?? "Unknown"
        let vendor = integerProperty(device, kIOHIDVendorIDKey) ?? 0
        let product = integerProperty(device, kIOHIDProductIDKey) ?? 0
        let maxInput = integerProperty(device, kIOHIDMaxInputReportSizeKey) ?? 0
        let maxOutput = integerProperty(device, kIOHIDMaxOutputReportSizeKey) ?? 0
        let maxFeature = integerProperty(device, kIOHIDMaxFeatureReportSizeKey) ?? 0
        let openResult = IOHIDDeviceOpen(device, managerOptions)
        print(
            "device=\(name) transport=\(transport) "
                + String(format: "vendor=%04x product=%04x ", vendor, product)
                + "maxInput=\(maxInput) maxOutput=\(maxOutput) maxFeature=\(maxFeature) "
                + "deviceOpen=\(hex(openResult))"
        )
        if transport.caseInsensitiveCompare("Bluetooth") == .orderedSame,
           maxInput >= 78, maxOutput >= 398, openResult == kIOReturnSuccess {
            bluetoothDevice = device
        }
        if transport.caseInsensitiveCompare("USB") == .orderedSame,
           maxInput >= 64, maxOutput >= 48, openResult == kIOReturnSuccess {
            usbDevice = device
        }
        if options.mode == .inspect, openResult == kIOReturnSuccess {
            printFeatureReport(id: 0x20, expectedLength: 64, from: device)
            printFeatureReport(id: 0x05, expectedLength: 41, from: device)
            printFeatureReport(id: 0x09, expectedLength: 20, from: device)
        }
    }

    var audioTestSucceeded = true
    if options.mode.writesToController {
        if options.mode == .usbSpeakerTest || options.mode == .usbMicrophoneTest {
            guard let usbDevice else {
                fputs("error: no opened USB DualSense with required report sizes\n", stderr)
                for device in devices {
                    IOHIDDeviceClose(device, managerOptions)
                }
                IOHIDManagerClose(manager, managerOptions)
                return 4
            }
            audioTestSucceeded = options.mode == .usbSpeakerTest
                ? runUSBSpeakerTest(seconds: options.listenSeconds, device: usbDevice)
                : runUSBMicrophoneTest(seconds: options.listenSeconds, device: usbDevice)
        } else {
        guard let bluetoothDevice else {
            fputs("error: no opened Bluetooth DualSense with required report sizes\n", stderr)
            audioTestSucceeded = false
            for device in devices {
                IOHIDDeviceClose(device, managerOptions)
            }
            IOHIDManagerClose(manager, managerOptions)
            return 4
        }
        if options.mode == .microphoneTest
            || options.mode == .speakerLoopbackAuto
            || options.mode == .speakerLoopbackForced {
            audioTestSucceeded = runMicrophoneTest(
                mode: options.mode,
                seconds: options.listenSeconds,
                device: bluetoothDevice,
                context: context
            )
        } else if options.mode == .speakerTestPCM {
            audioTestSucceeded = runPCMTest(seconds: options.listenSeconds, device: bluetoothDevice)
        } else {
            audioTestSucceeded = runAudioTest(
                mode: options.mode,
                seconds: options.listenSeconds,
                device: bluetoothDevice
            )
        }
        }
    }

    let deadline = Date().addingTimeInterval(options.mode == .inspect ? options.listenSeconds : 0.2)
    while Date() < deadline {
        CFRunLoopRunInMode(.defaultMode, 0.02, true)
    }

    let ids = context.reportIDs.keys.sorted().map {
        String(format: "0x%02x:%d", $0, context.reportIDs[$0] ?? 0)
    }.joined(separator: ",")
    print("inputReports=\(context.reportCount) ids=\(ids)")
    if let prefix = context.firstReportPrefix {
        print("firstReportPrefix=\(prefix)")
    }
    if let headphones = context.usbHeadphonesPlugged,
       let microphone = context.usbMicrophonePlugged {
        print("usbJackHeadphones=\(headphones) usbJackMicrophone=\(microphone)")
    }
    for prefix in context.possibleMicrophonePrefixes {
        print("possibleMicrophonePrefix=\(prefix)")
    }
    if options.mode == .speakerTestState
        || options.mode == .speakerTestAuto
        || options.mode == .speakerTestPCM
        || options.mode == .speakerLoopbackAuto
        || options.mode == .speakerLoopbackForced {
        print("stateAcknowledgement=\(context.sawStateAcknowledgement ? "mirrored" : "not-observed")")
    }

    for device in devices {
        IOHIDDeviceClose(device, managerOptions)
    }
    IOHIDManagerUnscheduleFromRunLoop(
        manager,
        CFRunLoopGetCurrent(),
        CFRunLoopMode.defaultMode.rawValue
    )
    IOHIDManagerClose(manager, managerOptions)
    if !audioTestSucceeded { return 5 }
    return context.reportCount > 0 ? 0 : 3
}

exit(main())
