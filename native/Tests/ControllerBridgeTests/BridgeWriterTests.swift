import Darwin
import XCTest
@testable import ControllerBridge

final class BridgeWriterTests: XCTestCase {
    func testFlushDrainsQueuedResponsesInOrder() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bridge-writer-flush-\(UUID().uuidString).jsonl")
        defer { try? FileManager.default.removeItem(at: url) }
        let descriptor = open(url.path, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
        try XCTSkipIf(descriptor < 0, "The scratch file could not be opened.")
        let writer = BridgeWriter(descriptor: descriptor)

        writer.response(id: "hold-began", success: true, message: "began")
        writer.response(id: "hold-ended", success: true, message: "ended")
        writer.flush()
        close(descriptor)

        let contents = try String(contentsOf: url, encoding: .utf8)
        let ids = try contents.split(separator: "\n").map { line -> String in
            let value = try XCTUnwrap(
                JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
            )
            return try XCTUnwrap(value["id"] as? String)
        }
        XCTAssertEqual(ids, ["hold-began", "hold-ended"])
    }

    func testWritesEveryByteToTheDescriptor() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bridge-writer-\(UUID().uuidString).jsonl")
        defer { try? FileManager.default.removeItem(at: url) }
        let descriptor = open(url.path, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
        try XCTSkipIf(descriptor < 0, "The scratch file could not be opened.")

        let line = Array(#"{"type":"controller"}"# .utf8) + Array("\n".utf8)
        XCTAssertTrue(BridgeWriter.writeAll(line, to: descriptor))
        close(descriptor)

        XCTAssertEqual(try Data(contentsOf: url), Data(line))
    }

    /// The bridge outliving Electron is an ordinary shutdown order. Before this,
    /// the first line written afterwards took the process down with it.
    func testBrokenPipeFailsWithoutTerminatingTheProcess() {
        var descriptors: [Int32] = [0, 0]
        XCTAssertEqual(pipe(&descriptors), 0)
        close(descriptors[0])
        defer { close(descriptors[1]) }

        XCTAssertFalse(BridgeWriter.writeAll(Array("dropped\n".utf8), to: descriptors[1]))
    }

    func testClosedDescriptorFails() {
        XCTAssertFalse(BridgeWriter.writeAll(Array("dropped\n".utf8), to: -1))
    }

    func testEmptyPayloadSucceedsWithoutTouchingTheDescriptor() {
        XCTAssertTrue(BridgeWriter.writeAll([], to: -1))
    }

    /// A payload larger than the pipe buffer comes back in more than one
    /// `write(2)`, and the remainder has to be resumed rather than dropped.
    func testResumesShortWrites() throws {
        var descriptors: [Int32] = [0, 0]
        XCTAssertEqual(pipe(&descriptors), 0)
        defer {
            close(descriptors[0])
            close(descriptors[1])
        }
        let payload = [UInt8](repeating: UInt8(ascii: "a"), count: 256 * 1_024)

        let reader = DispatchQueue(label: "BridgeWriterTests.reader")
        let received = expectation(description: "every byte read")
        nonisolated(unsafe) var readCount = 0
        reader.async {
            var buffer = [UInt8](repeating: 0, count: 32 * 1_024)
            while readCount < payload.count {
                let count = buffer.withUnsafeMutableBytes {
                    read(descriptors[0], $0.baseAddress, $0.count)
                }
                guard count > 0 else { break }
                readCount += count
            }
            received.fulfill()
        }

        XCTAssertTrue(BridgeWriter.writeAll(payload, to: descriptors[1]))
        wait(for: [received], timeout: 5)
        XCTAssertEqual(readCount, payload.count)
    }
}
