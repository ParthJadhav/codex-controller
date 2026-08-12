import AppKit
import Foundation

@MainActor
final class BridgeApplication {
    private let controller = ControllerMonitor()
    /// Verifying the DualSense microphone takes over its HID reports, so
    /// mappings are suspended while that runs.
    private lazy var audio = ControllerAudioMonitor { [weak self] active in
        self?.controller.setInputSuspended(active)
    }
    private let actions = ActionDispatcher()
    private var audioVerification = AudioVerificationGate()
    private var scheduledCommandCount = 0
    private var scheduledCommandDrainWaiters: [CheckedContinuation<Void, Never>] = []

    func start() {
        // Before anything else asks CoreAudio a question: a previous bridge may
        // have been killed holding the user's default device.
        ControllerAudioMonitor.restoreBorrowedDefaultDevices()
        controller.onSelectedControllerChanged = { [weak self] in
            self?.audio.invalidateDeviceCapabilityCache()
        }
        controller.start()
        BridgeWriter.shared.event("permission", payload: audio.permissionSnapshot())
    }

    func stop() {
        controller.stop()
    }

    /// Registers ordering-sensitive action state before starting independent
    /// command work. This preserves stdin order for a held chord without making
    /// a refresh or release wait behind an unrelated, seconds-long operation.
    func schedule(_ command: NativeCommand) {
        let actionReservation = command.command == "action.execute"
            ? actions.reserve(command.payload)
            : nil
        scheduledCommandCount += 1
        Task { @MainActor in
            await handle(command, actionReservation: actionReservation)
            scheduledCommandDidFinish()
        }
    }

    func waitForScheduledCommands() async {
        guard scheduledCommandCount > 0 else { return }
        await withCheckedContinuation { scheduledCommandDrainWaiters.append($0) }
    }

    private func scheduledCommandDidFinish() {
        scheduledCommandCount -= 1
        guard scheduledCommandCount == 0 else { return }
        let waiters = scheduledCommandDrainWaiters
        scheduledCommandDrainWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    private func handle(
        _ command: NativeCommand,
        actionReservation: ActionDispatcher.ExecutionReservation?
    ) async {
        let result: (Bool, String)
        switch command.command {
        case "controller.configure":
            controller.configure(command.payload)
            result = (true, "Controller thresholds updated.")
        case "light.set":
            result = controller.setLight(command.payload)
                ? (true, "Controller light updated.")
                : (false, "The controller light is unavailable.")
        case "haptics.play":
            controller.playFeedback(command.payload["tone"] as? String ?? "success")
            result = (true, "Controller feedback played.")
        case "audio.configure":
            audio.configure(command.payload)
            BridgeWriter.shared.event("permission", payload: audio.permissionSnapshot())
            result = (true, "Controller audio preference updated.")
        case "audio.verifyControllerMicrophone":
            if controller.hasAmbiguousControllerSelection {
                result = (false, DualSensePhysicalDevicePolicy.ambiguityReason)
            } else {
                result = await verifyingAudio("The DualSense Bluetooth microphone check") {
                    await audio.verifyExperimentalControllerMicrophone()
                }
            }
        case "audio.verifyUSBControllerMicrophone":
            if controller.hasAmbiguousControllerSelection {
                result = (false, DualSensePhysicalDevicePolicy.ambiguityReason)
            } else {
                result = await verifyingAudio("The wired DualSense microphone check") {
                    await audio.verifyUSBControllerMicrophone()
                }
            }
        case "audio.verifyDualSenseUSBSpeaker":
            if controller.hasAmbiguousControllerSelection {
                result = (false, DualSensePhysicalDevicePolicy.ambiguityReason)
            } else {
                result = await verifyingAudio("The wired DualSense speaker check") {
                    await DualSenseUSBSpeaker.verify()
                }
            }
            BridgeWriter.shared.event("permission", payload: audio.permissionSnapshot())
        case "system.refresh":
            controller.refresh()
            BridgeWriter.shared.event("permission", payload: audio.permissionSnapshot())
            result = (true, "System status refreshed.")
        case "action.execute":
            if let actionReservation {
                result = await actions.execute(
                    command.payload,
                    reservation: actionReservation
                )
            } else {
                result = await actions.execute(command.payload)
            }
        case "message.send":
            result = await actions.sendMessage(command.payload)
        default:
            result = (false, "Unknown native command: \(command.command)")
        }
        BridgeWriter.shared.response(
            id: command.id,
            success: result.0,
            message: result.1
        )
    }

    /// Runs one audio verification, or refuses because another is still running.
    ///
    /// These checks are seconds long and hold hardware the whole time — the
    /// controller's HID reports, or the machine's default device. Two of them
    /// interleaved take each other's hardware away mid-run and then report the
    /// theft as a hardware fault, so the second one is told to wait instead.
    private func verifyingAudio(
        _ label: String,
        _ body: () async -> (Bool, String)
    ) async -> (Bool, String) {
        if let busy = audioVerification.begin(label) { return (false, busy) }
        defer { audioVerification.end() }
        return await body()
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let bridge = MainActor.assumeIsolated {
    let bridge = BridgeApplication()
    bridge.start()
    return bridge
}

let (commandLines, commandLineContinuation) = AsyncStream.makeStream(of: String.self)

Task { @MainActor in
    await NativeCommandLineProcessor.run(
        commandLines,
        schedule: { command in
            bridge.schedule(command)
        },
        malformed: {
            BridgeWriter.shared.error("The native bridge received malformed input.")
        }
    )
    await bridge.waitForScheduledCommands()
    bridge.stop()
    // `response` writes asynchronously. Do not let AppKit tear down the process
    // until the response for the final command has reached stdout.
    BridgeWriter.shared.flush()
    application.terminate(nil)
}

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        commandLineContinuation.yield(line)
    }
    commandLineContinuation.finish()
}

application.run()
