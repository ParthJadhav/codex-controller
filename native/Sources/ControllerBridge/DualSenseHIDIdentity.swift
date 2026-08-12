import Foundation
import IOKit.hid

/// Which HID interfaces belong to a DualSense, and what transport they speak.
///
/// Sony ships two product IDs for the controller, and a controller that is
/// plugged in while also paired enumerates one interface per transport. Matching
/// on the vendor/product pair is what keeps a question about *this* controller
/// from sweeping every keyboard, mouse, and display on the machine.
enum DualSenseHIDIdentity {
    static let vendorID = 0x054c
    /// DualSense, then DualSense Edge.
    static let productIDs = [0x0ce6, 0x0df2]

    /// Ready for `IOHIDManagerSetDeviceMatchingMultiple`.
    static var matchingDictionaries: [[String: Any]] {
        productIDs.map {
            [
                kIOHIDVendorIDKey: vendorID,
                kIOHIDProductIDKey: $0
            ]
        }
    }

    /// A stable identity shared by the HID collections of one physical device.
    /// PhysicalDeviceUniqueID is authoritative when present, followed by the
    /// serial and registry location used by older transports.
    static func physicalDeviceIdentifier(_ device: IOHIDDevice) -> String? {
        physicalDeviceIdentifier(
            physicalUniqueID: IOHIDDeviceGetProperty(
                device,
                kIOHIDPhysicalDeviceUniqueIDKey as CFString
            ),
            serialNumber: IOHIDDeviceGetProperty(
                device,
                kIOHIDSerialNumberKey as CFString
            ),
            locationID: IOHIDDeviceGetProperty(
                device,
                kIOHIDLocationIDKey as CFString
            )
        )
    }

    static func physicalDeviceIdentifier(
        physicalUniqueID: Any?,
        serialNumber: Any?,
        locationID: Any?
    ) -> String? {
        if let value = normalizedIdentityValue(physicalUniqueID) {
            return "physical:\(value)"
        }
        if let value = normalizedIdentityValue(serialNumber) {
            return "serial:\(value)"
        }
        if let value = normalizedIdentityValue(locationID) {
            return "location:\(value)"
        }
        return nil
    }

    /// Names the transport a connected controller is speaking, given the
    /// `kIOHIDTransportKey` values its matched interfaces publish.
    ///
    /// Both interfaces answer whenever a paired controller is also plugged in,
    /// and `IOHIDManagerCopyDevices` returns a set whose order is a hash
    /// artefact — so the controller's own attachment state, not iteration order,
    /// decides which of the two is the live one. With nothing matched at all the
    /// answer falls back to that same attachment state.
    static func transportName(
        fromMatchedTransports transports: [String],
        attachedToDevice: Bool
    ) -> String {
        let attachedName = attachedToDevice ? "USB" : "Bluetooth"
        let usb = transports.contains { $0.localizedCaseInsensitiveContains("USB") }
        let bluetooth = transports.contains { $0.localizedCaseInsensitiveContains("Bluetooth") }
        if usb, bluetooth { return attachedName }
        if usb { return "USB" }
        if bluetooth { return "Bluetooth" }
        return attachedName
    }

    private static func normalizedIdentityValue(_ value: Any?) -> String? {
        let normalized: String?
        switch value {
        case let string as String:
            normalized = string
        case let number as NSNumber:
            normalized = number.stringValue
        case let data as Data:
            normalized = data.base64EncodedString()
        default:
            normalized = nil
        }
        guard let normalized else { return nil }
        let trimmed = normalized.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed.lowercased()
    }
}
