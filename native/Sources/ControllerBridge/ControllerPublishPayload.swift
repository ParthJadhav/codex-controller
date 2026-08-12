import Foundation

/// The controller facts the renderer needs, lifted out of `GCController` so the
/// published shape can be asserted without hardware.
struct ControllerDescription {
    let id: String
    let name: String
    let productCategory: String
    let transport: String
    /// `nil` when the controller has no battery reading to give.
    let batteryLevel: Float?
    let supportsLight: Bool
    let supportsHaptics: Bool
}

/// What the touchpad pointer says about itself in the same snapshot.
struct TouchpadPointerDescription {
    let enabled: Bool
    let status: String
    let diagnostics: [String: Any]
}

/// Builds the `controller` event payload.
///
/// The renderer reads this shape on every input sample, so its keys are the
/// bridge's contract with it — including the ones the disconnected snapshot has
/// to keep carrying so no reader has to special-case an absent controller.
enum ControllerPublishPayload {
    /// Stands in for the vendor name before any controller has been seen.
    static let placeholderName = "DualSense Wireless Controller"

    static func make(
        controller: ControllerDescription?,
        touchpad: TouchpadPointerDescription,
        inputSuspended: Bool,
        capabilities: [String],
        activeValues: [String: Float],
        lastInput: String?,
        lastPressed: Bool?
    ) -> [String: Any] {
        guard let controller else {
            return [
                "connected": false,
                "id": "",
                "name": placeholderName,
                "productCategory": "DualSense",
                "transport": "Unknown",
                "batteryLevel": NSNull(),
                "supportsLight": false,
                "supportsHaptics": false,
                "touchpadPointerEnabled": touchpad.enabled,
                // The pointer's own status describes a binding that cannot
                // exist yet; with no controller the renderer needs to hear
                // about the controller instead.
                "touchpadPointerStatus": touchpad.enabled ? "disconnected" : "disabled",
                "touchpadPointerDiagnostics": touchpad.diagnostics,
                "inputSuspended": inputSuspended,
                "capabilities": [String](),
                "activeValues": [String: Float]()
            ]
        }
        var payload: [String: Any] = [
            "connected": true,
            "id": controller.id,
            "name": controller.name,
            "productCategory": controller.productCategory,
            "transport": controller.transport,
            "batteryLevel": controller.batteryLevel.map { $0 as Any } ?? NSNull(),
            "supportsLight": controller.supportsLight,
            "supportsHaptics": controller.supportsHaptics,
            "touchpadPointerEnabled": touchpad.enabled,
            "touchpadPointerStatus": touchpad.status,
            "touchpadPointerDiagnostics": touchpad.diagnostics,
            "inputSuspended": inputSuspended,
            "capabilities": capabilities,
            "activeValues": activeValues
        ]
        // Edge metadata describes this publication only, so it is present only
        // when this snapshot is the one carrying the press or the release.
        if let lastInput { payload["lastInput"] = lastInput }
        if let lastPressed { payload["lastPressed"] = lastPressed }
        return payload
    }
}
