import XCTest
@testable import ControllerBridge

@MainActor
final class NativeCommandLineProcessorTests: XCTestCase {
    func testUnrelatedQuickCommandFinishesWhileEarlierCommandIsSuspended() async {
        let (lines, continuation) = AsyncStream.makeStream(of: String.self)
        let longCommandGate = TestGate()
        let quickCommandFinished = TestGate()
        var finished: [String] = []
        var tasks: [Task<Void, Never>] = []
        let processor = Task { @MainActor in
            await NativeCommandLineProcessor.run(
                lines,
                schedule: { command in
                    tasks.append(Task { @MainActor in
                        if command.id == "long" {
                            await longCommandGate.wait()
                        }
                        finished.append(command.id)
                        if command.id == "quick" {
                            quickCommandFinished.release()
                        }
                    })
                },
                malformed: {}
            )
        }

        continuation.yield(commandLine(id: "long"))
        await longCommandGate.waitUntilEntered()
        continuation.yield(commandLine(id: "quick"))
        await quickCommandFinished.waitUntilReleased()

        XCTAssertEqual(finished, ["quick"])
        longCommandGate.release()
        continuation.finish()
        await processor.value
        for task in tasks {
            await task.value
        }
        XCTAssertEqual(Set(finished), ["long", "quick"])
    }

    func testRegistrationOrderMatchesArrivalOrder() async {
        let (lines, continuation) = AsyncStream.makeStream(of: String.self)
        var registered: [String] = []
        continuation.yield(commandLine(id: "first"))
        continuation.yield(commandLine(id: "second"))
        continuation.finish()

        await NativeCommandLineProcessor.run(
            lines,
            schedule: { registered.append($0.id) },
            malformed: {}
        )

        XCTAssertEqual(registered, ["first", "second"])
    }

    func testMalformedLineKeepsItsPlaceBetweenValidCommands() async {
        let (lines, continuation) = AsyncStream.makeStream(of: String.self)
        var events: [String] = []
        continuation.yield(commandLine(id: "first"))
        continuation.yield("not-json")
        continuation.yield(commandLine(id: "second"))
        continuation.finish()

        await NativeCommandLineProcessor.run(
            lines,
            schedule: { events.append($0.id) },
            malformed: { events.append("malformed") }
        )

        XCTAssertEqual(events, ["first", "malformed", "second"])
    }

    private func commandLine(id: String) -> String {
        #"{"id":"\#(id)","command":"action.execute","payload":{}}"#
    }
}

@MainActor
private final class TestGate {
    private var entered = false
    private var released = false
    private var releaseContinuation: CheckedContinuation<Void, Never>?
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private var releasedContinuations: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        entered = true
        enteredContinuation?.resume()
        enteredContinuation = nil
        if released { return }
        await withCheckedContinuation { continuation in
            releaseContinuation = continuation
        }
    }

    func waitUntilEntered() async {
        guard !entered else { return }
        await withCheckedContinuation { continuation in
            enteredContinuation = continuation
        }
    }

    func waitUntilReleased() async {
        guard !released else { return }
        await withCheckedContinuation { continuation in
            releasedContinuations.append(continuation)
        }
    }

    func release() {
        guard !released else { return }
        released = true
        releaseContinuation?.resume()
        releaseContinuation = nil
        let continuations = releasedContinuations
        releasedContinuations.removeAll()
        continuations.forEach { $0.resume() }
    }
}
