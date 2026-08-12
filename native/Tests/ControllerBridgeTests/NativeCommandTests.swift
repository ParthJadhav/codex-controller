import XCTest
@testable import ControllerBridge

final class NativeCommandTests: XCTestCase {
    func testParsesIdentifierCommandAndPayload() throws {
        let command = try XCTUnwrap(
            NativeCommand(
                line: ##"{"id":"7","command":"light.set","payload":{"color":"#ff0000"}}"##
            )
        )

        XCTAssertEqual(command.id, "7")
        XCTAssertEqual(command.command, "light.set")
        XCTAssertEqual(command.payload["color"] as? String, "#ff0000")
    }

    func testMissingPayloadReadsAsEmpty() throws {
        let command = try XCTUnwrap(NativeCommand(line: #"{"id":"7","command":"system.refresh"}"#))

        XCTAssertTrue(command.payload.isEmpty)
    }

    /// A payload of the wrong shape loses only the arguments, not the command:
    /// the renderer still gets a response it can match to its request.
    func testNonObjectPayloadReadsAsEmpty() throws {
        let command = try XCTUnwrap(
            NativeCommand(line: #"{"id":"7","command":"system.refresh","payload":"noop"}"#)
        )

        XCTAssertTrue(command.payload.isEmpty)
    }

    func testRejectsMissingIdentifier() {
        XCTAssertNil(NativeCommand(line: #"{"command":"system.refresh"}"#))
    }

    func testRejectsMissingCommand() {
        XCTAssertNil(NativeCommand(line: #"{"id":"7"}"#))
    }

    func testRejectsNonStringIdentifier() {
        XCTAssertNil(NativeCommand(line: #"{"id":7,"command":"system.refresh"}"#))
    }

    func testRejectsMalformedJSON() {
        XCTAssertNil(NativeCommand(line: #"{"id":"7","command":"#))
    }

    func testRejectsJSONThatIsNotAnObject() {
        XCTAssertNil(NativeCommand(line: #"["id","command"]"#))
    }

    func testRejectsEmptyLine() {
        XCTAssertNil(NativeCommand(line: ""))
    }
}
