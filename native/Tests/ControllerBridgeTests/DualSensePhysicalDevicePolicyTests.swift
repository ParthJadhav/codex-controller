import XCTest
@testable import ControllerBridge

final class DualSensePhysicalDevicePolicyTests: XCTestCase {
    func testSeveralResourcesWithOneStableIdentityAreOnePhysicalController() {
        XCTAssertFalse(
            DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
                physicalIdentifiers: ["controller-a", "controller-a"]
            )
        )
    }

    func testDistinctPhysicalIdentitiesAreAmbiguous() {
        XCTAssertTrue(
            DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
                physicalIdentifiers: ["controller-a", "controller-b"]
            )
        )
    }

    func testSeveralUnidentifiableResourcesFailClosed() {
        XCTAssertTrue(
            DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
                physicalIdentifiers: [nil, nil]
            )
        )
        XCTAssertTrue(
            DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
                physicalIdentifiers: ["controller-a", nil]
            )
        )
    }

    func testOneResourceDoesNotNeedAnIdentifier() {
        XCTAssertFalse(
            DualSensePhysicalDevicePolicy.resourcesAreAmbiguous(
                physicalIdentifiers: [nil]
            )
        )
    }

    func testMoreThanOneGameControllerMakesSelectionAmbiguous() {
        XCTAssertFalse(
            DualSensePhysicalDevicePolicy.controllerSelectionIsAmbiguous(controllerCount: 1)
        )
        XCTAssertTrue(
            DualSensePhysicalDevicePolicy.controllerSelectionIsAmbiguous(controllerCount: 2)
        )
    }
}
