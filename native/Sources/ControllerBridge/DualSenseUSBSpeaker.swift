import CoreAudio
import Foundation
import IOKit.hid

enum DualSenseUSBSpeaker {
    struct Capability {
        let available: Bool
        let reason: String
    }

    private static let sonyVendorID = DualSenseHIDIdentity.vendorID
    private static let productIDs = DualSenseHIDIdentity.productIDs

    static func capability() -> Capability {
        let outputs = outputDevices()
        guard outputs.count <= 1 else {
            return Capability(
                available: false,
                reason: DualSensePhysicalDevicePolicy.ambiguityReason
            )
        }
        guard !outputs.isEmpty else {
            return Capability(
                available: false,
                reason: "Connect DualSense with a data-capable USB cable."
            )
        }
        return Capability(
            available: true,
            reason: "Four-channel DualSense USB CoreAudio output is available."
        )
    }

    static func isCompatibleOutput(
        name: String,
        transportType: UInt32,
        channelCount: UInt32
    ) -> Bool {
        name.localizedCaseInsensitiveContains("DualSense")
            && transportType == kAudioDeviceTransportTypeUSB
            && channelCount >= 4
    }

    static func verify() async -> (Bool, String) {
        await Task.detached(priority: .userInitiated) {
            runVerification()
        }.value
    }

    private static func runVerification() -> (Bool, String) {
        let outputs = outputDevices()
        guard outputs.count == 1, let output = outputs.first else {
            return (false, capability().reason)
        }
        guard let previousOutput = defaultOutputDevice() else {
            return (false, "The current macOS output device could not be read.")
        }
        let toneURL: URL
        do {
            toneURL = try makeTone()
        } catch {
            return (false, "The USB speaker verification tone could not be created.")
        }
        defer { try? FileManager.default.removeItem(at: toneURL) }

        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        IOHIDManagerSetDeviceMatchingMultiple(
            manager,
            productIDs.map {
                [
                    kIOHIDVendorIDKey: sonyVendorID,
                    kIOHIDProductIDKey: $0
                ]
            } as CFArray
        )
        let managerOptions = IOOptionBits(kIOHIDOptionsTypeNone)
        guard IOHIDManagerOpen(manager, managerOptions) == kIOReturnSuccess else {
            return (false, "The DualSense USB HID interface could not be opened.")
        }
        defer { IOHIDManagerClose(manager, managerOptions) }

        let devices = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
        let compatibleDevices = devices.filter(isCompatibleUSBDevice)
        guard !DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
            physicalIdentifiers: compatibleDevices.map {
                DualSenseHIDIdentity.physicalDeviceIdentifier($0)
            }
        ) else {
            return (false, DualSensePhysicalDevicePolicy.ambiguityReason)
        }
        guard let device = compatibleDevices.first,
              IOHIDDeviceOpen(device, managerOptions) == kIOReturnSuccess else {
            return (false, "No compatible USB DualSense HID interface is available.")
        }
        defer { IOHIDDeviceClose(device, managerOptions) }

        return TemporaryDefaultAudioDevice.perform(
            route: .output,
            previousDevice: previousOutput,
            temporaryDevice: output,
            previousDeviceUID: AudioDeviceUID.of(previousOutput),
            selectionFailure: "macOS would not select the DualSense CoreAudio output.",
            restorationFailure: "macOS could not restore the previous output device.",
            setDefault: setDefaultOutput
        ) {
            guard send(stateReport(enabled: true), to: device) == kIOReturnSuccess else {
                return (false, "The controller rejected the USB internal-speaker route.")
            }
            defer { _ = send(stateReport(enabled: false), to: device) }

            let player = Process()
            player.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
            player.arguments = [toneURL.path]
            do {
                try player.run()
            } catch {
                return (false, "macOS could not start USB speaker playback.")
            }
            while player.isRunning {
                guard send(stateReport(enabled: true), to: device) == kIOReturnSuccess else {
                    player.terminate()
                    return (false, "The controller stopped accepting the USB speaker route.")
                }
                Thread.sleep(forTimeInterval: 0.05)
            }
            player.waitUntilExit()
            guard player.terminationStatus == 0 else {
                return (false, "USB speaker playback ended unexpectedly.")
            }
            return (
                true,
                "Played a bounded tone through the wired DualSense built-in speaker."
            )
        }
    }

    private static func stateReport(enabled: Bool) -> [UInt8] {
        var report = [UInt8](repeating: 0, count: 48)
        report[0] = 0x02
        let state = 1
        report[state] = 0xa0
        report[state + 1] = 0x80
        report[state + 5] = enabled ? 0x64 : 0x3d
        report[state + 7] = enabled ? 0x30 : 0
        report[state + 37] = enabled ? 0x02 : 0
        return report
    }

    private static func send(_ report: [UInt8], to device: IOHIDDevice) -> IOReturn {
        report.withUnsafeBytes {
            IOHIDDeviceSetReport(
                device,
                kIOHIDReportTypeOutput,
                CFIndex(report[0]),
                $0.bindMemory(to: UInt8.self).baseAddress!,
                report.count
            )
        }
    }

    private static func isCompatibleUSBDevice(_ device: IOHIDDevice) -> Bool {
        let transport = IOHIDDeviceGetProperty(device, kIOHIDTransportKey as CFString) as? String
        let maxOutput = (
            IOHIDDeviceGetProperty(device, kIOHIDMaxOutputReportSizeKey as CFString) as? NSNumber
        )?.intValue ?? 0
        return transport?.caseInsensitiveCompare("USB") == .orderedSame && maxOutput >= 48
    }

    private static func outputDevices() -> [AudioDeviceID] {
        audioDevices().filter {
            guard let name = deviceName($0) else { return false }
            return isCompatibleOutput(
                name: name,
                transportType: transportType($0),
                channelCount: outputChannelCount($0)
            )
        }
    }

    private static func audioDevices() -> [AudioDeviceID] {
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

    private static func outputChannelCount(_ id: AudioDeviceID) -> UInt32 {
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

    private static func deviceName(_ id: AudioDeviceID) -> String? {
        CoreAudioCopiedProperty.string(
            objectID: id,
            selector: kAudioObjectPropertyName
        )
    }

    private static func defaultOutputDevice() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
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

    private static func setDefaultOutput(_ id: AudioDeviceID) -> OSStatus {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
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

    private static func makeTone() throws -> URL {
        let sampleRate: UInt32 = 48_000
        let channelCount: UInt16 = 4
        let frameCount = Int(sampleRate)
        let dataByteCount = UInt32(frameCount * Int(channelCount) * 2)
        var data = Data()
        func ascii(_ value: String) { data.append(contentsOf: value.utf8) }
        func littleEndian<T: FixedWidthInteger>(_ value: T) {
            var copy = value.littleEndian
            withUnsafeBytes(of: &copy) { data.append(contentsOf: $0) }
        }

        ascii("RIFF")
        littleEndian(UInt32(36) + dataByteCount)
        ascii("WAVEfmt ")
        littleEndian(UInt32(16))
        littleEndian(UInt16(1))
        littleEndian(channelCount)
        littleEndian(sampleRate)
        littleEndian(sampleRate * UInt32(channelCount) * 2)
        littleEndian(channelCount * 2)
        littleEndian(UInt16(16))
        ascii("data")
        littleEndian(dataByteCount)
        for index in 0..<frameCount {
            let fade = min(1, min(Double(index) / 2_400, Double(frameCount - 1 - index) / 2_400))
            let value = Int16(
                (sin(2 * .pi * 880 * Double(index) / Double(sampleRate))
                    * 0.18 * Double(Int16.max) * fade).rounded()
            )
            littleEndian(UInt16(bitPattern: value))
            littleEndian(UInt16(bitPattern: value))
            littleEndian(UInt16(0))
            littleEndian(UInt16(0))
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("dualsense-usb-speaker-\(UUID().uuidString).wav")
        try data.write(to: url, options: .atomic)
        return url
    }
}
