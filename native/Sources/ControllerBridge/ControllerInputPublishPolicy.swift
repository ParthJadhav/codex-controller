import Foundation

/// Decides which controller input changes are worth sending to the renderer,
/// and which of those may be batched.
///
/// A resting DualSense still reports continuous micro-movement on both sticks
/// and both triggers. Publishing every one of those produced a full controller
/// snapshot per axis per sample — hundreds of JSON messages a second across the
/// bridge while nobody was touching the controller.
enum ControllerInputPublishPolicy {
    /// Minimum analog movement worth reporting. Well above resting drift, well
    /// below the 0.45–0.75 press thresholds and the renderer's 0.08 visual dead
    /// zone, so no observable behaviour changes.
    static let analogEpsilon: Float = 0.012

    /// `edge` is a press/release transition.
    static func shouldPublish(previousValue: Float, value: Float, edge: Bool) -> Bool {
        if edge { return true }
        return abs(value - previousValue) >= analogEpsilon
    }

    /// Press and release edges drive gestures and mapped actions, so they are
    /// never batched. Analog motion only moves the on-screen visualisation and
    /// is coalesced into one snapshot per run-loop turn.
    static func publishesImmediately(edge: Bool) -> Bool {
        edge
    }
}
