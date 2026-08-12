import CoreAudio
import XCTest
@testable import ControllerBridge

final class ControllerAudioRoutePolicyTests: XCTestCase {
    func testWiredDualSenseIsRecognisedByNameAndTransport() {
        XCTAssertTrue(
            ControllerAudioRoutePolicy.isWiredDualSenseRoute(
                route(name: "DualSense Wireless Controller", channelCount: 4)
            )
        )
    }

    func testNameMatchIsCaseInsensitive() {
        XCTAssertTrue(
            ControllerAudioRoutePolicy.isWiredDualSenseRoute(route(name: "dualsense edge"))
        )
    }

    /// The Bluetooth-paired controller exposes no CoreAudio route worth using;
    /// only the cable carries one.
    func testBluetoothTransportIsNotAWiredRoute() {
        XCTAssertFalse(
            ControllerAudioRoutePolicy.isWiredDualSenseRoute(
                route(
                    name: "DualSense Wireless Controller",
                    transportType: kAudioDeviceTransportTypeBluetooth
                )
            )
        )
    }

    func testOtherUSBAudioDevicesAreNotDualSenseRoutes() {
        XCTAssertFalse(ControllerAudioRoutePolicy.isWiredDualSenseRoute(route(name: "USB Headset")))
    }

    func testFourChannelUSBOutputIsTheBuiltInSpeaker() {
        XCTAssertEqual(
            ControllerAudioRoutePolicy.controllerAudioKind(
                inputs: [route(name: "DualSense Wireless Controller", channelCount: 1)],
                outputs: [route(name: "DualSense Wireless Controller", channelCount: 4)]
            ),
            "usbBuiltIn"
        )
    }

    /// A narrower USB output is the 3.5mm jack, not the controller's speaker —
    /// pointing the speaker test at it would test hardware that cannot run it.
    func testNarrowerUSBOutputIsTheHeadsetJack() {
        XCTAssertEqual(
            ControllerAudioRoutePolicy.controllerAudioKind(
                inputs: [],
                outputs: [route(name: "DualSense Wireless Controller", channelCount: 2)]
            ),
            "wiredHeadset"
        )
    }

    func testInputOnlyDualSenseRouteIsStillAWiredHeadset() {
        XCTAssertEqual(
            ControllerAudioRoutePolicy.controllerAudioKind(
                inputs: [route(name: "DualSense Wireless Controller", channelCount: 1)],
                outputs: [route(name: "MacBook Pro Speakers", channelCount: 2)]
            ),
            "wiredHeadset"
        )
    }

    func testNoDualSenseRouteAtAllIsNone() {
        XCTAssertEqual(
            ControllerAudioRoutePolicy.controllerAudioKind(
                inputs: [route(name: "MacBook Pro Microphone", channelCount: 1)],
                outputs: [route(name: "MacBook Pro Speakers", channelCount: 2)]
            ),
            "none"
        )
    }

    func testNoAudioDevicesAtAllIsNone() {
        XCTAssertEqual(
            ControllerAudioRoutePolicy.controllerAudioKind(inputs: [], outputs: []),
            "none"
        )
    }

    /// Both shapes enumerate at once on some machines; the speaker is the
    /// stronger claim and has to win regardless of the order they arrive in.
    func testBuiltInSpeakerWinsOverAHeadsetRouteInTheSameList() {
        XCTAssertEqual(
            ControllerAudioRoutePolicy.controllerAudioKind(
                inputs: [],
                outputs: [
                    route(name: "DualSense Wireless Controller", channelCount: 4),
                    route(name: "DualSense Wireless Controller", channelCount: 2)
                ]
            ),
            "usbBuiltIn"
        )
    }

    private func route(
        name: String,
        transportType: UInt32 = kAudioDeviceTransportTypeUSB,
        channelCount: UInt32 = 2
    ) -> ControllerAudioRoute {
        ControllerAudioRoute(
            name: name,
            transportType: transportType,
            channelCount: channelCount
        )
    }
}
