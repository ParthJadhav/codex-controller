import Foundation

/// Describes the publications needed when the selected physical controller
/// changes.
///
/// A direct connected-A → connected-B snapshot is not enough: the renderer
/// would reasonably keep A's held gestures alive because it never observed a
/// disconnect. A short reset boundary makes it release A synchronously before
/// accepting any input from B, while ordinary connect/disconnect transitions
/// still publish exactly one snapshot.
enum ControllerSelectionTransitionPolicy {
    enum Publication: Equatable {
        case reset
        case selection
    }

    static func publications(
        previousConnected: Bool,
        nextConnected: Bool
    ) -> [Publication] {
        previousConnected && nextConnected
            ? [.reset, .selection]
            : [.selection]
    }
}
