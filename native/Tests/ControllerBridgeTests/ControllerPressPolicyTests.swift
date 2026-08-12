import XCTest
@testable import ControllerBridge

final class ControllerPressPolicyTests: XCTestCase {
    private let enter: Float = 0.65
    private let release: Float = 0.45

    func testPressesAtTheEnterThreshold() {
        XCTAssertTrue(isPressed(wasPressed: false, value: 0.65))
    }

    func testDoesNotPressJustBelowTheEnterThreshold() {
        XCTAssertFalse(isPressed(wasPressed: false, value: 0.649))
    }

    /// The band between the thresholds is what stops a resting stick from
    /// machine-gunning the action mapped to its direction.
    func testHoldsThroughTheBandBetweenThresholds() {
        XCTAssertTrue(isPressed(wasPressed: true, value: 0.5))
        XCTAssertFalse(isPressed(wasPressed: false, value: 0.5))
    }

    func testReleasesAtTheReleaseThreshold() {
        XCTAssertFalse(isPressed(wasPressed: true, value: 0.45))
    }

    func testStaysPressedJustAboveTheReleaseThreshold() {
        XCTAssertTrue(isPressed(wasPressed: true, value: 0.451))
    }

    func testReleasesAtRest() {
        XCTAssertFalse(isPressed(wasPressed: true, value: 0))
    }

    func testTriggersAreClassifiedApartFromSticksAndTheDPad() {
        XCTAssertTrue(ControllerPressPolicy.isTrigger("leftTrigger"))
        XCTAssertTrue(ControllerPressPolicy.isTrigger("rightTrigger"))
        XCTAssertFalse(ControllerPressPolicy.isTrigger("leftStickUp"))
        XCTAssertFalse(ControllerPressPolicy.isTrigger("dpadUp"))
        XCTAssertFalse(ControllerPressPolicy.isTrigger("leftShoulder"))
    }

    func testClampingKeepsAnalogValuesInRange() {
        XCTAssertEqual(ControllerPressPolicy.clamped(-0.4), 0)
        XCTAssertEqual(ControllerPressPolicy.clamped(0.4), 0.4)
        XCTAssertEqual(ControllerPressPolicy.clamped(1.8), 1)
    }

    private func isPressed(wasPressed: Bool, value: Float) -> Bool {
        ControllerPressPolicy.isPressed(
            wasPressed: wasPressed,
            value: value,
            enter: enter,
            release: release
        )
    }
}
