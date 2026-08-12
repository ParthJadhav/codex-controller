import CoreAudio
import Foundation

/// Borrows a system default audio route for one bounded operation.
///
/// The marker is recorded before the switch, and is cleared only after macOS
/// confirms restoration. Both sync and async forms use the same begin/finish
/// state machine so every post-switch return is cleanup-safe.
enum TemporaryDefaultAudioDevice {
    typealias VerificationResult = (Bool, String)

    static func perform(
        route: DefaultAudioDeviceMarker.Route,
        previousDevice: AudioDeviceID,
        temporaryDevice: AudioDeviceID,
        previousDeviceUID: String?,
        marker: DefaultAudioDeviceMarker = .shared,
        selectionFailure: String,
        restorationFailure: String,
        setDefault: (AudioDeviceID) -> OSStatus,
        operation: () -> VerificationResult
    ) -> VerificationResult {
        if let failure = begin(
            route: route,
            previousDevice: previousDevice,
            previousDeviceUID: previousDeviceUID,
            temporaryDevice: temporaryDevice,
            marker: marker,
            selectionFailure: selectionFailure,
            restorationFailure: restorationFailure,
            setDefault: setDefault
        ) {
            return (false, failure)
        }
        return finish(
            operation(),
            route: route,
            previousDevice: previousDevice,
            marker: marker,
            restorationFailure: restorationFailure,
            setDefault: setDefault
        )
    }

    @MainActor
    static func performAsync(
        route: DefaultAudioDeviceMarker.Route,
        previousDevice: AudioDeviceID,
        temporaryDevice: AudioDeviceID,
        previousDeviceUID: String?,
        marker: DefaultAudioDeviceMarker = .shared,
        selectionFailure: String,
        restorationFailure: String,
        setDefault: (AudioDeviceID) -> OSStatus,
        operation: () async -> VerificationResult
    ) async -> VerificationResult {
        if let failure = begin(
            route: route,
            previousDevice: previousDevice,
            previousDeviceUID: previousDeviceUID,
            temporaryDevice: temporaryDevice,
            marker: marker,
            selectionFailure: selectionFailure,
            restorationFailure: restorationFailure,
            setDefault: setDefault
        ) {
            return (false, failure)
        }
        return finish(
            await operation(),
            route: route,
            previousDevice: previousDevice,
            marker: marker,
            restorationFailure: restorationFailure,
            setDefault: setDefault
        )
    }

    private static func begin(
        route: DefaultAudioDeviceMarker.Route,
        previousDevice: AudioDeviceID,
        previousDeviceUID: String?,
        temporaryDevice: AudioDeviceID,
        marker: DefaultAudioDeviceMarker,
        selectionFailure: String,
        restorationFailure: String,
        setDefault: (AudioDeviceID) -> OSStatus
    ) -> String? {
        guard let previousDeviceUID, !previousDeviceUID.isEmpty else {
            return "The current macOS audio device has no stable UID, so macOS audio was not changed."
        }
        do {
            try marker.record(route, deviceUID: previousDeviceUID)
        } catch {
            return "Audio recovery could not be prepared, so macOS audio was not changed: "
                + error.localizedDescription
        }
        guard setDefault(temporaryDevice) == noErr else {
            // A failing CoreAudio setter does not prove the route stayed
            // untouched. Confirm the previous route before discarding the only
            // crash-recovery record of it.
            guard setDefault(previousDevice) == noErr else {
                return "\(selectionFailure) Cleanup also failed: \(restorationFailure)"
            }
            do {
                try marker.clear(route)
                return selectionFailure
            } catch {
                return "\(selectionFailure) The recovery marker could not be cleared: "
                    + error.localizedDescription
            }
        }
        return nil
    }

    private static func finish(
        _ result: VerificationResult,
        route: DefaultAudioDeviceMarker.Route,
        previousDevice: AudioDeviceID,
        marker: DefaultAudioDeviceMarker,
        restorationFailure: String,
        setDefault: (AudioDeviceID) -> OSStatus
    ) -> VerificationResult {
        guard setDefault(previousDevice) == noErr else {
            // Keep the marker so startup recovery gets another chance.
            if result.0 {
                return (false, "Audio cleanup failed: \(restorationFailure)")
            }
            return (false, "\(result.1) Cleanup also failed: \(restorationFailure)")
        }
        do {
            try marker.clear(route)
            return result
        } catch {
            let markerFailure = "The audio route was restored, but its recovery marker "
                + "could not be cleared: \(error.localizedDescription)"
            return result.0
                ? (false, markerFailure)
                : (false, "\(result.1) \(markerFailure)")
        }
    }
}
