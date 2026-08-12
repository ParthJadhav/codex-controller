import XCTest
@testable import ControllerBridge

final class ControllerInputPublishPolicyTests: XCTestCase {
    func testRestingStickDriftDoesNotPublish() {
        // A DualSense at rest jitters by a few thousandths on every axis. The
        // previous 0.001 threshold turned that into a continuous snapshot
        // stream across the bridge while nobody was touching the controller.
        XCTAssertFalse(
            ControllerInputPublishPolicy.shouldPublish(previousValue: 0, value: 0.004, edge: false)
        )
        XCTAssertFalse(
            ControllerInputPublishPolicy.shouldPublish(previousValue: 0.5, value: 0.505, edge: false)
        )
    }

    func testDeliberateAnalogMovementStillPublishes() {
        XCTAssertTrue(
            ControllerInputPublishPolicy.shouldPublish(previousValue: 0, value: 0.012, edge: false)
        )
        XCTAssertTrue(
            ControllerInputPublishPolicy.shouldPublish(previousValue: 0, value: 0.9, edge: false)
        )
        XCTAssertTrue(
            ControllerInputPublishPolicy.shouldPublish(previousValue: 0.9, value: 0, edge: false)
        )
    }

    func testPressEdgesAlwaysPublishRegardlessOfMagnitude() {
        // Gestures and mapped actions key off press/release edges, so these must
        // never be filtered out no matter how small the value change is.
        XCTAssertTrue(
            ControllerInputPublishPolicy.shouldPublish(previousValue: 0.5, value: 0.5, edge: true)
        )
        XCTAssertTrue(
            ControllerInputPublishPolicy.shouldPublish(previousValue: 0.5, value: 0.5001, edge: true)
        )
    }

    func testPressEdgesAreNeverBatched() {
        XCTAssertTrue(ControllerInputPublishPolicy.publishesImmediately(edge: true))
        XCTAssertFalse(ControllerInputPublishPolicy.publishesImmediately(edge: false))
    }

    func testEpsilonStaysBelowThePressAndVisualDeadZoneThresholds() {
        // Must remain well under the smallest release threshold (0.45) and the
        // renderer's 0.08 visual dead zone, or filtering would become visible.
        XCTAssertLessThan(ControllerInputPublishPolicy.analogEpsilon, 0.08)
        XCTAssertGreaterThan(ControllerInputPublishPolicy.analogEpsilon, 0)
    }
}
