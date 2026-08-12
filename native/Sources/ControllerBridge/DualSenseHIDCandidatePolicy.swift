import Foundation

/// One matched HID interface, reduced to the two properties that say whether it
/// can deliver touchpad data.
struct DualSenseHIDCandidate: Equatable {
    /// `kIOHIDTransportKey`, e.g. `"USB"` or `"Bluetooth"`. Absent on
    /// interfaces that do not publish one.
    let transport: String?
    /// `kIOHIDMaxInputReportSizeKey`.
    let maximumInputReportSize: Int
    /// Shared by all HID collections belonging to one physical controller.
    let physicalDeviceIdentifier: String?

    init(
        transport: String?,
        maximumInputReportSize: Int,
        physicalDeviceIdentifier: String? = nil
    ) {
        self.transport = transport
        self.maximumInputReportSize = maximumInputReportSize
        self.physicalDeviceIdentifier = physicalDeviceIdentifier
    }
}

/// Chooses which matched DualSense HID interface to open for touchpad reports.
///
/// A DualSense plugged in while also paired over Bluetooth enumerates more than
/// once, and only some of those interfaces carry the wide input report that
/// holds the touch point. Taking an arbitrary member of the matched set meant a
/// coin flip between a working pointer and one that silently never moves.
enum DualSenseHIDCandidatePolicy {
    enum SafeResolution: Equatable {
        case candidates([Int])
        case ambiguous
    }
    /// The touch point sits at byte 34–37 of the Bluetooth report, the later of
    /// the two layouts, so anything narrower than this cannot contain a
    /// contact no matter which report ID it uses.
    static let minimumInputReportSize = 38
    /// Full DualSense input report widths, by transport.
    static let usbInputReportSize = 64
    static let bluetoothInputReportSize = 78

    static func canCarryTouchReports(_ candidate: DualSenseHIDCandidate) -> Bool {
        candidate.maximumInputReportSize >= minimumInputReportSize
    }

    /// Plausible candidates, best first.
    ///
    /// Interfaces too narrow to hold a contact are dropped outright. The rest
    /// are ordered by whether they sit on the transport the controller is
    /// actually using, then by whether their report width matches a published
    /// DualSense layout. Equal candidates keep their incoming order, so the
    /// result never depends on how `IOHIDManagerCopyDevices` happened to hash
    /// its set.
    static func ordered(
        _ candidates: [DualSenseHIDCandidate],
        preferringUSB: Bool
    ) -> [DualSenseHIDCandidate] {
        orderedIndices(candidates, preferringUSB: preferringUSB).map { candidates[$0] }
    }

    /// The same ordering expressed as positions in `candidates`, for callers
    /// holding something alongside each description — an `IOHIDDevice`, say —
    /// that cannot be compared for equality.
    static func orderedIndices(
        _ candidates: [DualSenseHIDCandidate],
        preferringUSB: Bool
    ) -> [Int] {
        candidates
            .enumerated()
            .filter { canCarryTouchReports($0.element) }
            .sorted { left, right in
                let leftScore = score(left.element, preferringUSB: preferringUSB)
                let rightScore = score(right.element, preferringUSB: preferringUSB)
                if leftScore != rightScore { return leftScore > rightScore }
                return left.offset < right.offset
            }
            .map(\.offset)
    }

    /// Orders candidates without ever falling through to an interface that may
    /// belong to another physical controller.
    static func safelyOrderedIndices(
        _ candidates: [DualSenseHIDCandidate],
        preferringUSB: Bool
    ) -> SafeResolution {
        let ordered = orderedIndices(candidates, preferringUSB: preferringUSB)
        guard let first = ordered.first else { return .candidates([]) }
        let primaryTransport = transportKind(candidates[first].transport)
        let primary = ordered.filter {
            transportKind(candidates[$0].transport) == primaryTransport
        }
        guard !DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
            physicalIdentifiers: primary.map {
                candidates[$0].physicalDeviceIdentifier
            }
        ) else {
            return .ambiguous
        }

        // A fallback on another transport is safe only when both collections
        // publish the same physical identity. Otherwise the active transport's
        // candidates are the complete safe set.
        let primaryIdentifiers = Set(
            primary.compactMap { candidates[$0].physicalDeviceIdentifier }
        )
        let safeFallback: [Int]
        if primaryIdentifiers.count == 1, let identifier = primaryIdentifiers.first {
            safeFallback = ordered.filter {
                !primary.contains($0)
                    && candidates[$0].physicalDeviceIdentifier == identifier
            }
        } else {
            safeFallback = []
        }
        return .candidates(primary + safeFallback)
    }

    private static func score(
        _ candidate: DualSenseHIDCandidate,
        preferringUSB: Bool
    ) -> Int {
        transportRank(candidate.transport, preferringUSB: preferringUSB) * 2
            + sizeRank(candidate.maximumInputReportSize)
    }

    private static func transportRank(_ transport: String?, preferringUSB: Bool) -> Int {
        guard let transport else { return 0 }
        if transport.localizedCaseInsensitiveContains("USB") { return preferringUSB ? 2 : 1 }
        if transport.localizedCaseInsensitiveContains("Bluetooth") { return preferringUSB ? 1 : 2 }
        return 0
    }

    private static func transportKind(_ transport: String?) -> String {
        guard let transport else { return "unknown" }
        if transport.localizedCaseInsensitiveContains("USB") { return "usb" }
        if transport.localizedCaseInsensitiveContains("Bluetooth") { return "bluetooth" }
        return transport.lowercased()
    }

    private static func sizeRank(_ size: Int) -> Int {
        size == usbInputReportSize || size == bluetoothInputReportSize ? 1 : 0
    }
}
