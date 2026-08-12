import XCTest
@testable import ControllerBridge

final class DualSenseHIDCandidatePolicyTests: XCTestCase {
    private let usb = DualSenseHIDCandidate(
        transport: "USB",
        maximumInputReportSize: DualSenseHIDCandidatePolicy.usbInputReportSize
    )
    private let bluetooth = DualSenseHIDCandidate(
        transport: "Bluetooth",
        maximumInputReportSize: DualSenseHIDCandidatePolicy.bluetoothInputReportSize
    )
    /// The 10-byte Bluetooth compatibility report: matches on vendor and
    /// product but can never contain a touch point.
    private let narrow = DualSenseHIDCandidate(transport: "Bluetooth", maximumInputReportSize: 10)

    func testInterfacesTooNarrowForATouchPointAreRejected() {
        XCTAssertFalse(DualSenseHIDCandidatePolicy.canCarryTouchReports(narrow))
        XCTAssertTrue(DualSenseHIDCandidatePolicy.canCarryTouchReports(usb))
        XCTAssertTrue(DualSenseHIDCandidatePolicy.canCarryTouchReports(bluetooth))
    }

    func testNarrowInterfacesNeverBecomeCandidates() {
        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.ordered([narrow, usb], preferringUSB: true),
            [usb]
        )
        XCTAssertTrue(
            DualSenseHIDCandidatePolicy.ordered([narrow], preferringUSB: false).isEmpty
        )
    }

    func testTheActiveTransportIsPreferredWhenBothAreEnumerated() {
        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.ordered([bluetooth, usb], preferringUSB: true),
            [usb, bluetooth]
        )
        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.ordered([usb, bluetooth], preferringUSB: false),
            [bluetooth, usb]
        )
    }

    func testTheOtherTransportIsStillOfferedAsAFallback() {
        // Nothing is discarded for being on the wrong transport; the pointer
        // gets to try the second interface before downgrading to GameController.
        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.ordered([bluetooth], preferringUSB: true),
            [bluetooth]
        )
    }

    func testAKnownReportWidthOutranksAnUnrecognisedOneOnTheSameTransport() {
        let odd = DualSenseHIDCandidate(transport: "USB", maximumInputReportSize: 40)

        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.ordered([odd, usb], preferringUSB: true),
            [usb, odd]
        )
    }

    func testAnUnknownTransportRanksLastButIsNotDiscarded() {
        let unknown = DualSenseHIDCandidate(transport: nil, maximumInputReportSize: 64)

        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.ordered([unknown, bluetooth], preferringUSB: true),
            [bluetooth, unknown]
        )
    }

    func testEqualCandidatesKeepTheirIncomingOrder() {
        // `IOHIDManagerCopyDevices` returns an unordered set, so ties must not
        // resolve differently from one launch to the next.
        let first = DualSenseHIDCandidate(transport: "USB", maximumInputReportSize: 64)
        let second = DualSenseHIDCandidate(transport: "USB", maximumInputReportSize: 64)

        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.orderedIndices(
                [first, narrow, second],
                preferringUSB: true
            ),
            [0, 2]
        )
    }

    func testSafeOrderingRefusesTwoPhysicalControllersOnTheActiveTransport() {
        let first = DualSenseHIDCandidate(
            transport: "USB",
            maximumInputReportSize: 64,
            physicalDeviceIdentifier: "controller-a"
        )
        let second = DualSenseHIDCandidate(
            transport: "USB",
            maximumInputReportSize: 64,
            physicalDeviceIdentifier: "controller-b"
        )

        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.safelyOrderedIndices(
                [first, second],
                preferringUSB: true
            ),
            .ambiguous
        )
    }

    func testSafeOrderingAllowsSeveralCollectionsFromOnePhysicalController() {
        let first = DualSenseHIDCandidate(
            transport: "USB",
            maximumInputReportSize: 64,
            physicalDeviceIdentifier: "controller-a"
        )
        let second = DualSenseHIDCandidate(
            transport: "USB",
            maximumInputReportSize: 40,
            physicalDeviceIdentifier: "controller-a"
        )

        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.safelyOrderedIndices(
                [second, first],
                preferringUSB: true
            ),
            .candidates([1, 0])
        )
    }

    func testCrossTransportFallbackRequiresMatchingPhysicalIdentity() {
        let usb = DualSenseHIDCandidate(
            transport: "USB",
            maximumInputReportSize: 64,
            physicalDeviceIdentifier: "controller-a"
        )
        let sameControllerBluetooth = DualSenseHIDCandidate(
            transport: "Bluetooth",
            maximumInputReportSize: 78,
            physicalDeviceIdentifier: "controller-a"
        )
        let otherControllerBluetooth = DualSenseHIDCandidate(
            transport: "Bluetooth",
            maximumInputReportSize: 78,
            physicalDeviceIdentifier: "controller-b"
        )

        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.safelyOrderedIndices(
                [sameControllerBluetooth, usb],
                preferringUSB: true
            ),
            .candidates([1, 0])
        )
        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.safelyOrderedIndices(
                [otherControllerBluetooth, usb],
                preferringUSB: true
            ),
            .candidates([1])
        )
    }

    func testMultipleUnidentifiedCandidatesAreAmbiguous() {
        XCTAssertEqual(
            DualSenseHIDCandidatePolicy.safelyOrderedIndices(
                [
                    DualSenseHIDCandidate(transport: "USB", maximumInputReportSize: 64),
                    DualSenseHIDCandidate(transport: "USB", maximumInputReportSize: 64)
                ],
                preferringUSB: true
            ),
            .ambiguous
        )
    }
}
