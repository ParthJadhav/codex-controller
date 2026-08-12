import IOKit.hid
import XCTest
@testable import ControllerBridge

final class DualSenseHIDIdentityTests: XCTestCase {
    func testMatchingDictionariesCoverEveryProductOnSonysVendorID() {
        let dictionaries = DualSenseHIDIdentity.matchingDictionaries

        XCTAssertEqual(dictionaries.count, DualSenseHIDIdentity.productIDs.count)
        XCTAssertEqual(
            dictionaries.compactMap { $0[kIOHIDProductIDKey] as? Int },
            DualSenseHIDIdentity.productIDs
        )
        XCTAssertTrue(dictionaries.allSatisfy {
            $0[kIOHIDVendorIDKey] as? Int == DualSenseHIDIdentity.vendorID
        })
    }

    func testSingleMatchedInterfaceNamesItsOwnTransport() {
        XCTAssertEqual(transportName(["USB"], attachedToDevice: false), "USB")
        XCTAssertEqual(transportName(["Bluetooth"], attachedToDevice: true), "Bluetooth")
    }

    func testTransportMatchIsCaseInsensitive() {
        XCTAssertEqual(transportName(["usb"], attachedToDevice: false), "USB")
        XCTAssertEqual(transportName(["BLUETOOTH"], attachedToDevice: true), "Bluetooth")
    }

    /// A controller plugged in while also paired answers on both interfaces,
    /// and `IOHIDManagerCopyDevices` returns them in hash order — so the tie is
    /// broken by the controller, not by whichever the set happened to yield.
    func testControllerBreaksTheTieWhenBothTransportsAnswer() {
        XCTAssertEqual(transportName(["Bluetooth", "USB"], attachedToDevice: true), "USB")
        XCTAssertEqual(transportName(["USB", "Bluetooth"], attachedToDevice: true), "USB")
        XCTAssertEqual(transportName(["USB", "Bluetooth"], attachedToDevice: false), "Bluetooth")
    }

    func testNoMatchedInterfaceFallsBackToTheAttachmentState() {
        XCTAssertEqual(transportName([], attachedToDevice: true), "USB")
        XCTAssertEqual(transportName([], attachedToDevice: false), "Bluetooth")
    }

    func testUnrecognisedTransportFallsBackToTheAttachmentState() {
        XCTAssertEqual(transportName(["SPI"], attachedToDevice: true), "USB")
        XCTAssertEqual(transportName(["SPI"], attachedToDevice: false), "Bluetooth")
    }

    func testPhysicalIdentityPrefersUniqueIDThenSerialThenLocation() {
        XCTAssertEqual(
            DualSenseHIDIdentity.physicalDeviceIdentifier(
                physicalUniqueID: "Controller-A",
                serialNumber: "Serial-B",
                locationID: 42
            ),
            "physical:controller-a"
        )
        XCTAssertEqual(
            DualSenseHIDIdentity.physicalDeviceIdentifier(
                physicalUniqueID: nil,
                serialNumber: " Serial-B ",
                locationID: 42
            ),
            "serial:serial-b"
        )
        XCTAssertEqual(
            DualSenseHIDIdentity.physicalDeviceIdentifier(
                physicalUniqueID: nil,
                serialNumber: "",
                locationID: 42
            ),
            "location:42"
        )
    }

    func testMissingPhysicalIdentityStaysUnknown() {
        XCTAssertNil(
            DualSenseHIDIdentity.physicalDeviceIdentifier(
                physicalUniqueID: nil,
                serialNumber: " ",
                locationID: nil
            )
        )
    }

    private func transportName(_ transports: [String], attachedToDevice: Bool) -> String {
        DualSenseHIDIdentity.transportName(
            fromMatchedTransports: transports,
            attachedToDevice: attachedToDevice
        )
    }
}
