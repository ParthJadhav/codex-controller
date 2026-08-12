import XCTest
@testable import ControllerBridge

final class ActionDispatchPolicyTests: XCTestCase {
    private let limit = ActionDispatchPolicy.textChunkLimit

    func testShortTextStaysOneChunk() {
        let chunks = ActionDispatchPolicy.textChunks("Ship it")

        XCTAssertEqual(chunks, [Array("Ship it".utf16)])
    }

    func testEmptyTextProducesNoChunks() {
        XCTAssertTrue(ActionDispatchPolicy.textChunks("").isEmpty)
    }

    func testLongTextIsCutIntoLimitSizedChunksThatReassemble() {
        let text = String(repeating: "a", count: 45)

        let chunks = ActionDispatchPolicy.textChunks(text)

        XCTAssertEqual(chunks.map(\.count), [20, 20, 5])
        XCTAssertEqual(String(decoding: chunks), text)
    }

    func testSurrogatePairIsNeverSplitAcrossChunks() {
        // The emoji is two UTF-16 units and would straddle the boundary at 19.
        let text = String(repeating: "a", count: 19) + "😀" + String(repeating: "b", count: 19)

        let chunks = ActionDispatchPolicy.textChunks(text)

        // The emoji moves whole to the second chunk rather than straddling it,
        // which leaves the first chunk one unit short of the limit.
        XCTAssertEqual(chunks.map(\.count), [19, 20, 1])
        XCTAssertEqual(String(decoding: chunks), text)
        for chunk in chunks {
            XCTAssertFalse(UTF16.isLeadSurrogate(chunk.last ?? 0))
            XCTAssertFalse(UTF16.isTrailSurrogate(chunk.first ?? 0))
        }
    }

    func testCombiningMarkStaysWithItsBaseCharacter() {
        // "e" + combining acute lands on the boundary at 19 units.
        let text = String(repeating: "a", count: 19) + "e\u{0301}" + "z"

        let chunks = ActionDispatchPolicy.textChunks(text)

        XCTAssertEqual(chunks.map(\.count), [19, 3])
        XCTAssertEqual(String(decoding: chunks), text)
    }

    func testGraphemeClusterWiderThanTheLimitIsSplitOnScalarBoundaries() {
        // A four-person family emoji is 11 UTF-16 units; at a limit of 4 it
        // cannot be kept whole, but no surrogate pair may be broken.
        let text = "👨‍👩‍👧‍👦"

        let chunks = ActionDispatchPolicy.textChunks(text, limit: 4)

        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(String(decoding: chunks), text)
        for chunk in chunks {
            XCTAssertLessThanOrEqual(chunk.count, 4)
            XCTAssertFalse(UTF16.isLeadSurrogate(chunk.last ?? 0))
            XCTAssertFalse(UTF16.isTrailSurrogate(chunk.first ?? 0))
        }
    }

    func testNoChunkEverExceedsTheLimitForMixedText() {
        let text = "Ship it 🚀 — reviewer notes, ünïcode, 日本語, and a 👩‍💻 emoji, twice over."

        let chunks = ActionDispatchPolicy.textChunks(text)

        XCTAssertEqual(String(decoding: chunks), text)
        for chunk in chunks {
            XCTAssertLessThanOrEqual(chunk.count, limit)
            XCTAssertFalse(chunk.isEmpty)
        }
    }

    func testHoldPhaseFollowsTheGesture() {
        XCTAssertEqual(ActionDispatchPolicy.holdPhase(gesture: "holdBegan"), .press)
        XCTAssertEqual(ActionDispatchPolicy.holdPhase(gesture: "holdEnded"), .release)
        // A sequence step is dispatched without a gesture and gets no
        // follow-up release, so it has to bound its own hold.
        XCTAssertEqual(ActionDispatchPolicy.holdPhase(gesture: nil), .pressAndRelease)
    }
}

private extension String {
    init(decoding chunks: [[UInt16]]) {
        self.init(decoding: chunks.flatMap { $0 }, as: UTF16.self)
    }
}
