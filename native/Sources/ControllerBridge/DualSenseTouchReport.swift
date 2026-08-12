import Foundation

struct DualSenseTouchSample: Equatable {
    let isActive: Bool
    let x: Float?
    let y: Float?
}

enum DualSenseTouchReport {
    static let usbReportID: UInt32 = 0x01
    static let bluetoothReportID: UInt32 = 0x31
    static let surfaceWidth: Float = 1_920
    static let surfaceHeight: Float = 1_080

    /// Decodes the primary contact using the layout published by Sony's Linux
    /// hid-playstation driver. The contact high bit is authoritative: position
    /// bytes are invalid when it is set.
    static func decode(reportID: UInt32, bytes: [UInt8]) -> DualSenseTouchSample? {
        let commonOffset: Int
        switch reportID {
        case usbReportID:
            commonOffset = reportIncludesID(reportID, bytes: bytes) ? 1 : 0
        case bluetoothReportID:
            let includesID = reportIncludesID(reportID, bytes: bytes)
            // Byte 1 of the Bluetooth report — byte 0 once the ID has been
            // stripped — marks a report whose payload is microphone audio. Its
            // touch bytes are that audio stream, and reading them as a contact
            // sent the pointer flying while the microphone was live. The check
            // has to follow the same shift as everything else in the layout.
            let duplexFlagOffset = includesID ? 1 : 0
            guard bytes.count > duplexFlagOffset,
                  bytes[duplexFlagOffset] & 0x02 == 0 else { return nil }
            commonOffset = includesID ? 2 : 1
        default:
            return nil
        }

        let pointOffset = commonOffset + 32
        guard bytes.count >= pointOffset + 4 else { return nil }
        let contact = bytes[pointOffset]
        guard contact & 0x80 == 0 else {
            return DualSenseTouchSample(isActive: false, x: nil, y: nil)
        }

        let x = Int(bytes[pointOffset + 1]) |
            (Int(bytes[pointOffset + 2] & 0x0f) << 8)
        let y = Int(bytes[pointOffset + 2] >> 4) |
            (Int(bytes[pointOffset + 3]) << 4)
        guard x >= 0, x < Int(surfaceWidth), y >= 0, y < Int(surfaceHeight) else {
            return nil
        }
        return DualSenseTouchSample(isActive: true, x: Float(x), y: Float(y))
    }

    private static func reportIncludesID(_ reportID: UInt32, bytes: [UInt8]) -> Bool {
        bytes.first == UInt8(truncatingIfNeeded: reportID)
    }
}
