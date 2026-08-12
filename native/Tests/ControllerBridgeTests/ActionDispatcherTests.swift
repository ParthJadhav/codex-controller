import XCTest
@testable import ControllerBridge

/// Records what the dispatcher asked the system to do instead of doing it, so
/// event order — chunk boundaries, press/release pairing, sequence steps — can
/// be asserted without a window server or an Accessibility grant.
@MainActor
private final class RecordingActionEventSink: ActionEventSink {
    enum Effect: Equatable {
        case focus(policy: String)
        case key(keyCode: UInt16, modifiers: [String], keyDown: Bool)
        case unicode([UInt16])
        case primaryClick
        case open(String)
        case pause(nanoseconds: UInt64)
    }

    var isAccessibilityTrusted = true
    var focusFailure: String?
    var keyResult = true
    var unicodeResult = true
    var suspendFocus = false
    private var focusStartedContinuations: [CheckedContinuation<Void, Never>] = []
    private var focusResumeContinuations: [CheckedContinuation<Void, Never>] = []
    private(set) var effects: [Effect] = []

    var keyEvents: [Effect] {
        effects.filter { if case .key = $0 { true } else { false } }
    }

    var unicodeChunks: [[UInt16]] {
        effects.compactMap { if case let .unicode(units) = $0 { units } else { nil } }
    }

    func focus(policy: String) async -> String? {
        effects.append(.focus(policy: policy))
        if suspendFocus {
            let started = focusStartedContinuations
            focusStartedContinuations.removeAll()
            started.forEach { $0.resume() }
            await withCheckedContinuation { focusResumeContinuations.append($0) }
        }
        return focusFailure
    }

    func waitUntilFocusStarts() async {
        if effects.contains(where: { if case .focus = $0 { true } else { false } }) {
            return
        }
        await withCheckedContinuation { focusStartedContinuations.append($0) }
    }

    func resumeFocus() {
        suspendFocus = false
        let continuations = focusResumeContinuations
        focusResumeContinuations.removeAll()
        continuations.forEach { $0.resume() }
    }

    func postKey(keyCode: UInt16, modifiers: [String], keyDown: Bool) -> Bool {
        effects.append(.key(keyCode: keyCode, modifiers: modifiers, keyDown: keyDown))
        return keyResult
    }

    func postUnicode(_ codeUnits: [UInt16]) -> Bool {
        effects.append(.unicode(codeUnits))
        return unicodeResult
    }

    func postPrimaryClick() -> Bool {
        effects.append(.primaryClick)
        return true
    }

    func open(_ url: URL) -> Bool {
        effects.append(.open(url.absoluteString))
        return true
    }

    func pause(nanoseconds: UInt64) async {
        effects.append(.pause(nanoseconds: nanoseconds))
    }
}

@MainActor
final class ActionDispatcherTests: XCTestCase {
    private let shortcut: [String: Any] = [
        "keyCode": 49,
        "modifiers": ["command"]
    ]

    // MARK: - Regression: chunked text insertion

    func testTextInsertionPostsEveryChunkInOrder() async {
        let sink = RecordingActionEventSink()
        let text = String(repeating: "a", count: 45)

        let result = await ActionDispatcher(sink: sink).execute([
            "action": ["type": "textInsertion", "title": "Notes", "text": text],
            "focusPolicy": "focusIfNeeded"
        ])

        XCTAssertTrue(result.0)
        XCTAssertEqual(sink.unicodeChunks.map(\.count), [20, 20, 5])
        XCTAssertEqual(
            String(decoding: sink.unicodeChunks.flatMap { $0 }, as: UTF16.self),
            text
        )
    }

    func testTextInsertionStopsAtTheFirstChunkTheSystemRefuses() async {
        let sink = RecordingActionEventSink()
        sink.unicodeResult = false

        let result = await ActionDispatcher(sink: sink).execute([
            "action": [
                "type": "textInsertion",
                "title": "Notes",
                "text": String(repeating: "a", count: 45)
            ],
            "focusPolicy": "focusIfNeeded"
        ])

        XCTAssertFalse(result.0)
        XCTAssertEqual(sink.unicodeChunks.count, 1)
    }

    func testMessageSendChunksTheBodyThenPostsReturn() async {
        let sink = RecordingActionEventSink()

        let result = await ActionDispatcher(sink: sink).sendMessage([
            "message": String(repeating: "b", count: 25)
        ])

        XCTAssertTrue(result.0)
        XCTAssertEqual(sink.unicodeChunks.map(\.count), [20, 5])
        XCTAssertEqual(
            sink.keyEvents,
            [
                .key(keyCode: 36, modifiers: [], keyDown: true),
                .key(keyCode: 36, modifiers: [], keyDown: false)
            ]
        )
    }

    // MARK: - Regression: holdShortcut inside a sequence

    func testHoldShortcutInASequencePressesThenReleases() async {
        let sink = RecordingActionEventSink()

        let result = await ActionDispatcher(sink: sink).execute([
            "action": [
                "type": "sequence",
                "title": "Dictate",
                "sequenceSteps": [
                    [
                        "id": "step-1",
                        "delayMilliseconds": 0,
                        "focusPolicy": "focusIfNeeded",
                        "safety": "normal",
                        "action": [
                            "type": "holdShortcut",
                            "title": "Talk",
                            "shortcut": shortcut
                        ]
                    ]
                ]
            ],
            "focusPolicy": "focusIfNeeded"
        ])

        XCTAssertTrue(result.0)
        XCTAssertEqual(
            sink.effects,
            [
                .focus(policy: "focusIfNeeded"),
                .key(keyCode: 49, modifiers: ["command"], keyDown: true),
                .pause(nanoseconds: ActionDispatchPolicy.boundedHoldNanoseconds),
                .key(keyCode: 49, modifiers: ["command"], keyDown: false)
            ]
        )
    }

    func testHoldShortcutInASequenceReleasesEvenWhenTheReleaseFails() async {
        let sink = RecordingActionEventSink()

        _ = await ActionDispatcher(sink: sink).execute([
            "action": [
                "type": "sequence",
                "title": "Dictate",
                "sequenceSteps": [
                    [
                        "id": "step-1",
                        "delayMilliseconds": 120,
                        "focusPolicy": "frontmostOnly",
                        "safety": "normal",
                        "action": [
                            "type": "holdShortcut",
                            "title": "Talk",
                            "shortcut": shortcut
                        ]
                    ]
                ]
            ]
        ])

        // The step's own focus policy is used, the delay is honoured, and the
        // key never stays down.
        XCTAssertEqual(sink.effects.first, .pause(nanoseconds: 120_000_000))
        XCTAssertEqual(sink.effects[1], .focus(policy: "frontmostOnly"))
        XCTAssertEqual(sink.keyEvents.last, .key(keyCode: 49, modifiers: ["command"], keyDown: false))
    }

    func testTopLevelHoldGesturesStillPostOneHalfEach() async {
        let began = RecordingActionEventSink()
        let ended = RecordingActionEventSink()
        let action: [String: Any] = [
            "type": "holdShortcut",
            "title": "Talk",
            "shortcut": shortcut
        ]

        _ = await ActionDispatcher(sink: began).execute([
            "action": action,
            "focusPolicy": "focusIfNeeded",
            "gesture": "holdBegan"
        ])
        _ = await ActionDispatcher(sink: ended).execute([
            "action": action,
            "focusPolicy": "focusIfNeeded",
            "gesture": "holdEnded"
        ])

        XCTAssertEqual(began.keyEvents, [.key(keyCode: 49, modifiers: ["command"], keyDown: true)])
        XCTAssertEqual(ended.keyEvents, [.key(keyCode: 49, modifiers: ["command"], keyDown: false)])
        // Releasing must not depend on Codex being focusable.
        XCTAssertEqual(began.effects.first, .focus(policy: "focusIfNeeded"))
        XCTAssertTrue(ended.effects.allSatisfy { if case .focus = $0 { false } else { true } })
    }

    /// The native bridge handles stdin lines in independent MainActor tasks.
    /// A holdEnded arriving while holdBegan is suspended in focus must wait;
    /// otherwise key-up posts first and key-down becomes permanently stuck.
    func testHoldReleaseCannotOvertakePressSuspendedInFocus() async {
        let sink = RecordingActionEventSink()
        sink.suspendFocus = true
        let dispatcher = ActionDispatcher(sink: sink)
        let action: [String: Any] = [
            "type": "holdShortcut",
            "title": "Talk",
            "shortcut": shortcut
        ]

        let press = Task { @MainActor in
            await dispatcher.execute([
                "action": action,
                "focusPolicy": "focusIfNeeded",
                "gesture": "holdBegan"
            ])
        }
        await sink.waitUntilFocusStarts()
        let release = Task { @MainActor in
            await dispatcher.execute([
                "action": action,
                "focusPolicy": "focusIfNeeded",
                "gesture": "holdEnded"
            ])
        }
        await Task.yield()

        XCTAssertTrue(sink.keyEvents.isEmpty)
        XCTAssertEqual(dispatcher.pendingHeldShortcutOperationCount, 2)

        sink.resumeFocus()
        _ = await press.value
        _ = await release.value

        XCTAssertEqual(
            sink.keyEvents,
            [
                .key(keyCode: 49, modifiers: ["command"], keyDown: true),
                .key(keyCode: 49, modifiers: ["command"], keyDown: false)
            ]
        )
        XCTAssertEqual(dispatcher.pendingHeldShortcutOperationCount, 0)
    }

    func testPreRegisteredHoldOrderSurvivesReverseTaskStart() async {
        let sink = RecordingActionEventSink()
        sink.suspendFocus = true
        let dispatcher = ActionDispatcher(sink: sink)
        let action: [String: Any] = [
            "type": "holdShortcut",
            "title": "Talk",
            "shortcut": shortcut
        ]
        let pressRequest: [String: Any] = [
            "action": action,
            "focusPolicy": "focusIfNeeded",
            "gesture": "holdBegan"
        ]
        let releaseRequest: [String: Any] = [
            "action": action,
            "focusPolicy": "focusIfNeeded",
            "gesture": "holdEnded"
        ]

        // Registration follows stdin order. Deliberately start the task bodies
        // in the opposite order to prove executor scheduling cannot invert the
        // physical key events.
        let pressReservation = dispatcher.reserve(pressRequest)
        let releaseReservation = dispatcher.reserve(releaseRequest)
        let release = Task { @MainActor in
            await dispatcher.execute(
                releaseRequest,
                reservation: releaseReservation
            )
        }
        await Task.yield()
        XCTAssertTrue(sink.keyEvents.isEmpty)

        let press = Task { @MainActor in
            await dispatcher.execute(
                pressRequest,
                reservation: pressReservation
            )
        }
        await sink.waitUntilFocusStarts()
        XCTAssertTrue(sink.keyEvents.isEmpty)

        sink.resumeFocus()
        _ = await press.value
        _ = await release.value

        XCTAssertEqual(
            sink.keyEvents,
            [
                .key(keyCode: 49, modifiers: ["command"], keyDown: true),
                .key(keyCode: 49, modifiers: ["command"], keyDown: false)
            ]
        )
        XCTAssertEqual(dispatcher.pendingHeldShortcutOperationCount, 0)
    }

    func testReleaseForDifferentChordFinishesWhileEarlierPressIsSuspended() async {
        let sink = RecordingActionEventSink()
        sink.suspendFocus = true
        let dispatcher = ActionDispatcher(sink: sink)
        let press = Task { @MainActor in
            await dispatcher.execute([
                "action": [
                    "type": "holdShortcut",
                    "title": "Talk",
                    "shortcut": shortcut
                ],
                "focusPolicy": "focusIfNeeded",
                "gesture": "holdBegan"
            ])
        }
        await sink.waitUntilFocusStarts()

        let release = await dispatcher.execute([
            "action": [
                "type": "holdShortcut",
                "title": "Mute",
                "shortcut": [
                    "keyCode": 46,
                    "modifiers": ["command"]
                ]
            ],
            "gesture": "holdEnded"
        ])

        XCTAssertTrue(release.0)
        XCTAssertEqual(
            sink.keyEvents,
            [.key(keyCode: 46, modifiers: ["command"], keyDown: false)]
        )

        sink.resumeFocus()
        _ = await press.value
        XCTAssertEqual(
            sink.keyEvents,
            [
                .key(keyCode: 46, modifiers: ["command"], keyDown: false),
                .key(keyCode: 49, modifiers: ["command"], keyDown: true)
            ]
        )
        XCTAssertEqual(dispatcher.pendingHeldShortcutOperationCount, 0)
    }

    func testHoldReleaseIsAttemptedAfterAccessibilityIsRevoked() async {
        let sink = RecordingActionEventSink()
        sink.isAccessibilityTrusted = false

        let result = await ActionDispatcher(sink: sink).execute([
            "action": [
                "type": "holdShortcut",
                "title": "Talk",
                "shortcut": shortcut
            ],
            "gesture": "holdEnded"
        ])

        XCTAssertTrue(result.0)
        XCTAssertEqual(
            sink.keyEvents,
            [.key(keyCode: 49, modifiers: ["command"], keyDown: false)]
        )
    }

    // MARK: - Gates and step failures

    func testSequenceStopsAtTheFirstFailedStep() async {
        let sink = RecordingActionEventSink()

        let result = await ActionDispatcher(sink: sink).execute([
            "action": [
                "type": "sequence",
                "title": "Dictate",
                "sequenceSteps": [
                    [
                        "id": "step-1",
                        "delayMilliseconds": 0,
                        "focusPolicy": "focusIfNeeded",
                        "safety": "normal",
                        "action": ["type": "holdShortcut", "title": "Talk"]
                    ],
                    [
                        "id": "step-2",
                        "delayMilliseconds": 0,
                        "focusPolicy": "focusIfNeeded",
                        "safety": "normal",
                        "action": [
                            "type": "keyboardShortcut",
                            "title": "Send",
                            "shortcut": shortcut
                        ]
                    ]
                ]
            ]
        ])

        XCTAssertFalse(result.0)
        XCTAssertEqual(result.1, "Step 1 — No keyboard shortcut is configured.")
        XCTAssertTrue(sink.keyEvents.isEmpty)
    }

    func testNothingIsPostedWithoutAccessibility() async {
        let sink = RecordingActionEventSink()
        sink.isAccessibilityTrusted = false

        let result = await ActionDispatcher(sink: sink).execute([
            "action": ["type": "keyboardShortcut", "title": "Send", "shortcut": shortcut]
        ])

        XCTAssertFalse(result.0)
        XCTAssertTrue(sink.keyEvents.isEmpty)
    }

    func testFocusFailureBlocksTheKeystroke() async {
        let sink = RecordingActionEventSink()
        sink.focusFailure = "Codex is not frontmost; no input was sent."

        let result = await ActionDispatcher(sink: sink).execute([
            "action": ["type": "keyboardShortcut", "title": "Send", "shortcut": shortcut],
            "focusPolicy": "frontmostOnly"
        ])

        XCTAssertFalse(result.0)
        XCTAssertEqual(result.1, "Codex is not frontmost; no input was sent.")
        XCTAssertTrue(sink.keyEvents.isEmpty)
    }
}
