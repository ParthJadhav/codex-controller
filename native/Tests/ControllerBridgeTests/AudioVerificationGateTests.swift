import XCTest
@testable import ControllerBridge

final class AudioVerificationGateTests: XCTestCase {
    func testFirstCallerClaimsTheGate() {
        var gate = AudioVerificationGate()

        XCTAssertNil(gate.begin("The wired DualSense speaker check"))
        XCTAssertTrue(gate.isBusy)
        XCTAssertEqual(gate.activeLabel, "The wired DualSense speaker check")
    }

    func testSecondCallerIsRefusedAndNamesTheRunningCheck() {
        var gate = AudioVerificationGate()
        XCTAssertNil(gate.begin("The wired DualSense speaker check"))

        let busy = gate.begin("The DualSense Bluetooth microphone check")

        XCTAssertEqual(
            busy,
            "The wired DualSense speaker check is still running. "
                + "Wait for it to finish, then try again."
        )
    }

    /// The refused caller must not have taken the gate over on its way out.
    func testRefusalLeavesTheRunningCheckInPlace() {
        var gate = AudioVerificationGate()
        XCTAssertNil(gate.begin("The wired DualSense speaker check"))

        _ = gate.begin("The DualSense Bluetooth microphone check")

        XCTAssertEqual(gate.activeLabel, "The wired DualSense speaker check")
    }

    func testGateReopensAfterTheRunningCheckEnds() {
        var gate = AudioVerificationGate()
        XCTAssertNil(gate.begin("The wired DualSense speaker check"))

        gate.end()

        XCTAssertFalse(gate.isBusy)
        XCTAssertNil(gate.begin("The DualSense Bluetooth microphone check"))
    }
}
