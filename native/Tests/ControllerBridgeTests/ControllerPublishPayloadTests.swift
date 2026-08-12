import XCTest
@testable import ControllerBridge

final class ControllerPublishPayloadTests: XCTestCase {
    func testConnectedSnapshotCarriesTheControllerFacts() {
        let payload = make(controller: description())

        XCTAssertEqual(payload["connected"] as? Bool, true)
        XCTAssertEqual(payload["id"] as? String, "42")
        XCTAssertEqual(payload["name"] as? String, "DualSense Wireless Controller")
        XCTAssertEqual(payload["productCategory"] as? String, "DualSense")
        XCTAssertEqual(payload["transport"] as? String, "Bluetooth")
        XCTAssertEqual(payload["batteryLevel"] as? Float, 0.75)
        XCTAssertEqual(payload["supportsLight"] as? Bool, true)
        XCTAssertEqual(payload["supportsHaptics"] as? Bool, true)
    }

    func testConnectedSnapshotCarriesInputState() {
        let payload = make(
            controller: description(),
            capabilities: ["buttonA", "dpadUp"],
            activeValues: ["buttonA": 1, "leftTrigger": 0.5],
            lastInput: "buttonA",
            lastPressed: true
        )

        XCTAssertEqual(payload["capabilities"] as? [String], ["buttonA", "dpadUp"])
        XCTAssertEqual(
            payload["activeValues"] as? [String: Float],
            ["buttonA": 1, "leftTrigger": 0.5]
        )
        XCTAssertEqual(payload["inputSuspended"] as? Bool, false)
        XCTAssertEqual(payload["lastInput"] as? String, "buttonA")
        XCTAssertEqual(payload["lastPressed"] as? Bool, true)
    }

    /// Edge metadata belongs to the publication that carries it; an analog
    /// snapshot must not replay the last press the renderer already saw.
    func testEdgeMetadataIsAbsentWhenThereIsNoEdge() {
        let payload = make(controller: description(), lastInput: nil, lastPressed: nil)

        XCTAssertNil(payload["lastInput"])
        XCTAssertNil(payload["lastPressed"])
    }

    func testReleaseEdgeIsPublishedAsFalseRatherThanOmitted() {
        let payload = make(controller: description(), lastInput: "buttonA", lastPressed: false)

        XCTAssertEqual(payload["lastPressed"] as? Bool, false)
    }

    func testAbsentBatteryIsPublishedAsNull() {
        let payload = make(controller: description(batteryLevel: nil))

        XCTAssertTrue(payload["batteryLevel"] is NSNull)
    }

    func testTouchpadStateTravelsWithTheController() {
        let payload = make(
            controller: description(),
            touchpad: TouchpadPointerDescription(
                enabled: true,
                status: "ready",
                diagnostics: ["source": "dualsenseHID"]
            )
        )

        XCTAssertEqual(payload["touchpadPointerEnabled"] as? Bool, true)
        XCTAssertEqual(payload["touchpadPointerStatus"] as? String, "ready")
        XCTAssertEqual(
            (payload["touchpadPointerDiagnostics"] as? [String: Any])?["source"] as? String,
            "dualsenseHID"
        )
    }

    func testDisconnectedSnapshotKeepsEveryKeyTheRendererReads() {
        let payload = make(controller: nil)

        XCTAssertEqual(payload["connected"] as? Bool, false)
        XCTAssertEqual(payload["id"] as? String, "")
        XCTAssertEqual(payload["name"] as? String, "DualSense Wireless Controller")
        XCTAssertEqual(payload["productCategory"] as? String, "DualSense")
        XCTAssertEqual(payload["transport"] as? String, "Unknown")
        XCTAssertTrue(payload["batteryLevel"] is NSNull)
        XCTAssertEqual(payload["supportsLight"] as? Bool, false)
        XCTAssertEqual(payload["supportsHaptics"] as? Bool, false)
        XCTAssertEqual(payload["capabilities"] as? [String], [])
        XCTAssertEqual(payload["activeValues"] as? [String: Float], [:])
    }

    /// With no controller the pointer cannot be bound, so its own "unavailable"
    /// would describe the wrong problem.
    func testDisconnectedPointerStatusNamesTheMissingController() {
        let enabled = make(
            controller: nil,
            touchpad: TouchpadPointerDescription(
                enabled: true,
                status: "unavailable",
                diagnostics: [:]
            )
        )
        let disabled = make(
            controller: nil,
            touchpad: TouchpadPointerDescription(
                enabled: false,
                status: "unavailable",
                diagnostics: [:]
            )
        )

        XCTAssertEqual(enabled["touchpadPointerStatus"] as? String, "disconnected")
        XCTAssertEqual(disabled["touchpadPointerStatus"] as? String, "disabled")
    }

    func testDisconnectedSnapshotDropsStaleInputState() {
        let payload = make(
            controller: nil,
            capabilities: ["buttonA"],
            activeValues: ["buttonA": 1],
            lastInput: "buttonA",
            lastPressed: true
        )

        XCTAssertEqual(payload["capabilities"] as? [String], [])
        XCTAssertEqual(payload["activeValues"] as? [String: Float], [:])
        XCTAssertNil(payload["lastInput"])
        XCTAssertNil(payload["lastPressed"])
    }

    func testSuspensionIsReportedWhileTheMicrophoneCheckHoldsTheController() {
        let payload = make(controller: description(), inputSuspended: true)

        XCTAssertEqual(payload["inputSuspended"] as? Bool, true)
    }

    func testPayloadIsSerialisableAsJSON() {
        let payload = make(controller: description())

        XCTAssertTrue(JSONSerialization.isValidJSONObject(payload))
    }

    private func description(batteryLevel: Float? = 0.75) -> ControllerDescription {
        ControllerDescription(
            id: "42",
            name: "DualSense Wireless Controller",
            productCategory: "DualSense",
            transport: "Bluetooth",
            batteryLevel: batteryLevel,
            supportsLight: true,
            supportsHaptics: true
        )
    }

    private func make(
        controller: ControllerDescription?,
        touchpad: TouchpadPointerDescription = TouchpadPointerDescription(
            enabled: false,
            status: "disabled",
            diagnostics: [:]
        ),
        inputSuspended: Bool = false,
        capabilities: [String] = [],
        activeValues: [String: Float] = [:],
        lastInput: String? = nil,
        lastPressed: Bool? = nil
    ) -> [String: Any] {
        ControllerPublishPayload.make(
            controller: controller,
            touchpad: touchpad,
            inputSuspended: inputSuspended,
            capabilities: capabilities,
            activeValues: activeValues,
            lastInput: lastInput,
            lastPressed: lastPressed
        )
    }
}
