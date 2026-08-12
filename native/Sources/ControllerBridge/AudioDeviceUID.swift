import CoreAudio
import Foundation

/// A CoreAudio device's stable identity.
///
/// `AudioDeviceID` is a handle macOS renumbers across reboots and reconnects, so
/// anything that has to name a device *later* — a marker file that survives the
/// process, above all — has to name it by UID.
enum AudioDeviceUID {
    static func of(_ id: AudioDeviceID) -> String? {
        CoreAudioCopiedProperty.string(
            objectID: id,
            selector: kAudioDevicePropertyDeviceUID
        )
    }

    static func deviceID(for uid: String) -> AudioDeviceID? {
        allDeviceIDs().first { of($0) == uid }
    }

    static func allDeviceIDs() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var byteCount: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &byteCount
        ) == noErr else { return [] }
        var ids = Array(
            repeating: AudioDeviceID(0),
            count: Int(byteCount) / MemoryLayout<AudioDeviceID>.size
        )
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &byteCount, &ids
        ) == noErr else { return [] }
        return ids
    }
}
