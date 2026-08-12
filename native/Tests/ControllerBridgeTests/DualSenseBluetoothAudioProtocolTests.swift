import XCTest
@testable import ControllerBridge

final class DualSenseBluetoothAudioProtocolTests: XCTestCase {
    func testMicrophoneEnableAndDisableReportsAreBoundedAndChecksummed() {
        let enabled = DualSenseBluetoothAudioProtocol.microphoneState(enabled: true)
        let disabled = DualSenseBluetoothAudioProtocol.microphoneState(enabled: false)

        XCTAssertEqual(enabled.count, 142)
        XCTAssertEqual(enabled[0], 0x32)
        XCTAssertEqual(enabled[4 + 6], 0x40)
        XCTAssertEqual(enabled[4 + 7], 0x01)
        XCTAssertEqual(enabled[4 + 9], 0x00)
        XCTAssertEqual(disabled[4 + 6], 0x00)
        XCTAssertEqual(disabled[4 + 9], 0x10)
        XCTAssertTrue(hasValidCRC(enabled))
        XCTAssertTrue(hasValidCRC(disabled))
    }

    func testDuplexClockUsesMicBitAndTwoFixedOpusFrames() {
        let silence = Array(repeating: UInt8(0xa5), count: 200)
        let report = DualSenseBluetoothAudioProtocol.clock(
            sequence: 3,
            counter: 8,
            silence: silence,
            microphoneEnabled: true
        )

        XCTAssertEqual(report.count, 547)
        XCTAssertEqual(report[0], 0x39)
        XCTAssertEqual(report[1], 0x30)
        XCTAssertEqual(report[4], 0x7f)
        XCTAssertEqual(report[9], 8)
        XCTAssertEqual(Array(report[142..<342]), silence)
        XCTAssertEqual(Array(report[342..<542]), silence)
        XCTAssertTrue(hasValidCRC(report))
    }

    func testMicrophonePayloadRejectsNormalGamepadReports() {
        var normal = Array(repeating: UInt8(0), count: 78)
        normal[0] = 0x31
        normal[3] = 0xd4
        XCTAssertNil(DualSenseBluetoothAudioProtocol.microphonePayload(from: normal))

        var microphone = normal
        microphone[1] = 0x02
        XCTAssertEqual(
            DualSenseBluetoothAudioProtocol.microphonePayload(from: microphone)?.count,
            71
        )
    }

    private func hasValidCRC(_ report: [UInt8]) -> Bool {
        let offset = report.count - 4
        let expected = DualSenseBluetoothAudioProtocol.crc32(report[..<offset])
        let actual = UInt32(report[offset])
            | (UInt32(report[offset + 1]) << 8)
            | (UInt32(report[offset + 2]) << 16)
            | (UInt32(report[offset + 3]) << 24)
        return expected == actual
    }
}

@MainActor
final class DualSenseBluetoothMicrophoneStartupTests: XCTestCase {
    func testDecoderFailureDestroysTheAlreadyCreatedEncoderExactlyOnce() {
        let encoder = OpaquePointer(bitPattern: 0x11)!
        var destroyed: [OpaquePointer] = []

        let pair = DualSenseBluetoothMicrophone.acquireCodecPair(
            createEncoder: { encoder },
            createDecoder: { nil },
            destroyEncoder: { destroyed.append($0) }
        )

        XCTAssertNil(pair)
        XCTAssertEqual(destroyed, [encoder])
    }

    func testEncoderFailureDoesNotTryDecoderOrDestroyAnything() {
        var decoderCalls = 0
        var destroyed: [OpaquePointer] = []

        let pair = DualSenseBluetoothMicrophone.acquireCodecPair(
            createEncoder: { nil },
            createDecoder: {
                decoderCalls += 1
                return OpaquePointer(bitPattern: 0x12)
            },
            destroyEncoder: { destroyed.append($0) }
        )

        XCTAssertNil(pair)
        XCTAssertEqual(decoderCalls, 0)
        XCTAssertTrue(destroyed.isEmpty)
    }

    func testManagerOpenFailureClosesWithoutRegisteringOrScheduling() {
        var effects: [String] = []

        let prepared = DualSenseBluetoothMicrophone.prepareHIDManager(
            7,
            open: { _ in
                effects.append("open")
                return false
            },
            close: { _ in effects.append("close") },
            register: { _ in effects.append("register") },
            schedule: { _ in effects.append("schedule") }
        )

        XCTAssertFalse(prepared)
        XCTAssertEqual(effects, ["open", "close"])
    }

    func testPreparedManagerTransfersOwnershipWithoutEarlyClose() {
        var effects: [String] = []

        let prepared = DualSenseBluetoothMicrophone.prepareHIDManager(
            8,
            open: { _ in
                effects.append("open")
                return true
            },
            close: { _ in effects.append("close") },
            register: { _ in effects.append("register") },
            schedule: { _ in effects.append("schedule") }
        )

        XCTAssertTrue(prepared)
        XCTAssertEqual(effects, ["open", "register", "schedule"])
    }
}
