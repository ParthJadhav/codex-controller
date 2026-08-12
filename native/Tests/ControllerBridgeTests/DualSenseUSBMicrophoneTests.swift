import CoreAudio
import XCTest
@testable import ControllerBridge

final class DualSenseUSBMicrophoneTests: XCTestCase {
    func testAcceptsTwoChannelUSBInput() {
        XCTAssertTrue(
            DualSenseUSBMicrophone.isCompatibleInput(
                name: "DualSense Wireless Controller",
                transportType: kAudioDeviceTransportTypeUSB,
                channelCount: 2
            )
        )
    }

    func testRejectsBluetoothAndSingleChannelInput() {
        XCTAssertFalse(
            DualSenseUSBMicrophone.isCompatibleInput(
                name: "DualSense Wireless Controller",
                transportType: kAudioDeviceTransportTypeBluetooth,
                channelCount: 2
            )
        )
        XCTAssertFalse(
            DualSenseUSBMicrophone.isCompatibleInput(
                name: "DualSense Wireless Controller",
                transportType: kAudioDeviceTransportTypeUSB,
                channelCount: 1
            )
        )
    }
}
