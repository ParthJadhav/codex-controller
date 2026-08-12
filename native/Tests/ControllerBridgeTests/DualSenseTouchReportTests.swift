import XCTest
@testable import ControllerBridge

final class DualSenseTouchReportTests: XCTestCase {
    func testDecodesBluetoothPrimaryContactAndFullSurfaceCoordinates() {
        let report = bluetoothReport(contact: 7, x: 1_919, y: 1_079)

        XCTAssertEqual(
            DualSenseTouchReport.decode(
                reportID: DualSenseTouchReport.bluetoothReportID,
                bytes: report
            ),
            DualSenseTouchSample(isActive: true, x: 1_919, y: 1_079)
        )
    }

    func testInactiveContactIgnoresInvalidCoordinateBytes() {
        let report = bluetoothReport(contact: 0x80, x: 4_095, y: 4_095)

        XCTAssertEqual(
            DualSenseTouchReport.decode(
                reportID: DualSenseTouchReport.bluetoothReportID,
                bytes: report
            ),
            DualSenseTouchSample(isActive: false, x: nil, y: nil)
        )
    }

    func testDecodesUSBReportLayout() {
        var report = Array(repeating: UInt8(0), count: 64)
        report[0] = UInt8(DualSenseTouchReport.usbReportID)
        writeContact(into: &report, at: 33, contact: 2, x: 321, y: 654)

        XCTAssertEqual(
            DualSenseTouchReport.decode(
                reportID: DualSenseTouchReport.usbReportID,
                bytes: report
            ),
            DualSenseTouchSample(isActive: true, x: 321, y: 654)
        )
    }

    func testRejectsOutOfSurfaceActiveCoordinates() {
        let report = bluetoothReport(contact: 1, x: 2_200, y: 400)

        XCTAssertNil(
            DualSenseTouchReport.decode(
                reportID: DualSenseTouchReport.bluetoothReportID,
                bytes: report
            )
        )
    }

    func testRejectsBluetoothMicrophoneDuplexReport() {
        var report = bluetoothReport(contact: 1, x: 500, y: 500)
        report[1] = 0x02
        report[3] = 0xd4

        XCTAssertNil(
            DualSenseTouchReport.decode(
                reportID: DualSenseTouchReport.bluetoothReportID,
                bytes: report
            )
        )
    }

    /// macOS strips the report ID on some interfaces, which shifts the duplex
    /// flag to byte 0 along with everything else. The check used to look only at
    /// byte 1, so on those interfaces the microphone's audio payload was read as
    /// a contact and threw the pointer across the screen.
    func testRejectsIDStrippedMicrophoneDuplexReport() {
        var report = bluetoothReport(contact: 1, x: 500, y: 500)
        report.removeFirst()
        report[0] = 0x02

        XCTAssertNil(
            DualSenseTouchReport.decode(
                reportID: DualSenseTouchReport.bluetoothReportID,
                bytes: report
            )
        )
    }

    func testDecodesIDStrippedReportWithoutTheDuplexFlag() {
        var report = bluetoothReport(contact: 1, x: 500, y: 500)
        report.removeFirst()

        XCTAssertEqual(
            DualSenseTouchReport.decode(
                reportID: DualSenseTouchReport.bluetoothReportID,
                bytes: report
            ),
            DualSenseTouchSample(isActive: true, x: 500, y: 500)
        )
    }

    private func bluetoothReport(contact: UInt8, x: Int, y: Int) -> [UInt8] {
        var report = Array(repeating: UInt8(0), count: 78)
        report[0] = UInt8(DualSenseTouchReport.bluetoothReportID)
        writeContact(into: &report, at: 34, contact: contact, x: x, y: y)
        return report
    }

    private func writeContact(
        into report: inout [UInt8],
        at offset: Int,
        contact: UInt8,
        x: Int,
        y: Int
    ) {
        report[offset] = contact
        report[offset + 1] = UInt8(truncatingIfNeeded: x)
        report[offset + 2] =
            UInt8(truncatingIfNeeded: (x >> 8) & 0x0f) |
            UInt8(truncatingIfNeeded: (y & 0x0f) << 4)
        report[offset + 3] = UInt8(truncatingIfNeeded: y >> 4)
    }
}
