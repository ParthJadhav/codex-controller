import CoreAudio
import Foundation
import IOKit.hid

@MainActor
final class DualSenseUSBMicrophone {
    struct Capability {
        let available: Bool
        let reason: String
    }

    enum RouteError: LocalizedError {
        case noDevice
        case ambiguousDevices
        case openFailed
        case writeFailed

        var errorDescription: String? {
            switch self {
            case .noDevice: "No compatible USB DualSense microphone route is connected."
            case .ambiguousDevices: DualSensePhysicalDevicePolicy.ambiguityReason
            case .openFailed: "The DualSense USB microphone HID route could not be opened."
            case .writeFailed: "The controller rejected the internal-microphone route."
            }
        }
    }

    private static let sonyVendorID = 0x054c
    private static let productIDs = [0x0ce6, 0x0df2]
    private var manager: IOHIDManager?
    private var device: IOHIDDevice?
    private var timer: DispatchSourceTimer?

    static func capability() -> Capability {
        let compatible = audioDevices().filter {
            guard let name = deviceName($0) else { return false }
            return isCompatibleInput(
                name: name,
                transportType: transportType($0),
                channelCount: channelCount($0, scope: kAudioDevicePropertyScopeInput)
            )
        }
        if compatible.count > 1 {
            return Capability(
                available: false,
                reason: DualSensePhysicalDevicePolicy.ambiguityReason
            )
        }
        return compatible.count == 1
            ? Capability(
                available: true,
                reason: "Two-channel DualSense USB CoreAudio input is available."
            )
            : Capability(
                available: false,
                reason: "Connect DualSense with a data-capable USB cable."
            )
    }

    nonisolated static func isCompatibleInput(
        name: String,
        transportType: UInt32,
        channelCount: UInt32
    ) -> Bool {
        name.localizedCaseInsensitiveContains("DualSense")
            && transportType == kAudioDeviceTransportTypeUSB
            && channelCount >= 2
    }

    func start() -> Result<Void, RouteError> {
        stop()
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        IOHIDManagerSetDeviceMatchingMultiple(
            manager,
            Self.productIDs.map {
                [
                    kIOHIDVendorIDKey: Self.sonyVendorID,
                    kIOHIDProductIDKey: $0
                ]
            } as CFArray
        )
        let options = IOOptionBits(kIOHIDOptionsTypeNone)
        guard IOHIDManagerOpen(manager, options) == kIOReturnSuccess else {
            return .failure(.openFailed)
        }
        let devices = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
        let compatible = devices.filter(Self.isCompatibleUSBDevice)
        guard !DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
            physicalIdentifiers: compatible.map {
                DualSenseHIDIdentity.physicalDeviceIdentifier($0)
            }
        ) else {
            IOHIDManagerClose(manager, options)
            return .failure(.ambiguousDevices)
        }
        guard let device = compatible.first else {
            IOHIDManagerClose(manager, options)
            return .failure(.noDevice)
        }
        guard IOHIDDeviceOpen(device, options) == kIOReturnSuccess else {
            IOHIDManagerClose(manager, options)
            return .failure(.openFailed)
        }
        guard Self.send(Self.stateReport(enabled: true), to: device) == kIOReturnSuccess else {
            IOHIDDeviceClose(device, options)
            IOHIDManagerClose(manager, options)
            return .failure(.writeFailed)
        }
        self.manager = manager
        self.device = device

        // The keep-alive runs on the main queue, which is this actor's
        // executor. On a global queue it read `device` — main-actor state —
        // from the wrong isolation domain, and a tick already dequeued there
        // could reach `IOHIDDeviceSetReport` after `stop()` had closed the
        // handle. Sharing the queue with `stop()` makes both impossible:
        // `cancel()` cannot return while a tick is in flight, so no report is
        // ever sent to a closed device.
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .milliseconds(50), repeating: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let device = self?.device else { return }
                _ = Self.send(Self.stateReport(enabled: true), to: device)
            }
        }
        self.timer = timer
        timer.resume()
        return .success(())
    }

    func stop() {
        // Cancelling from the timer's own queue means no further tick can run,
        // so the close below cannot race a keep-alive report.
        timer?.cancel()
        timer = nil
        if let device {
            _ = Self.send(Self.stateReport(enabled: false), to: device)
            IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone))
        }
        if let manager {
            IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone))
        }
        device = nil
        manager = nil
    }

    private static func stateReport(enabled: Bool) -> [UInt8] {
        var report = [UInt8](repeating: 0, count: 48)
        report[0] = 0x02
        let state = 1
        report[state] = 0xc0
        report[state + 1] = 0x83
        report[state + 6] = enabled ? 0x40 : 0
        report[state + 7] = enabled ? 0x01 : 0
        report[state + 9] = enabled ? 0 : 0x10
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
}
