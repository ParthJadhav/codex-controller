import CoreAudio
import XCTest
@testable import ControllerBridge

final class DualSenseUSBSpeakerTests: XCTestCase {
    func testAcceptsFourChannelUSBOutput() {
        XCTAssertTrue(
            DualSenseUSBSpeaker.isCompatibleOutput(
                name: "DualSense Wireless Controller",
                transportType: kAudioDeviceTransportTypeUSB,
                channelCount: 4
            )
        )
    }

    func testRejectsBluetoothAndStereoOnlyRoutes() {
        XCTAssertFalse(
            DualSenseUSBSpeaker.isCompatibleOutput(
                name: "DualSense Wireless Controller",
                transportType: kAudioDeviceTransportTypeBluetooth,
                channelCount: 4
            )
        )
        XCTAssertFalse(
            DualSenseUSBSpeaker.isCompatibleOutput(
                name: "DualSense Wireless Controller",
                transportType: kAudioDeviceTransportTypeUSB,
                channelCount: 2
            )
        )
    }
}
