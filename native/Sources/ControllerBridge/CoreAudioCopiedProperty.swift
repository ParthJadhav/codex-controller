import CoreAudio
import Foundation

/// Reads CoreAudio CFString properties whose get contract returns a caller-owned
/// object. Keeping the ownership conversion in one place prevents a polling
/// call site from accidentally leaking one retained CFString per refresh.
enum CoreAudioCopiedProperty {
    static func string(
        objectID: AudioObjectID,
        selector: AudioObjectPropertySelector,
        scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
        element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain
    ) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: scope,
            mElement: element
        )
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(
            objectID,
            &address,
            0,
            nil,
            &size,
            &value
        ) == noErr else {
            return nil
        }
        return value?.takeRetainedValue() as String?
    }
}
