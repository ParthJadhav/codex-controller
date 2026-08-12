import Foundation

/// Turns an analog magnitude into a press, with the gap that keeps a held input
/// from chattering.
///
/// A stick resting right at the threshold crosses it dozens of times a second.
/// Releasing at a lower value than it takes to press means that tremor can no
/// longer machine-gun the action mapped to the direction.
enum ControllerPressPolicy {
    /// Triggers travel further and rest higher than sticks and the D-pad, so
    /// they carry their own pair of thresholds.
    static let triggerInputs: Set<String> = ["leftTrigger", "rightTrigger"]

    static func isTrigger(_ input: String) -> Bool {
        triggerInputs.contains(input)
    }

    /// `enter` presses, `release` un-presses, and the band between them holds
    /// whatever state the input already had.
    static func isPressed(
        wasPressed: Bool,
        value: Float,
        enter: Float,
        release: Float
    ) -> Bool {
        wasPressed ? value > release : value >= enter
    }

    /// Analog values leave the bridge in 0…1 whatever the hardware reports.
    static func clamped(_ value: Float) -> Float {
        min(max(value, 0), 1)
    }
}
