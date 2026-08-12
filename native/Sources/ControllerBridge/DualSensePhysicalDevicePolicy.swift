import Foundation

/// Safety policy for APIs that expose several interfaces but no reliable link
/// back to the selected `GCController`.
///
/// When all interfaces publish the same physical identifier they are merely
/// collections belonging to one controller. Different or missing identifiers
/// make a multi-interface choice unsafe, so callers refuse it rather than mix
/// touch/audio resources from different physical controllers.
enum DualSensePhysicalDevicePolicy {
    static let ambiguityReason =
        "Multiple DualSense controllers are connected; disconnect the others and try again."

    static func controllerSelectionIsAmbiguous(controllerCount: Int) -> Bool {
        controllerCount > 1
    }

    static func resourcesAreAmbiguous(physicalIdentifiers: [String?]) -> Bool {
        guard physicalIdentifiers.count > 1 else { return false }
        let known = physicalIdentifiers.compactMap { identifier -> String? in
            guard let identifier else { return nil }
            let value = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : value.lowercased()
        }
        guard known.count == physicalIdentifiers.count else { return true }
        return Set(known).count > 1
    }
}
