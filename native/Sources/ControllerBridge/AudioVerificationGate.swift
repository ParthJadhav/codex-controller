import Foundation

/// Serialises the multi-second audio verifications.
///
/// Each check takes over the controller's HID reports or the machine's default
/// audio device for seconds at a time. Two of them running at once fight over
/// the same hardware and then report each other's damage as their own failure,
/// so the second caller is turned away with a message naming what it is waiting
/// for instead of being allowed to interleave.
struct AudioVerificationGate {
    /// What the in-flight check calls itself, or `nil` when the gate is free.
    private(set) var activeLabel: String?

    var isBusy: Bool { activeLabel != nil }

    /// Claims the gate, or returns the failure message the caller should report.
    mutating func begin(_ label: String) -> String? {
        if let activeLabel { return Self.busyMessage(activeLabel) }
        activeLabel = label
        return nil
    }

    mutating func end() {
        activeLabel = nil
    }

    static func busyMessage(_ activeLabel: String) -> String {
        "\(activeLabel) is still running. Wait for it to finish, then try again."
    }
}
