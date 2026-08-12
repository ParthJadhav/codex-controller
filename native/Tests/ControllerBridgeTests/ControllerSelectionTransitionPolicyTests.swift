import XCTest
@testable import ControllerBridge

final class ControllerSelectionTransitionPolicyTests: XCTestCase {
    func testConnectedControllerReplacementPublishesOneResetBeforeSelection() {
        XCTAssertEqual(
            ControllerSelectionTransitionPolicy.publications(
                previousConnected: true,
                nextConnected: true
            ),
            [.reset, .selection]
        )
    }

    func testInitialConnectionNeedsNoSyntheticReset() {
        XCTAssertEqual(
            ControllerSelectionTransitionPolicy.publications(
                previousConnected: false,
                nextConnected: true
            ),
            [.selection]
        )
    }

    func testFullDisconnectPublishesOnlyItsRealDisconnectedSnapshot() {
        XCTAssertEqual(
            ControllerSelectionTransitionPolicy.publications(
                previousConnected: true,
                nextConnected: false
            ),
            [.selection]
        )
    }
}
