import Foundation

@MainActor
final class ActionDispatcher {
    private let sink: ActionEventSink
    fileprivate struct HeldShortcutIdentity: Hashable {
        let keyCode: UInt16
        let modifiers: [String]
    }

    @MainActor
    fileprivate final class HeldShortcutTurn {
        private var completed = false
        private var waiters: [CheckedContinuation<Void, Never>] = []

        func wait() async {
            guard !completed else { return }
            await withCheckedContinuation { waiters.append($0) }
        }

        @discardableResult
        func complete() -> Bool {
            guard !completed else { return false }
            completed = true
            let pending = waiters
            waiters.removeAll()
            pending.forEach { $0.resume() }
            return true
        }
    }

    fileprivate struct HeldShortcutReservation {
        let identity: HeldShortcutIdentity
        let predecessor: HeldShortcutTurn?
        let turn: HeldShortcutTurn
    }

    struct ExecutionReservation {
        fileprivate let heldShortcut: HeldShortcutReservation?
    }

    private var heldShortcutTails: [HeldShortcutIdentity: HeldShortcutTurn] = [:]
    private var heldShortcutReservationCount = 0

    /// Exposed internally for the concurrency regression test. A completed
    /// begin/end pair must not leave a reserved or suspended turn behind.
    var pendingHeldShortcutOperationCount: Int {
        heldShortcutReservationCount
    }

    init(sink: ActionEventSink? = nil) {
        self.sink = sink ?? SystemActionEventSink()
    }

    func execute(_ request: [String: Any]) async -> (Bool, String) {
        let reservation = reserve(request)
        return await execute(request, reservation: reservation)
    }

    /// Reserves a FIFO turn for an ordering-sensitive held chord before its
    /// command task starts. The stdin scheduler calls this synchronously in
    /// line order, so executor scheduling can never turn key-up into key-down.
    func reserve(_ request: [String: Any]) -> ExecutionReservation {
        guard let action = request["action"] as? [String: Any],
              action["type"] as? String == "holdShortcut",
              ActionDispatchPolicy.holdPhase(
                gesture: request["gesture"] as? String
              ) != .pressAndRelease,
              let keyCode = Self.keyCode(action) else {
            return ExecutionReservation(heldShortcut: nil)
        }
        let identity = HeldShortcutIdentity(
            keyCode: keyCode,
            modifiers: Array(Set(Self.modifiers(action))).sorted()
        )
        return ExecutionReservation(heldShortcut: reserveHeldShortcut(identity))
    }

    func execute(
        _ request: [String: Any],
        reservation: ExecutionReservation
    ) async -> (Bool, String) {
        guard let action = request["action"] as? [String: Any],
              let type = action["type"] as? String else {
            return (false, "The native action request is invalid.")
        }
        let focus = request["focusPolicy"] as? String ?? "focusIfNeeded"
        return await dispatch(
            action,
            type: type,
            focus: focus,
            gesture: request["gesture"] as? String,
            heldShortcutReservation: reservation.heldShortcut
        )
    }

    func sendMessage(_ payload: [String: Any]) async -> (Bool, String) {
        guard let message = payload["message"] as? String else {
            return (false, "The message is missing.")
        }
        let value = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return (false, "Enter a message before sending.") }
        guard value.utf16.count <= 10_000 else { return (false, "The message is too long.") }
        if let failure = await sink.focus(policy: "focusIfNeeded") { return (false, failure) }
        guard sink.isAccessibilityTrusted else {
            return (false, "Accessibility permission is required to send a message.")
        }
        guard postText(value) else { return (false, "The message could not be inserted.") }
        await sink.pause(nanoseconds: 90_000_000)
        return postShortcut(keyCode: 36, modifiers: [])
            ? (true, "Message sent to Codex.")
            : (false, "The message was inserted, but Return could not be sent.")
    }

    private func dispatch(
        _ action: [String: Any],
        type: String,
        focus: String,
        gesture: String? = nil,
        heldShortcutReservation: HeldShortcutReservation? = nil
    ) async -> (Bool, String) {
        let title = action["title"] as? String ?? "Action"
        switch type {
        case "none":
            return (false, "This control is unassigned.")
        case "deepLink":
            guard let value = action["deepLinkURL"] as? String,
                  let url = URL(string: value),
                  url.scheme?.lowercased() == "codex" else {
                return (false, "The Codex deep link is invalid.")
            }
            return sink.open(url)
                ? (true, "Opened \(title).")
                : (false, "macOS could not open the Codex link.")
        case "openWebURL":
            guard let value = action["deepLinkURL"] as? String,
                  let url = URL(string: value),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
                return (false, "Only valid HTTP or HTTPS URLs can be opened.")
            }
            return sink.open(url)
                ? (true, "Opened \(title).")
                : (false, "macOS could not open the URL.")
        case "keyboardShortcut":
            if let failure = await sink.focus(policy: focus) { return (false, failure) }
            guard sink.isAccessibilityTrusted else {
                return (false, "Accessibility permission is required for keyboard shortcuts.")
            }
            guard let keyCode = Self.keyCode(action) else {
                return (false, "No keyboard shortcut is configured.")
            }
            return postShortcut(keyCode: keyCode, modifiers: Self.modifiers(action))
                ? (true, "\(title) dispatched.")
                : (false, "The keyboard shortcut could not be created.")
        case "holdShortcut":
            // Push-to-talk needs the key to stay down for as long as the
            // control is held, so the two halves of the keystroke arrive as
            // separate requests. The release is posted even if the press could
            // not be delivered, so a stuck modifier is not possible.
            //
            // A sequence step has no gesture and no follow-up request, so
            // neither half alone works there: a bare key-down would wedge the
            // key and a bare key-up — what a nested hold used to post — did
            // nothing at all. Inside a sequence the hold bounds itself.
            let phase = ActionDispatchPolicy.holdPhase(gesture: gesture)
            guard let keyCode = Self.keyCode(action) else {
                return (false, "No keyboard shortcut is configured.")
            }
            let modifiers = Self.modifiers(action)
            switch phase {
            case .press, .release:
                let identity = HeldShortcutIdentity(
                    keyCode: keyCode,
                    modifiers: Array(Set(modifiers)).sorted()
                )
                let reservation: HeldShortcutReservation
                if let heldShortcutReservation,
                   heldShortcutReservation.identity == identity {
                    reservation = heldShortcutReservation
                } else {
                    reservation = reserveHeldShortcut(identity)
                }
                if let predecessor = reservation.predecessor {
                    await predecessor.wait()
                }
                defer { finishHeldShortcut(reservation) }

                let pressing = phase == .press
                if pressing, let failure = await sink.focus(policy: focus) {
                    return (false, failure)
                }
                // A release is cleanup, not a new privileged action. Attempt it
                // even if Accessibility was revoked after the press; refusing
                // it here is exactly how a modifier can remain down system-wide.
                guard !pressing || sink.isAccessibilityTrusted else {
                    return (
                        false,
                        "Accessibility permission is required for keyboard shortcuts."
                    )
                }
                return sink.postKey(
                    keyCode: keyCode,
                    modifiers: modifiers,
                    keyDown: pressing
                )
                    ? (true, pressing ? "\(title) held." : "\(title) released.")
                    : (false, "The keyboard event could not be created.")
            case .pressAndRelease:
                if let failure = await sink.focus(policy: focus) {
                    return (false, failure)
                }
                guard sink.isAccessibilityTrusted else {
                    return (
                        false,
                        "Accessibility permission is required for keyboard shortcuts."
                    )
                }
                guard sink.postKey(keyCode: keyCode, modifiers: modifiers, keyDown: true) else {
                    return (false, "The keyboard event could not be created.")
                }
                await sink.pause(nanoseconds: ActionDispatchPolicy.boundedHoldNanoseconds)
                return sink.postKey(keyCode: keyCode, modifiers: modifiers, keyDown: false)
                    ? (true, "\(title) held and released.")
                    : (false, "\(title) was held, but the release could not be sent.")
            }
        case "primaryClick":
            // The touchpad's own pointer path already clicks while it is
            // driving the cursor. This is the same click for the case where the
            // pointer is off and the touchpad button is an ordinary mapping.
            guard sink.isAccessibilityTrusted else {
                return (false, "Accessibility permission is required for mouse clicks.")
            }
            return sink.postPrimaryClick()
                ? (true, "\(title) dispatched.")
                : (false, "The mouse click could not be created.")
        case "textInsertion":
            if let failure = await sink.focus(policy: focus) { return (false, failure) }
            guard sink.isAccessibilityTrusted else {
                return (false, "Accessibility permission is required for text insertion.")
            }
            guard let text = action["text"] as? String, !text.isEmpty else {
                return (false, "No text is configured.")
            }
            return postText(text)
                ? (true, "\(title) inserted.")
                : (false, "The text event could not be created.")
        case "sequence":
            guard let steps = action["sequenceSteps"] as? [[String: Any]], !steps.isEmpty else {
                return (false, "No sequence steps are configured.")
            }
            for (index, step) in steps.enumerated() {
                let delay = (step["delayMilliseconds"] as? NSNumber)?.uint64Value ?? 0
                if delay > 0 { await sink.pause(nanoseconds: delay * 1_000_000) }
                guard let nested = step["action"] as? [String: Any],
                      let nestedType = nested["type"] as? String else {
                    return (false, "Sequence step \(index + 1) is invalid.")
                }
                let result = await dispatch(
                    nested,
                    type: nestedType,
                    focus: step["focusPolicy"] as? String ?? "focusIfNeeded"
                )
                if !result.0 { return (false, "Step \(index + 1) — \(result.1)") }
            }
            return (true, "Completed \(title).")
        case "layerShift":
            return (true, "\(title) active.")
        default:
            return (false, "The action type is not supported.")
        }
    }

    private static func keyCode(_ action: [String: Any]) -> UInt16? {
        guard let shortcut = action["shortcut"] as? [String: Any] else { return nil }
        return (shortcut["keyCode"] as? NSNumber)?.uint16Value
    }

    private static func modifiers(_ action: [String: Any]) -> [String] {
        guard let shortcut = action["shortcut"] as? [String: Any] else { return [] }
        return shortcut["modifiers"] as? [String] ?? []
    }

    private func postShortcut(keyCode: UInt16, modifiers: [String]) -> Bool {
        sink.postKey(keyCode: keyCode, modifiers: modifiers, keyDown: true)
            && sink.postKey(keyCode: keyCode, modifiers: modifiers, keyDown: false)
    }

    private func postText(_ text: String) -> Bool {
        for chunk in ActionDispatchPolicy.textChunks(text) {
            guard sink.postUnicode(chunk) else { return false }
        }
        return true
    }

    /// Adds one turn to a per-chord FIFO chain synchronously. Different chords
    /// have different tails and never wait for one another.
    private func reserveHeldShortcut(
        _ identity: HeldShortcutIdentity
    ) -> HeldShortcutReservation {
        let turn = HeldShortcutTurn()
        let reservation = HeldShortcutReservation(
            identity: identity,
            predecessor: heldShortcutTails[identity],
            turn: turn
        )
        heldShortcutTails[identity] = turn
        heldShortcutReservationCount += 1
        return reservation
    }

    private func finishHeldShortcut(_ reservation: HeldShortcutReservation) {
        guard reservation.turn.complete() else { return }
        heldShortcutReservationCount -= 1
        if heldShortcutTails[reservation.identity] === reservation.turn {
            heldShortcutTails[reservation.identity] = nil
        }
    }
}
