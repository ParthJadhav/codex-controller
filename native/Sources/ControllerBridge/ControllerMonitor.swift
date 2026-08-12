import AppKit
import CoreHaptics
import Foundation
import GameController
import IOKit.hid

@MainActor
final class ControllerMonitor {
    private var selected: GCController?
    private var publishScheduled = false
    private var observers: [NSObjectProtocol] = []
    private var activeValues: [String: Float] = [:]
    private var capabilities = Set<String>()
    private var sortedCapabilities: [String] = []
    private var virtualPressed: [String: Bool] = [:]
    private var buttonPressed: [String: Bool] = [:]
    private var lastInput: String?
    private var lastPressed: Bool?
    private var axisEnter: Float = 0.65
    private var axisRelease: Float = 0.45
    private var triggerEnter: Float = 0.75
    private var triggerRelease: Float = 0.55
    private var hapticEngine: CHHapticEngine?
    private var inputReconciliationTimer: Timer?
    private var selectedTransport = "Unknown"
    private var inputSuspended = false
    private let touchpadPointer = TouchpadPointerController()
    /// Called whenever a different controller becomes the selected one, in
    /// either direction. Anything cached about the controller's hardware — the
    /// Bluetooth microphone capability above all — is stale from here on.
    var onSelectedControllerChanged: (() -> Void)?

    var hasAmbiguousControllerSelection: Bool {
        let likelyDualSenseCount = GCController.controllers().filter {
            $0.extendedGamepad != nil && score($0) >= 90
        }.count
        return DualSensePhysicalDevicePolicy.controllerSelectionIsAmbiguous(
            controllerCount: likelyDualSenseCount
        )
    }

    func start() {
        GCController.shouldMonitorBackgroundEvents = true
        let center = NotificationCenter.default
        observers.append(
            center.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) {
                [weak self] _ in
                guard let self else { return }
                Task { @MainActor in self.selectBestController() }
            }
        )
        observers.append(
            center.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) {
                [weak self] _ in
                guard let self else { return }
                Task { @MainActor in self.selectBestController() }
            }
        )
        GCController.startWirelessControllerDiscovery { [weak self] in
            guard let self else { return }
            Task { @MainActor in self.selectBestController() }
        }
        selectBestController(forcePublish: true)
        let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.reconcileInputs() }
        }
        RunLoop.main.add(timer, forMode: .common)
        inputReconciliationTimer = timer
    }

    func stop() {
        GCController.stopWirelessControllerDiscovery()
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        inputReconciliationTimer?.invalidate()
        inputReconciliationTimer = nil
        clearHandlers()
        resetHapticEngine()
        selected = nil
        selectedTransport = "Unknown"
    }

    func configure(_ payload: [String: Any]) {
        axisEnter = number(payload["axisEnterThreshold"], fallback: axisEnter)
        axisRelease = number(payload["axisReleaseThreshold"], fallback: axisRelease)
        triggerEnter = number(payload["triggerEnterThreshold"], fallback: triggerEnter)
        triggerRelease = number(payload["triggerReleaseThreshold"], fallback: triggerRelease)
        touchpadPointer.configure(
            enabled: (payload["touchpadPointerEnabled"] as? Bool) ?? touchpadPointer.enabled,
            speed: number(payload["touchpadPointerSpeed"], fallback: touchpadPointer.speed)
        )
        publish()
    }

    func refresh() {
        selectBestController(forcePublish: true)
    }

    func setInputSuspended(_ suspended: Bool) {
        guard inputSuspended != suspended else { return }
        inputSuspended = suspended
        touchpadPointer.setSuspended(suspended)
        activeValues.removeAll()
        virtualPressed.removeAll()
        buttonPressed.removeAll()
        lastInput = nil
        lastPressed = nil
        if !suspended, let gamepad = selected?.extendedGamepad {
            seedValues(gamepad)
        }
        publish()
    }

    func setLight(_ payload: [String: Any]) -> Bool {
        guard let colorValue = payload["color"] as? String,
              let color = ControllerLightColor.rgb(colorValue),
              let light = selected?.light else { return false }
        light.color = GCColor(red: color.red, green: color.green, blue: color.blue)
        return true
    }

    func playFeedback(_ tone: String) {
        guard let haptics = selected?.haptics else { return }
        let engine = hapticEngine ?? haptics.createEngine(withLocality: .default)
        hapticEngine = engine
        guard let engine else { return }
        let values: [(Float, Float, TimeInterval)]
        switch tone {
        case "failure":
            values = [(0.72, 0.25, 0)]
        case "warning":
            values = [(0.28, 0.35, 0), (0.28, 0.35, 0.09)]
        case "layer":
            values = [(0.25, 0.65, 0), (0.4, 0.65, 0.07)]
        default:
            values = [(0.35, 0.55, 0)]
        }
        let events = values.map { intensity, sharpness, time in
            CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
                ],
                relativeTime: time
            )
        }
        do {
            try engine.start()
            let pattern = try CHHapticPattern(events: events, parameters: [])
            try engine.makePlayer(with: pattern).start(atTime: 0)
        } catch {
            BridgeWriter.shared.error("Controller haptics failed: \(error.localizedDescription)")
        }
    }

    /// A `CHHapticEngine` belongs to the controller it was created from. Cached
    /// across a reconnect it outlived that controller, and every later
    /// `playFeedback` then started a dead engine — so haptics went silent for
    /// the rest of the session, with the failure only visible in the log.
    private func resetHapticEngine() {
        guard let engine = hapticEngine else { return }
        hapticEngine = nil
        engine.stop(completionHandler: nil)
    }

    private func selectBestController(forcePublish: Bool = false) {
        let controllers = GCController.controllers().filter { $0.extendedGamepad != nil }
        let best = controllers.max { score($0) < score($1) }
        guard best !== selected else {
            if forcePublish { publish() }
            return
        }
        let transition = ControllerSelectionTransitionPolicy.publications(
            previousConnected: selected != nil,
            nextConnected: best != nil
        )
        if transition.contains(.reset) {
            // Both writes are enqueued synchronously on BridgeWriter's serial
            // queue. The renderer therefore processes connected=false and
            // releases A before the following connected=true snapshot can
            // introduce B, even if both visual renders coalesce.
            publishDisconnectedReset()
        }
        clearHandlers()
        resetHapticEngine()
        selected = best
        onSelectedControllerChanged?()
        capabilities.removeAll()
        sortedCapabilities.removeAll()
        activeValues.removeAll()
        virtualPressed.removeAll()
        buttonPressed.removeAll()
        lastInput = nil
        lastPressed = nil
        if let best {
            best.handlerQueue = .main
            selectedTransport = transport(best)
            configureHandlers(best)
            sortedCapabilities = capabilities.sorted()
            touchpadPointer.bind(
                best,
                allowDirectHID: !DualSensePhysicalDevicePolicy
                    .controllerSelectionIsAmbiguous(
                        controllerCount: controllers.filter { score($0) >= 90 }.count
                    )
            )
        } else {
            selectedTransport = "Unknown"
        }
        publish()
    }

    private func publishDisconnectedReset() {
        let payload = ControllerPublishPayload.make(
            controller: nil,
            touchpad: TouchpadPointerDescription(
                enabled: touchpadPointer.enabled,
                status: touchpadPointer.status,
                diagnostics: touchpadPointer.diagnosticsPayload
            ),
            inputSuspended: inputSuspended,
            capabilities: [],
            activeValues: [:],
            lastInput: nil,
            lastPressed: nil
        )
        BridgeWriter.shared.event("controller", payload: payload)
    }

    private func score(_ controller: GCController) -> Int {
        let name = "\(controller.vendorName ?? "") \(controller.productCategory)".lowercased()
        if name.contains("dualsense") { return 100 }
        if name.contains("wireless controller") { return 90 }
        return 10
    }

    private func configureHandlers(_ controller: GCController) {
        guard let gamepad = controller.extendedGamepad else { return }
        bind(gamepad.buttonA, "buttonA")
        bind(gamepad.buttonB, "buttonB")
        bind(gamepad.buttonX, "buttonX")
        bind(gamepad.buttonY, "buttonY")
        bind(gamepad.leftShoulder, "leftShoulder")
        bind(gamepad.rightShoulder, "rightShoulder")
        bind(gamepad.leftThumbstickButton, "leftStickClick")
        bind(gamepad.rightThumbstickButton, "rightStickClick")
        bind(gamepad.buttonMenu, "menu")
        bind(gamepad.buttonOptions, "view")
        bind(gamepad.buttonHome, "home")
        if let dualSense = gamepad as? GCDualSenseGamepad {
            bindTouchpadButton(dualSense.touchpadButton)
        }
        bindAnalog(gamepad.leftTrigger, "leftTrigger")
        bindAnalog(gamepad.rightTrigger, "rightTrigger")

        capabilities.formUnion(["dpadUp", "dpadDown", "dpadLeft", "dpadRight"])
        gamepad.dpad.valueChangedHandler = { [weak self] _, x, y in
            MainActor.assumeIsolated {
                self?.updateDirection("dpadLeft", magnitude: max(0, -x))
                self?.updateDirection("dpadRight", magnitude: max(0, x))
                self?.updateDirection("dpadDown", magnitude: max(0, -y))
                self?.updateDirection("dpadUp", magnitude: max(0, y))
            }
        }
        bindStick(gamepad.leftThumbstick, prefix: "leftStick")
        bindStick(gamepad.rightThumbstick, prefix: "rightStick")
        seedValues(gamepad)
    }

    private func bind(_ button: GCControllerButtonInput?, _ input: String) {
        guard let button else { return }
        capabilities.insert(input)
        button.pressedChangedHandler = { [weak self] _, value, pressed in
            MainActor.assumeIsolated {
                self?.emit(input, value: value, pressed: pressed)
            }
        }
    }

    private func bindTouchpadButton(_ button: GCControllerButtonInput) {
        capabilities.insert("touchpad")
        button.pressedChangedHandler = { [weak self] _, value, pressed in
            MainActor.assumeIsolated {
                guard let self else { return }
                guard !self.inputSuspended else { return }
                _ = self.touchpadPointer.buttonChanged(pressed: pressed)
                self.emit("touchpad", value: value, pressed: pressed)
            }
        }
    }

    private func bindAnalog(_ button: GCControllerButtonInput, _ input: String) {
        capabilities.insert(input)
        button.valueChangedHandler = { [weak self] _, value, _ in
            MainActor.assumeIsolated {
                self?.updateDirection(input, magnitude: value)
            }
        }
    }

    private func bindStick(_ stick: GCControllerDirectionPad, prefix: String) {
        capabilities.formUnion([
            "\(prefix)Up", "\(prefix)Down", "\(prefix)Left", "\(prefix)Right"
        ])
        stick.valueChangedHandler = { [weak self] _, x, y in
            MainActor.assumeIsolated {
                self?.updateDirection("\(prefix)Left", magnitude: max(0, -x))
                self?.updateDirection("\(prefix)Right", magnitude: max(0, x))
                self?.updateDirection("\(prefix)Down", magnitude: max(0, -y))
                self?.updateDirection("\(prefix)Up", magnitude: max(0, y))
            }
        }
    }

    private func seedValues(_ gamepad: GCExtendedGamepad) {
        seedButton(gamepad.buttonA, "buttonA")
        seedButton(gamepad.buttonB, "buttonB")
        seedButton(gamepad.buttonX, "buttonX")
        seedButton(gamepad.buttonY, "buttonY")
        seedButton(gamepad.leftShoulder, "leftShoulder")
        seedButton(gamepad.rightShoulder, "rightShoulder")
        seedButton(gamepad.leftThumbstickButton, "leftStickClick")
        seedButton(gamepad.rightThumbstickButton, "rightStickClick")
        seedButton(gamepad.buttonMenu, "menu")
        seedButton(gamepad.buttonOptions, "view")
        seedButton(gamepad.buttonHome, "home")
        if let dualSense = gamepad as? GCDualSenseGamepad {
            seedButton(dualSense.touchpadButton, "touchpad")
        }
        activeValues["leftTrigger"] = clamp(gamepad.leftTrigger.value)
        activeValues["rightTrigger"] = clamp(gamepad.rightTrigger.value)
        virtualPressed["leftTrigger"] = gamepad.leftTrigger.value >= triggerEnter
        virtualPressed["rightTrigger"] = gamepad.rightTrigger.value >= triggerEnter
        seedDirections(gamepad.dpad, prefix: "dpad")
        seedStick(gamepad.leftThumbstick, prefix: "leftStick")
        seedStick(gamepad.rightThumbstick, prefix: "rightStick")
    }

    private func seedButton(_ button: GCControllerButtonInput?, _ input: String) {
        guard let button else { return }
        activeValues[input] = clamp(button.value)
        buttonPressed[input] = button.isPressed
    }

    private func seedDirections(_ direction: GCControllerDirectionPad, prefix: String) {
        seedDirection("\(prefix)Left", value: max(0, -direction.xAxis.value))
        seedDirection("\(prefix)Right", value: max(0, direction.xAxis.value))
        seedDirection("\(prefix)Down", value: max(0, -direction.yAxis.value))
        seedDirection("\(prefix)Up", value: max(0, direction.yAxis.value))
    }

    private func seedDirection(_ input: String, value: Float) {
        let clampedValue = clamp(value)
        activeValues[input] = clampedValue
        virtualPressed[input] = clampedValue >= axisEnter
    }

    private func seedStick(_ stick: GCControllerDirectionPad, prefix: String) {
        seedDirections(stick, prefix: prefix)
    }

    private func reconcileInputs() {
        guard !inputSuspended else { return }
        guard let gamepad = selected?.extendedGamepad else { return }
        reconcileButton(gamepad.buttonA, "buttonA")
        reconcileButton(gamepad.buttonB, "buttonB")
        reconcileButton(gamepad.buttonX, "buttonX")
        reconcileButton(gamepad.buttonY, "buttonY")
        reconcileButton(gamepad.leftShoulder, "leftShoulder")
        reconcileButton(gamepad.rightShoulder, "rightShoulder")
        reconcileButton(gamepad.leftThumbstickButton, "leftStickClick")
        reconcileButton(gamepad.rightThumbstickButton, "rightStickClick")
        reconcileButton(gamepad.buttonMenu, "menu")
        reconcileButton(gamepad.buttonOptions, "view")
        reconcileButton(gamepad.buttonHome, "home")
        if let dualSense = gamepad as? GCDualSenseGamepad {
            reconcileButton(dualSense.touchpadButton, "touchpad") { [weak self] pressed in
                _ = self?.touchpadPointer.buttonChanged(pressed: pressed)
            }
        }
        updateDirection("leftTrigger", magnitude: gamepad.leftTrigger.value)
        updateDirection("rightTrigger", magnitude: gamepad.rightTrigger.value)
        reconcileDirections(gamepad.dpad, prefix: "dpad")
        reconcileDirections(gamepad.leftThumbstick, prefix: "leftStick")
        reconcileDirections(gamepad.rightThumbstick, prefix: "rightStick")
    }

    private func reconcileButton(
        _ button: GCControllerButtonInput?,
        _ input: String,
        onPressedChanged: ((Bool) -> Void)? = nil
    ) {
        guard let button else { return }
        let value = clamp(button.value)
        let pressed = button.isPressed
        let previousPressed = buttonPressed[input] ?? false
        let previousValue = activeValues[input] ?? 0
        let edge = pressed != previousPressed
        guard ControllerInputPublishPolicy.shouldPublish(
            previousValue: previousValue, value: value, edge: edge
        ) else { return }
        if edge { onPressedChanged?(pressed) }
        emit(input, value: value, pressed: edge ? pressed : nil)
    }

    private func reconcileDirections(_ direction: GCControllerDirectionPad, prefix: String) {
        updateDirection("\(prefix)Left", magnitude: max(0, -direction.xAxis.value))
        updateDirection("\(prefix)Right", magnitude: max(0, direction.xAxis.value))
        updateDirection("\(prefix)Down", magnitude: max(0, -direction.yAxis.value))
        updateDirection("\(prefix)Up", magnitude: max(0, direction.yAxis.value))
    }

    private func updateDirection(_ input: String, magnitude: Float) {
        guard !inputSuspended else { return }
        let value = clamp(magnitude)
        let wasPressed = virtualPressed[input] ?? false
        let trigger = ControllerPressPolicy.isTrigger(input)
        let isPressed = ControllerPressPolicy.isPressed(
            wasPressed: wasPressed,
            value: value,
            enter: trigger ? triggerEnter : axisEnter,
            release: trigger ? triggerRelease : axisRelease
        )
        virtualPressed[input] = isPressed
        let previousValue = activeValues[input] ?? 0
        let edge = isPressed != wasPressed
        guard ControllerInputPublishPolicy.shouldPublish(
            previousValue: previousValue, value: value, edge: edge
        ) else {
            return
        }
        emit(input, value: value, pressed: edge ? isPressed : nil)
    }

    private func emit(_ input: String, value: Float, pressed: Bool?) {
        guard !inputSuspended else { return }
        activeValues[input] = clamp(value)
        if let pressed { buttonPressed[input] = pressed }
        lastInput = input
        lastPressed = pressed
        // A single stick event calls this four times, and a reconcile tick can
        // touch a dozen axes; coalescing analog motion into one snapshot per
        // run-loop turn collapses that burst without delaying anything.
        if ControllerInputPublishPolicy.publishesImmediately(edge: pressed != nil) {
            flushPublish()
        } else {
            schedulePublish()
        }
    }

    private func schedulePublish() {
        guard !publishScheduled else { return }
        publishScheduled = true
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { self?.flushPublish() }
        }
    }

    private func flushPublish() {
        publishScheduled = false
        publish()
    }

    private func publish() {
        let payload = ControllerPublishPayload.make(
            controller: selected.map(description(of:)),
            touchpad: TouchpadPointerDescription(
                enabled: touchpadPointer.enabled,
                status: touchpadPointer.status,
                diagnostics: touchpadPointer.diagnosticsPayload
            ),
            inputSuspended: inputSuspended,
            capabilities: sortedCapabilities,
            activeValues: activeValues,
            lastInput: lastInput,
            lastPressed: lastPressed
        )
        BridgeWriter.shared.event("controller", payload: payload)
        // Edge metadata describes this publication only. Retaining it causes a
        // later refresh/configuration snapshot to replay an old press or release.
        lastInput = nil
        lastPressed = nil
    }

    private func description(of controller: GCController) -> ControllerDescription {
        var battery: Float?
        if let source = controller.battery,
           source.batteryState != .unknown,
           source.batteryLevel >= 0 {
            battery = source.batteryLevel
        }
        return ControllerDescription(
            id: "\(ObjectIdentifier(controller).hashValue)",
            name: controller.vendorName ?? ControllerPublishPayload.placeholderName,
            productCategory: controller.productCategory,
            transport: selectedTransport,
            batteryLevel: battery,
            supportsLight: controller.light != nil,
            supportsHaptics: controller.haptics != nil
        )
    }

    private func clearHandlers() {
        touchpadPointer.unbind()
        guard let gamepad = selected?.extendedGamepad else { return }
        gamepad.buttonA.pressedChangedHandler = nil
        gamepad.buttonB.pressedChangedHandler = nil
        gamepad.buttonX.pressedChangedHandler = nil
        gamepad.buttonY.pressedChangedHandler = nil
        gamepad.leftShoulder.pressedChangedHandler = nil
        gamepad.rightShoulder.pressedChangedHandler = nil
        gamepad.leftTrigger.valueChangedHandler = nil
        gamepad.rightTrigger.valueChangedHandler = nil
        gamepad.leftThumbstickButton?.pressedChangedHandler = nil
        gamepad.rightThumbstickButton?.pressedChangedHandler = nil
        gamepad.buttonMenu.pressedChangedHandler = nil
        gamepad.buttonOptions?.pressedChangedHandler = nil
        gamepad.buttonHome?.pressedChangedHandler = nil
        (gamepad as? GCDualSenseGamepad)?.touchpadButton.pressedChangedHandler = nil
        gamepad.dpad.valueChangedHandler = nil
        gamepad.leftThumbstick.valueChangedHandler = nil
        gamepad.rightThumbstick.valueChangedHandler = nil
    }

    /// Reads the transport from the controller's own HID interfaces.
    ///
    /// The matching dictionary is what keeps this cheap and quiet: the previous
    /// `nil` match copied every HID device on the machine — keyboards, mice,
    /// displays — and opening that manager asked macOS for access to all of them
    /// just to read one string. `CopyDevices` and `GetProperty` need no open at
    /// all, so none of it was ever necessary.
    private func transport(_ controller: GCController) -> String {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        IOHIDManagerSetDeviceMatchingMultiple(
            manager,
            DualSenseHIDIdentity.matchingDictionaries as CFArray
        )
        let devices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> ?? []
        let transports = devices.compactMap {
            IOHIDDeviceGetProperty($0, kIOHIDTransportKey as CFString) as? String
        }
        return DualSenseHIDIdentity.transportName(
            fromMatchedTransports: transports,
            attachedToDevice: controller.isAttachedToDevice
        )
    }

    private func clamp(_ value: Float) -> Float {
        ControllerPressPolicy.clamped(value)
    }

    private func number(_ value: Any?, fallback: Float) -> Float {
        (value as? NSNumber)?.floatValue ?? fallback
    }
}
