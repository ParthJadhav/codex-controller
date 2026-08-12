import CoreAudio
import Foundation

/// One CoreAudio device, reduced to what route classification looks at.
struct ControllerAudioRoute: Equatable {
    let name: String
    let transportType: UInt32
    let channelCount: UInt32
}

/// Decides what the controller's audio hardware currently is.
///
/// A wired DualSense presents as two different CoreAudio devices: the
/// four-channel one that carries its built-in speaker and microphone, and a
/// narrower one that is really the 3.5mm headset jack. Calling the second the
/// first would point the renderer's speaker test at hardware that cannot run it.
enum ControllerAudioRoutePolicy {
    static func isWiredDualSenseRoute(_ route: ControllerAudioRoute) -> Bool {
        route.transportType == kAudioDeviceTransportTypeUSB
            && route.name.localizedCaseInsensitiveContains("DualSense")
    }

    /// `"usbBuiltIn"`, `"wiredHeadset"`, or `"none"`.
    static func controllerAudioKind(
        inputs: [ControllerAudioRoute],
        outputs: [ControllerAudioRoute]
    ) -> String {
        // Every wired route is considered, not just the first one: both shapes
        // enumerate at once on some machines, and which of them CoreAudio lists
        // first must not decide what the controller is said to have.
        if outputs.contains(where: { output in
            isWiredDualSenseRoute(output) && DualSenseUSBSpeaker.isCompatibleOutput(
                name: output.name,
                transportType: output.transportType,
                channelCount: output.channelCount
            )
        }) {
            return "usbBuiltIn"
        }
        if inputs.contains(where: isWiredDualSenseRoute)
            || outputs.contains(where: isWiredDualSenseRoute) {
            return "wiredHeadset"
        }
        return "none"
    }
}
