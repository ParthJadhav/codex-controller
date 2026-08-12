import COpusShim
import CoreFoundation
import Foundation
import IOKit.hid

enum DualSenseBluetoothAudioProtocol {
    static let vendorID = DualSenseHIDIdentity.vendorID
    static let productIDs = DualSenseHIDIdentity.productIDs

    static func crc32(_ bytes: ArraySlice<UInt8>) -> UInt32 {
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

    static func addCRC(to report: inout [UInt8]) {
        let offset = report.count - 4
        let value = crc32(report[..<offset])
        report[offset] = UInt8(truncatingIfNeeded: value)
        report[offset + 1] = UInt8(truncatingIfNeeded: value >> 8)
        report[offset + 2] = UInt8(truncatingIfNeeded: value >> 16)
        report[offset + 3] = UInt8(truncatingIfNeeded: value >> 24)
    }

    static func microphoneState(enabled: Bool) -> [UInt8] {
        var report = [UInt8](repeating: 0, count: 142)
        report[0] = 0x32
        report[1] = 0x10
        report[2] = 0x90
        report[3] = 0x3f
        let state = 4
        report[state] = 0xc0
        report[state + 1] = 0x02
        report[state + 6] = enabled ? 0x40 : 0
        report[state + 7] = enabled ? 0x01 : 0
        report[state + 9] = enabled ? 0 : 0x10
        addCRC(to: &report)
        return report
    }

    static func microphoneConfig(enabled: Bool) -> [UInt8] {
        var report = [UInt8](repeating: 0, count: 142)
        report[0] = 0x32
        report[1] = 0x20
        report[2] = 0x91
        report[3] = 1
        report[4] = enabled ? 0x03 : 0x02
        addCRC(to: &report)
        return report
    }

    static func clock(
        sequence: UInt8,
        counter: UInt8,
        silence: [UInt8],
        microphoneEnabled: Bool
    ) -> [UInt8] {
        precondition(silence.count == 200)
        var report = [UInt8](repeating: 0, count: 547)
        report[0] = 0x39
        report[1] = (sequence & 0x0f) << 4
        report[2] = 0x91
        report[3] = 6
        report[4] = microphoneEnabled ? 0x7f : 0x7e
        for index in 5...8 { report[index] = 64 }
        report[9] = counter
        report[10] = 0xd2
        report[11] = 64
        report[140] = 0xd3
        report[141] = 200
        report.replaceSubrange(142..<342, with: silence)
        report.replaceSubrange(342..<542, with: silence)
        addCRC(to: &report)
        return report
    }

    static func microphonePayload(from report: [UInt8]) -> [UInt8]? {
        guard report.count == 78, report[0] == 0x31,
              report[1] & 0x02 != 0, report[3] == 0xd4 else { return nil }
        return Array(report[3..<74])
    }
}

private let dualSenseMicrophoneReportCallback: IOHIDReportCallback = {
    context, result, _, _, _, report, reportLength in
    guard result == kIOReturnSuccess, let context else { return }
    let receiver = Unmanaged<DualSenseBluetoothMicrophone>
        .fromOpaque(context)
        .takeUnretainedValue()
    let bytes = Array(UnsafeBufferPointer(start: report, count: Int(reportLength)))
    Task { @MainActor in receiver.receive(bytes) }
}

@MainActor
final class DualSenseBluetoothMicrophone {
    struct Capability: Sendable {
        let available: Bool
        let reason: String
    }

    private var manager: IOHIDManager?
    private var device: IOHIDDevice?
    private var timer: Timer?
    private var encoder: OpaquePointer?
    private var decoder: OpaquePointer?
    private var silence = [UInt8]()
    private var sequence: UInt8 = 2
    private var counter: UInt8 = 2
    private var onSamples: (([Int16]) -> Void)?
    private var onUnexpectedStop: ((String) -> Void)?
    private(set) var isRunning = false
    private(set) var decodedFrameCount = 0
    private(set) var decodeFailureCount = 0

    private static var cachedCapability: Capability?

    /// Whether the proprietary Bluetooth microphone transport is usable.
    ///
    /// Answering this costs an Opus encoder, an Opus decoder, and an
    /// `IOHIDManager` open — and the renderer's `system.refresh` poll asks every
    /// four seconds, forever, whether or not a controller is even connected.
    /// The answer only changes when the set of devices changes, so it is
    /// computed once and thrown away by ``invalidateCapabilityCache()``.
    static func capability() -> Capability {
        if let cachedCapability { return cachedCapability }
        let capability = codecUnavailability ?? hidCapability()
        cachedCapability = capability
        return capability
    }

    /// Called when a controller connects or disconnects, and after every
    /// verification attempt — both can change the answer above.
    static func invalidateCapabilityCache() {
        cachedCapability = nil
    }

    /// Opus availability depends on the linked shim, not on any hardware, so it
    /// cannot change while the process lives and is probed exactly once. `nil`
    /// means the codec is fine and the question is now about the device.
    private static let codecUnavailability: Capability? = {
        var codecError: Int32 = 0
        guard let encoder = ds_opus_encoder_create(&codecError) else {
            return Capability(
                available: false,
                reason: "The optional Opus codec is unavailable."
            )
        }
        ds_opus_encoder_destroy(encoder)
        guard let decoder = ds_opus_decoder_create(&codecError) else {
            return Capability(
                available: false,
                reason: "The optional Opus decoder is unavailable."
            )
        }
        ds_opus_decoder_destroy(decoder)
        return nil
    }()

    private static func hidCapability() -> Capability {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        IOHIDManagerSetDeviceMatchingMultiple(manager, matchingDictionaries() as CFArray)
        let result = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
        defer { IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone)) }
        guard result == kIOReturnSuccess else {
            return Capability(available: false, reason: "macOS denied shared HID access.")
        }
        let devices = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
        let compatible = devices.filter {
            stringProperty($0, kIOHIDTransportKey).caseInsensitiveCompare("Bluetooth")
                == .orderedSame
                && integerProperty($0, kIOHIDMaxInputReportSizeKey) >= 78
                && integerProperty($0, kIOHIDMaxOutputReportSizeKey) >= 547
        }
        if DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
            physicalIdentifiers: compatible.map {
                DualSenseHIDIdentity.physicalDeviceIdentifier($0)
            }
        ) {
            return Capability(
                available: false,
                reason: DualSensePhysicalDevicePolicy.ambiguityReason
            )
        }
        return !compatible.isEmpty
            ? Capability(
                available: true,
                reason: "Verified proprietary Bluetooth microphone transport is available."
            )
            : Capability(
                available: false,
                reason: "No compatible Bluetooth DualSense HID interface is connected."
            )
    }

    func start(
        onSamples: @escaping ([Int16]) -> Void,
        onUnexpectedStop: @escaping (String) -> Void
    ) -> Result<Void, Error> {
        stop()
        var codecError: Int32 = 0
        guard let codecs = Self.acquireCodecPair(
            createEncoder: { ds_opus_encoder_create(&codecError) },
            createDecoder: { ds_opus_decoder_create(&codecError) },
            destroyEncoder: ds_opus_encoder_destroy
        ) else {
            return .failure(MicrophoneError.codecUnavailable)
        }
        let createdEncoder = codecs.encoder
        encoder = createdEncoder
        decoder = codecs.decoder

        var encodedSilence = [UInt8](repeating: 0, count: 200)
        let pcmSilence = [Int16](repeating: 0, count: 960)
        let encodedCount = pcmSilence.withUnsafeBufferPointer { input in
            encodedSilence.withUnsafeMutableBufferPointer {
                ds_opus_encode(createdEncoder, input.baseAddress, 480, $0.baseAddress, 200)
            }
        }
        guard encodedCount == 200 else {
            stop()
            return .failure(MicrophoneError.codecConfiguration)
        }
        silence = encodedSilence

        let createdManager = IOHIDManagerCreate(
            kCFAllocatorDefault,
            IOOptionBits(kIOHIDOptionsTypeNone)
        )
        IOHIDManagerSetDeviceMatchingMultiple(
            createdManager,
            Self.matchingDictionaries() as CFArray
        )
        let context = Unmanaged.passUnretained(self).toOpaque()
        guard Self.prepareHIDManager(
            createdManager,
            open: {
                IOHIDManagerOpen($0, IOOptionBits(kIOHIDOptionsTypeNone))
                    == kIOReturnSuccess
            },
            close: {
                IOHIDManagerClose($0, IOOptionBits(kIOHIDOptionsTypeNone))
            },
            register: {
                IOHIDManagerRegisterInputReportCallback(
                    $0,
                    dualSenseMicrophoneReportCallback,
                    context
                )
            },
            schedule: {
                IOHIDManagerScheduleWithRunLoop(
                    $0,
                    CFRunLoopGetMain(),
                    CFRunLoopMode.commonModes.rawValue
                )
            }
        ) else {
            stop()
            return .failure(MicrophoneError.hidAccess)
        }
        // From here on every failure calls stop(), which owns both unscheduling
        // and closing this successfully prepared manager.
        manager = createdManager

        let devices = (IOHIDManagerCopyDevices(createdManager) as? Set<IOHIDDevice>) ?? []
        let compatibleDevices = devices.filter(Self.isCompatible)
        guard !DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
            physicalIdentifiers: compatibleDevices.map {
                DualSenseHIDIdentity.physicalDeviceIdentifier($0)
            }
        ) else {
            stop()
            return .failure(MicrophoneError.ambiguousControllers)
        }
        guard let selected = compatibleDevices.first,
              IOHIDDeviceOpen(selected, IOOptionBits(kIOHIDOptionsTypeNone))
                == kIOReturnSuccess else {
            stop()
            return .failure(MicrophoneError.controllerUnavailable)
        }
        device = selected
        self.onSamples = onSamples
        self.onUnexpectedStop = onUnexpectedStop
        decodedFrameCount = 0
        decodeFailureCount = 0
        sequence = 2
        counter = 2

        guard send(DualSenseBluetoothAudioProtocol.microphoneState(enabled: true)),
              send(DualSenseBluetoothAudioProtocol.microphoneConfig(enabled: true)) else {
            stop()
            return .failure(MicrophoneError.setupRejected)
        }

        isRunning = true
        let timer = Timer(timeInterval: 1_024 / 48_000, repeats: true) {
            [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.sendClock() }
        }
        timer.tolerance = 0.001
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        sendClock()
        return .success(())
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let device, silence.count == 200 {
            _ = send(
                DualSenseBluetoothAudioProtocol.clock(
                    sequence: sequence,
                    counter: counter,
                    silence: silence,
                    microphoneEnabled: false
                )
            )
            _ = send(DualSenseBluetoothAudioProtocol.microphoneConfig(enabled: false))
            _ = send(DualSenseBluetoothAudioProtocol.microphoneState(enabled: false))
            IOHIDDeviceClose(device, IOOptionBits(kIOHIDOptionsTypeNone))
        }
        if let manager {
            IOHIDManagerUnscheduleFromRunLoop(
                manager,
                CFRunLoopGetMain(),
                CFRunLoopMode.commonModes.rawValue
            )
            IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone))
        }
        if let encoder { ds_opus_encoder_destroy(encoder) }
        if let decoder { ds_opus_decoder_destroy(decoder) }
        manager = nil
        device = nil
        encoder = nil
        decoder = nil
        silence.removeAll(keepingCapacity: false)
        onSamples = nil
        onUnexpectedStop = nil
        isRunning = false
    }

    fileprivate func receive(_ report: [UInt8]) {
        guard isRunning, let decoder,
              let payload = DualSenseBluetoothAudioProtocol.microphonePayload(from: report)
        else { return }
        var samples = [Int16](repeating: 0, count: 480)
        let count = payload.withUnsafeBufferPointer { input in
            samples.withUnsafeMutableBufferPointer {
                ds_opus_decode(
                    decoder,
                    input.baseAddress,
                    Int32(input.count),
                    $0.baseAddress,
                    Int32($0.count)
                )
            }
        }
        guard count > 0 else {
            decodeFailureCount += 1
            if decodeFailureCount >= 10 {
                failAndStop("The controller microphone Opus stream stopped decoding.")
            }
            return
        }
        decodedFrameCount += 1
        onSamples?(Array(samples.prefix(Int(count))))
    }

    private func sendClock() {
        guard isRunning || timer == nil, silence.count == 200 else { return }
        let report = DualSenseBluetoothAudioProtocol.clock(
            sequence: sequence,
            counter: counter,
            silence: silence,
            microphoneEnabled: true
        )
        if !send(report) {
            failAndStop("The controller microphone transport stopped responding.")
            return
        }
        sequence = (sequence + 1) & 0x0f
        counter &+= 2
    }

    private func failAndStop(_ message: String) {
        let callback = onUnexpectedStop
        stop()
        callback?(message)
    }

    private func send(_ report: [UInt8]) -> Bool {
        guard let device else { return false }
        let result = report.withUnsafeBytes {
            IOHIDDeviceSetReport(
                device,
                kIOHIDReportTypeOutput,
                CFIndex(report[0]),
                $0.bindMemory(to: UInt8.self).baseAddress!,
                report.count
            )
        }
        return result == kIOReturnSuccess
    }

    private static func matchingDictionaries() -> [[String: Any]] {
        DualSenseHIDIdentity.matchingDictionaries
    }

    /// Acquires the codec pair without making a compound optional binding hide
    /// an already-created encoder when decoder creation fails.
    static func acquireCodecPair(
        createEncoder: () -> OpaquePointer?,
        createDecoder: () -> OpaquePointer?,
        destroyEncoder: (OpaquePointer) -> Void
    ) -> (encoder: OpaquePointer, decoder: OpaquePointer)? {
        guard let encoder = createEncoder() else { return nil }
        guard let decoder = createDecoder() else {
            destroyEncoder(encoder)
            return nil
        }
        return (encoder, decoder)
    }

    /// Opens before installing a callback or scheduling on a run loop. A failed
    /// open therefore has no callback/run-loop registration to leak; the local
    /// manager is closed immediately. On success ownership transfers to the
    /// caller, whose normal stop path unschedules and closes it.
    static func prepareHIDManager<Manager>(
        _ manager: Manager,
        open: (Manager) -> Bool,
        close: (Manager) -> Void,
        register: (Manager) -> Void,
        schedule: (Manager) -> Void
    ) -> Bool {
        guard open(manager) else {
            close(manager)
            return false
        }
        register(manager)
        schedule(manager)
        return true
    }

    private static func isCompatible(_ device: IOHIDDevice) -> Bool {
        stringProperty(device, kIOHIDTransportKey).caseInsensitiveCompare("Bluetooth")
            == .orderedSame
            && integerProperty(device, kIOHIDMaxInputReportSizeKey) >= 78
            && integerProperty(device, kIOHIDMaxOutputReportSizeKey) >= 547
    }

    private static func integerProperty(_ device: IOHIDDevice, _ key: String) -> Int {
        (IOHIDDeviceGetProperty(device, key as CFString) as? NSNumber)?.intValue ?? 0
    }

    private static func stringProperty(_ device: IOHIDDevice, _ key: String) -> String {
        IOHIDDeviceGetProperty(device, key as CFString) as? String ?? ""
    }

    private enum MicrophoneError: LocalizedError {
        case codecUnavailable
        case codecConfiguration
        case hidAccess
        case ambiguousControllers
        case controllerUnavailable
        case setupRejected

        var errorDescription: String? {
            switch self {
            case .codecUnavailable: "The optional Opus codec is unavailable."
            case .codecConfiguration: "The Opus codec rejected the controller format."
            case .hidAccess: "macOS denied shared controller HID access."
            case .ambiguousControllers: DualSensePhysicalDevicePolicy.ambiguityReason
            case .controllerUnavailable: "No compatible Bluetooth DualSense is connected."
            case .setupRejected: "The controller rejected microphone setup."
            }
        }
    }
}
