import AppKit
import ApplicationServices
import Foundation

/// Every system effect an ``ActionDispatcher`` can have.
///
/// The dispatcher decides *what* happens — how text is cut into chunks, which
/// half of a hold is posted, what order a sequence runs in. This protocol is
/// *where* it happens. Splitting the two lets the decisions be asserted in a
/// unit test, because posting a real `CGEvent` needs a window server, an
/// Accessibility grant, and a focused Codex window that no test host has.
@MainActor
protocol ActionEventSink {
    /// Whether this process may post synthetic input at all.
    var isAccessibilityTrusted: Bool { get }

    /// Applies a focus policy, returning a user-facing failure or `nil` when
    /// the target is ready to receive input.
    func focus(policy: String) async -> String?

    func postKey(keyCode: UInt16, modifiers: [String], keyDown: Bool) -> Bool

    /// Posts one slice of text as a key-down/key-up pair carrying the same
    /// UTF-16 payload. The dispatcher guarantees the slice is short enough for
    /// a receiver to read whole and never ends mid-surrogate-pair.
    func postUnicode(_ codeUnits: [UInt16]) -> Bool

    func postPrimaryClick() -> Bool

    func open(_ url: URL) -> Bool

    func pause(nanoseconds: UInt64) async
}

/// The real sink: `CGEvent` posting and `NSWorkspace` activation.
@MainActor
struct SystemActionEventSink: ActionEventSink {
    private let codexBundleIdentifier = "com.openai.codex"

    var isAccessibilityTrusted: Bool { AXIsProcessTrusted() }

    func focus(policy: String) async -> String? {
        guard let application = NSRunningApplication.runningApplications(
            withBundleIdentifier: codexBundleIdentifier
        ).first else {
            return "Codex is not running; no input was sent."
        }
        let frontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        switch policy {
        case "focusIfNeeded":
            if frontmost != codexBundleIdentifier {
                application.activate(options: [])
                try? await Task.sleep(nanoseconds: 140_000_000)
            }
            guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier
                    == codexBundleIdentifier else {
                return "Codex could not be focused; no input was sent."
            }
        case "frontmostOnly", "neverFocus":
            guard frontmost == codexBundleIdentifier else {
                return "Codex is not frontmost; no input was sent."
            }
        default:
            return "The focus policy is invalid."
        }
        return nil
    }

    func postKey(keyCode: UInt16, modifiers: [String], keyDown: Bool) -> Bool {
        guard let source = CGEventSource(stateID: .combinedSessionState),
              let event = CGEvent(
                keyboardEventSource: source,
                virtualKey: CGKeyCode(keyCode),
                keyDown: keyDown
              ) else { return false }
        event.flags = Self.eventFlags(modifiers)
        event.post(tap: .cghidEventTap)
        return true
    }

    func postUnicode(_ codeUnits: [UInt16]) -> Bool {
        guard !codeUnits.isEmpty else { return true }
        guard let source = CGEventSource(stateID: .combinedSessionState),
              let down = CGEvent(
                keyboardEventSource: source,
                virtualKey: 0,
                keyDown: true
              ),
              let up = CGEvent(
                keyboardEventSource: source,
                virtualKey: 0,
                keyDown: false
              ) else { return false }
        codeUnits.withUnsafeBufferPointer { buffer in
            down.keyboardSetUnicodeString(
                stringLength: buffer.count,
                unicodeString: buffer.baseAddress
            )
            up.keyboardSetUnicodeString(
                stringLength: buffer.count,
                unicodeString: buffer.baseAddress
            )
        }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }

    func postPrimaryClick() -> Bool {
        let location = CGEvent(source: nil)?.location ?? NSEvent.mouseLocation
        guard let source = CGEventSource(stateID: .combinedSessionState),
              let down = CGEvent(
                mouseEventSource: source,
                mouseType: .leftMouseDown,
                mouseCursorPosition: location,
                mouseButton: .left
              ),
              let up = CGEvent(
                mouseEventSource: source,
                mouseType: .leftMouseUp,
                mouseCursorPosition: location,
                mouseButton: .left
              ) else { return false }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }

    func open(_ url: URL) -> Bool {
        NSWorkspace.shared.open(url)
    }

    func pause(nanoseconds: UInt64) async {
        try? await Task.sleep(nanoseconds: nanoseconds)
    }

    static func eventFlags(_ modifiers: [String]) -> CGEventFlags {
        var flags = CGEventFlags()
        if modifiers.contains("command") { flags.insert(.maskCommand) }
        if modifiers.contains("option") { flags.insert(.maskAlternate) }
        if modifiers.contains("control") { flags.insert(.maskControl) }
        if modifiers.contains("shift") { flags.insert(.maskShift) }
        return flags
    }
}
