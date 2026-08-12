import AppKit
import ApplicationServices
import GameController
import IOKit.hid

private let dualSenseInputReportCallback: IOHIDReportCallback = {
    context,
    result,
    _,
    _,
    reportID,
    report,
    reportLength in
    guard result == kIOReturnSuccess, let context, reportLength > 0 else { return }
    let contextAddress = Int(bitPattern: context)
    let bytes = Array(
        UnsafeBufferPointer(start: report, count: Int(reportLength))
    )
    Task { @MainActor in
        guard let context = UnsafeMutableRawPointer(bitPattern: contextAddress) else { return }
        let controller = Unmanaged<TouchpadPointerController>
            .fromOpaque(context)
            .takeUnretainedValue()
        controller.handleHIDReport(reportID: reportID, bytes: bytes)
    }
}

@MainActor
final class TouchpadPointerController {
    private weak var touchpad: GCControllerTouchpad?
    private weak var directionalTouchpad: GCControllerDirectionPad?
    private weak var boundController: GCController?
    private var motionFilter = TouchpadMotionFilter()
    private var mouseButtonIsDown = false
    private var cursorPosition: CGPoint?
    private var fallbackIdleTimer: Timer?
    private var hidStartupTimer: Timer?
    private var hidManager: IOHIDManager?
    private var hidDevice: IOHIDDevice?
    private var hidReportBuffer: UnsafeMutablePointer<UInt8>?
    private var hidReportBufferSize = 0
    private var hidBindingWarning: String?
    /// Matched interfaces not tried yet, best first. A DualSense that is both
    /// plugged in and paired enumerates more than once and only some of those
    /// interfaces deliver touch, so a silent one is dropped for the next
    /// candidate before the GameController downgrade.
    private var hidCandidates: [IOHIDDevice] = []
    private var contactIsActive = false
    private var suspended = false

    private var inputSource = "none"
    private var reportCount = 0
    private var decodedReportCount = 0
    private var contactCount = 0
    private var movementCount = 0
    private var minimumX: Float?
    private var maximumX: Float?
    private var minimumY: Float?
    private var maximumY: Float?

    private(set) var enabled = false
    private(set) var speed: Float = 1.25
    private(set) var coordinateSourceAvailable = false

    var isActive: Bool {
        enabled && !suspended && coordinateSourceAvailable && AXIsProcessTrusted()
    }

    var status: String {
        guard enabled else { return "disabled" }
        guard coordinateSourceAvailable else { return "unavailable" }
        guard AXIsProcessTrusted() else { return "needsAccessibility" }
        return "ready"
    }

    var diagnosticsPayload: [String: Any] {
        var payload: [String: Any] = [
            "source": inputSource,
            "reports": reportCount,
            "decodedReports": decodedReportCount,
            "contacts": contactCount,
            "movements": movementCount
        ]
        if let minimumX, let maximumX, let minimumY, let maximumY {
            payload["observedMinX"] = minimumX
            payload["observedMaxX"] = maximumX
            payload["observedMinY"] = minimumY
            payload["observedMaxY"] = maximumY
        }
        if let hidBindingWarning {
            payload["hidBindingWarning"] = hidBindingWarning
        }
        return payload
    }

    func configure(enabled: Bool, speed: Float) {
        self.enabled = enabled
        self.speed = min(max(speed, 0.5), 2.5)
        if !enabled {
            releaseMouseButtonIfNeeded()
            endContact()
        }
    }

    func setSuspended(_ suspended: Bool) {
        self.suspended = suspended
        if suspended {
            releaseMouseButtonIfNeeded()
            endContact()
        }
    }

    func bind(_ controller: GCController, allowDirectHID: Bool = true) {
        unbind()
        boundController = controller
        resetDiagnostics()

        if allowDirectHID, bindDirectHID() {
            coordinateSourceAvailable = true
            inputSource = "dualsenseHID"
            scheduleHIDStartupCheck()
            return
        }
        if !allowDirectHID {
            hidBindingWarning = DualSensePhysicalDevicePolicy.ambiguityReason
        }
        bindGameControllerCoordinates(controller)
        if !coordinateSourceAvailable, hidBindingWarning != nil {
            inputSource = "ambiguousDualSenseControllers"
        }
    }

    func unbind() {
        touchpad?.touchDown = nil
        touchpad?.touchMoved = nil
        touchpad?.touchUp = nil
        directionalTouchpad?.valueChangedHandler = nil
        touchpad = nil
        directionalTouchpad = nil
        boundController = nil
        fallbackIdleTimer?.invalidate()
        fallbackIdleTimer = nil
        hidStartupTimer?.invalidate()
        hidStartupTimer = nil
        unbindDirectHID()
        coordinateSourceAvailable = false
        inputSource = "none"
        endContact()
        releaseMouseButtonIfNeeded()
    }

    @discardableResult
    func buttonChanged(pressed: Bool) -> Bool {
        guard isActive else {
            releaseMouseButtonIfNeeded()
            return false
        }
        guard mouseButtonIsDown != pressed else { return true }
        mouseButtonIsDown = pressed
        postMouse(pressed ? .leftMouseDown : .leftMouseUp, button: .left)
        return true
    }

    fileprivate func handleHIDReport(reportID: UInt32, bytes: [UInt8]) {
        guard !suspended else { return }
        reportCount += 1
        guard let sample = DualSenseTouchReport.decode(reportID: reportID, bytes: bytes) else {
            return
        }
        decodedReportCount += 1
        let timestamp = ProcessInfo.processInfo.systemUptime
        guard sample.isActive, let x = sample.x, let y = sample.y else {
            if contactIsActive { endContact() }
            return
        }

        observe(x: x, y: y)
        if !contactIsActive {
            beginContact(x: x, y: y, timestamp: timestamp)
            return
        }
        guard let delta = motionFilter.moveTracked(x: x, y: y, timestamp: timestamp) else {
            return
        }
        movementCount += 1
        movePointer(delta)
    }

    private func bindGameControllerCoordinates(_ controller: GCController) {
        let profile = controller.physicalInputProfile
        if let richTouchpad = profile.touchpads.values.first {
            bind(richTouchpad)
            coordinateSourceAvailable = true
            inputSource = "gameControllerTouchpad"
            return
        }

        guard let gamepad = controller.extendedGamepad as? GCDualSenseGamepad else { return }
        let primary =
            profile.dpads[GCInputDualShockTouchpadOne] ??
            gamepad.touchpadPrimary
        directionalTouchpad = primary
        primary.valueChangedHandler = { [weak self] _, x, y in
            Task { @MainActor [weak self] in self?.directionalChanged(x: x, y: y) }
        }
        coordinateSourceAvailable = true
        inputSource = "gameControllerFallback"
    }

    private func bind(_ value: GCControllerTouchpad) {
        touchpad = value
        value.reportsAbsoluteTouchSurfaceValues = true
        value.touchDown = { [weak self] _, x, y, _, _ in
            Task { @MainActor [weak self] in self?.trackedBegan(x: x, y: y) }
        }
        value.touchMoved = { [weak self] _, x, y, _, _ in
            Task { @MainActor [weak self] in self?.trackedMoved(x: x, y: y) }
        }
        value.touchUp = { [weak self] _, _, _, _, _ in
            Task { @MainActor [weak self] in self?.endContact() }
        }
    }

    private func trackedBegan(x: Float, y: Float) {
        let point = surfacePoint(x: x, y: y)
        observe(x: point.x, y: point.y)
        beginContact(
            x: point.x,
            y: point.y,
            timestamp: ProcessInfo.processInfo.systemUptime
        )
    }

    private func trackedMoved(x: Float, y: Float) {
        let point = surfacePoint(x: x, y: y)
        observe(x: point.x, y: point.y)
        guard let delta = motionFilter.moveTracked(
            x: point.x,
            y: point.y,
            timestamp: ProcessInfo.processInfo.systemUptime
        ) else { return }
        movementCount += 1
        movePointer(delta)
    }

    private func directionalChanged(x: Float, y: Float) {
        let now = ProcessInfo.processInfo.systemUptime
        let point = surfacePoint(x: x, y: y)
        observe(x: point.x, y: point.y)
        if !contactIsActive {
            contactIsActive = true
            contactCount += 1
            cursorPosition = currentCursorPosition()
        }
        let delta = motionFilter.moveUntracked(x: point.x, y: point.y, timestamp: now)
        scheduleFallbackIdle()
        guard let delta else { return }
        movementCount += 1
        movePointer(delta)
    }

    private func beginContact(x: Float, y: Float, timestamp: TimeInterval) {
        contactIsActive = true
        contactCount += 1
        cursorPosition = currentCursorPosition()
        motionFilter.begin(x: x, y: y, timestamp: timestamp)
    }

    private func endContact() {
        contactIsActive = false
        cursorPosition = nil
        motionFilter.end()
        fallbackIdleTimer?.invalidate()
        fallbackIdleTimer = nil
    }

    private func scheduleFallbackIdle() {
        fallbackIdleTimer?.invalidate()
        let timer = Timer(timeInterval: 0.12, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.endContact() }
        }
        RunLoop.main.add(timer, forMode: .common)
        fallbackIdleTimer = timer
    }

    private func movePointer(_ delta: TouchpadMotionDelta) {
        guard isActive else { return }
        let cursorDelta = TouchpadPointerCurve.cursorDelta(for: delta, speed: speed)
        let origin = cursorPosition ?? currentCursorPosition()
        let target = clampedToDisplays(
            CGPoint(
                x: origin.x + CGFloat(cursorDelta.x),
                y: origin.y + CGFloat(cursorDelta.y)
            )
        )
        // Maintain the origin synchronously. Querying WindowServer for every
        // high-rate sample races the posted events and loses fast movement.
        cursorPosition = target
        // A `mouseMoved` posted between a left-button down and up is not a
        // drag: AppKit routes it as a plain hover, so text selection, window
        // moves, and Finder drags never start. While the button is logically
        // down the motion has to go out as `leftMouseDragged`.
        postMouse(mouseButtonIsDown ? .leftMouseDragged : .mouseMoved, at: target, button: .left)
    }

    private func surfacePoint(x: Float, y: Float) -> (x: Float, y: Float) {
        TouchpadPointerGeometry.surfacePoint(x: x, y: y)
    }

    private func observe(x: Float, y: Float) {
        minimumX = min(minimumX ?? x, x)
        maximumX = max(maximumX ?? x, x)
        minimumY = min(minimumY ?? y, y)
        maximumY = max(maximumY ?? y, y)
    }

    private func resetDiagnostics() {
        reportCount = 0
        decodedReportCount = 0
        contactCount = 0
        movementCount = 0
        minimumX = nil
        maximumX = nil
        minimumY = nil
        maximumY = nil
        hidBindingWarning = nil
    }

    private func scheduleHIDStartupCheck() {
        let timer = Timer(timeInterval: 0.6, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.decodedReportCount == 0,
                      let controller = self.boundController else { return }
                // This interface opened but never produced a decodable touch
                // report. Another matched interface may still work, so it gets
                // a turn before the coordinate source is downgraded.
                closeHIDDevice()
                if openNextHIDCandidate() {
                    scheduleHIDStartupCheck()
                    return
                }
                self.unbindDirectHID()
                self.bindGameControllerCoordinates(controller)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        hidStartupTimer = timer
    }

    private func bindDirectHID() -> Bool {
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, 0)
        IOHIDManagerSetDeviceMatchingMultiple(
            manager,
            DualSenseHIDIdentity.matchingDictionaries as CFArray
        )
        guard IOHIDManagerOpen(manager, 0) == kIOReturnSuccess,
              let deviceSet = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> else {
            IOHIDManagerClose(manager, 0)
            return false
        }

        hidManager = manager
        switch Self.orderedCandidates(
            in: deviceSet,
            preferringUSB: boundController?.isAttachedToDevice ?? false
        ) {
        case .candidates(let candidates):
            hidCandidates = candidates
        case .ambiguous:
            hidBindingWarning = DualSensePhysicalDevicePolicy.ambiguityReason
            unbindDirectHID()
            return false
        }
        guard openNextHIDCandidate() else {
            unbindDirectHID()
            return false
        }
        return true
    }

    /// Ranks the matched interfaces and drops the ones too narrow to hold a
    /// contact, so the pointer never binds to an interface that cannot work.
    private enum HIDCandidateSelection {
        case candidates([IOHIDDevice])
        case ambiguous
    }

    private static func orderedCandidates(
        in devices: Set<IOHIDDevice>,
        preferringUSB: Bool
    ) -> HIDCandidateSelection {
        let ordered = Array(devices)
        // The policy ranks plain descriptions so it stays pure and testable;
        // the positions it returns index straight back into `ordered`.
        switch DualSenseHIDCandidatePolicy.safelyOrderedIndices(
            ordered.map(Self.describe),
            preferringUSB: preferringUSB
        ) {
        case .candidates(let indices):
            return .candidates(indices.map { ordered[$0] })
        case .ambiguous:
            return .ambiguous
        }
    }

    private static func describe(_ device: IOHIDDevice) -> DualSenseHIDCandidate {
        DualSenseHIDCandidate(
            transport: IOHIDDeviceGetProperty(device, kIOHIDTransportKey as CFString) as? String,
            maximumInputReportSize: Self.maximumInputReportSize(device) ?? 0,
            physicalDeviceIdentifier: DualSenseHIDIdentity.physicalDeviceIdentifier(device)
        )
    }

    private static func maximumInputReportSize(_ device: IOHIDDevice) -> Int? {
        (
            IOHIDDeviceGetProperty(device, kIOHIDMaxInputReportSizeKey as CFString) as? NSNumber
        )?.intValue
    }

    /// Opens the best remaining candidate and starts delivering its reports.
    private func openNextHIDCandidate() -> Bool {
        while !hidCandidates.isEmpty {
            let device = hidCandidates.removeFirst()
            guard IOHIDDeviceOpen(device, 0) == kIOReturnSuccess else { continue }
            let maximumReportSize = Self.maximumInputReportSize(device)
                ?? DualSenseHIDCandidatePolicy.bluetoothInputReportSize
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: maximumReportSize)
            buffer.initialize(repeating: 0, count: maximumReportSize)
            IOHIDDeviceRegisterInputReportCallback(
                device,
                buffer,
                maximumReportSize,
                dualSenseInputReportCallback,
                Unmanaged.passUnretained(self).toOpaque()
            )
            IOHIDDeviceScheduleWithRunLoop(
                device,
                CFRunLoopGetMain(),
                CFRunLoopMode.commonModes.rawValue
            )
            hidDevice = device
            hidReportBuffer = buffer
            hidReportBufferSize = maximumReportSize
            // Counters describe the interface currently bound, not the one
            // that was just abandoned.
            reportCount = 0
            decodedReportCount = 0
            return true
        }
        return false
    }

    private func unbindDirectHID() {
        hidStartupTimer?.invalidate()
        hidStartupTimer = nil
        hidCandidates.removeAll()
        closeHIDDevice()
        if let manager = hidManager {
            IOHIDManagerClose(manager, 0)
        }
        hidManager = nil
    }

    private func closeHIDDevice() {
        if let device = hidDevice {
            IOHIDDeviceUnscheduleFromRunLoop(
                device,
                CFRunLoopGetMain(),
                CFRunLoopMode.commonModes.rawValue
            )
            if let buffer = hidReportBuffer {
                IOHIDDeviceRegisterInputReportCallback(
                    device,
                    buffer,
                    hidReportBufferSize,
                    nil,
                    nil
                )
            }
            IOHIDDeviceClose(device, 0)
        }
        if let buffer = hidReportBuffer {
            buffer.deinitialize(count: hidReportBufferSize)
            buffer.deallocate()
        }
        hidDevice = nil
        hidReportBuffer = nil
        hidReportBufferSize = 0
    }

    private func currentCursorPosition() -> CGPoint {
        CGEvent(source: nil)?.location ?? NSEvent.mouseLocation
    }

    private func postMouse(
        _ type: CGEventType,
        at location: CGPoint? = nil,
        button: CGMouseButton
    ) {
        // Button events reuse the position the pointer path is maintaining, so
        // a press, its drag, and its release all agree on where they happened
        // even when WindowServer has not caught up with the last move.
        guard let event = CGEvent(
            mouseEventSource: nil,
            mouseType: type,
            mouseCursorPosition: location ?? cursorPosition ?? currentCursorPosition(),
            mouseButton: button
        ) else { return }
        event.post(tap: .cghidEventTap)
    }

    private func releaseMouseButtonIfNeeded() {
        guard mouseButtonIsDown else { return }
        mouseButtonIsDown = false
        postMouse(.leftMouseUp, button: .left)
    }

    private func clampedToDisplays(_ point: CGPoint) -> CGPoint {
        TouchpadPointerGeometry.clamped(point, toDisplayBounds: Self.activeDisplayBounds())
    }

    private static func activeDisplayBounds() -> [CGRect] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
        var displays = Array(repeating: CGDirectDisplayID(), count: Int(count))
        guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return [] }
        return displays.prefix(Int(count)).map(CGDisplayBounds)
    }
}
