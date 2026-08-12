import XCTest
@testable import ControllerBridge

final class DefaultAudioDeviceMarkerTests: XCTestCase {
    private var directory = FileManager.default.temporaryDirectory
    private var marker = DefaultAudioDeviceMarker()

    override func setUpWithError() throws {
        try super.setUpWithError()
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("marker-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        marker = DefaultAudioDeviceMarker(directory: directory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
        try super.tearDownWithError()
    }

    func testNoMarkerMeansNothingToRestore() {
        XCTAssertTrue(marker.pending().isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.url.path))
    }

    func testRecordsEachRouteSeparately() throws {
        try marker.record(.input, deviceUID: "BuiltInMicrophoneDevice")
        try marker.record(.output, deviceUID: "BuiltInSpeakerDevice")

        XCTAssertEqual(
            marker.pending(),
            [.input: "BuiltInMicrophoneDevice", .output: "BuiltInSpeakerDevice"]
        )
    }

    func testClearingTheLastRouteRemovesTheFile() throws {
        try marker.record(.input, deviceUID: "BuiltInMicrophoneDevice")

        try marker.clear(.input)

        XCTAssertTrue(marker.pending().isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: marker.url.path))
    }

    func testClearingOneRouteLeavesTheOther() throws {
        try marker.record(.input, deviceUID: "BuiltInMicrophoneDevice")
        try marker.record(.output, deviceUID: "BuiltInSpeakerDevice")

        try marker.clear(.output)

        XCTAssertEqual(marker.pending(), [.input: "BuiltInMicrophoneDevice"])
    }

    /// A second bridge start reads what the first one wrote — the whole point of
    /// the marker being a file instead of a property.
    func testAnotherMarkerOnTheSameDirectorySeesTheRecord() throws {
        try marker.record(.output, deviceUID: "BuiltInSpeakerDevice")

        XCTAssertEqual(
            DefaultAudioDeviceMarker(directory: directory).pending(),
            [.output: "BuiltInSpeakerDevice"]
        )
    }

    func testRestoreHandsBackEveryRememberedRouteAndForgetsIt() throws {
        try marker.record(.input, deviceUID: "BuiltInMicrophoneDevice")
        try marker.record(.output, deviceUID: "BuiltInSpeakerDevice")
        var seen: [DefaultAudioDeviceMarker.Route: String] = [:]

        let restored = try marker.restorePending { route, deviceUID in
            seen[route] = deviceUID
            return true
        }

        XCTAssertEqual(
            seen,
            [.input: "BuiltInMicrophoneDevice", .output: "BuiltInSpeakerDevice"]
        )
        XCTAssertEqual(Set(restored), [.input, .output])
        XCTAssertTrue(marker.pending().isEmpty)
    }

    /// A route macOS refused stays on file so the next start tries again.
    func testUnrestoredRouteSurvivesForTheNextStart() throws {
        try marker.record(.input, deviceUID: "BuiltInMicrophoneDevice")
        try marker.record(.output, deviceUID: "BuiltInSpeakerDevice")

        let restored = try marker.restorePending { route, _ in route == .output }

        XCTAssertEqual(restored, [.output])
        XCTAssertEqual(marker.pending(), [.input: "BuiltInMicrophoneDevice"])
    }

    func testRestoreOnAnEmptyMarkerNeverCallsBack() throws {
        var calls = 0

        let restored = try marker.restorePending { _, _ in
            calls += 1
            return true
        }

        XCTAssertEqual(calls, 0)
        XCTAssertTrue(restored.isEmpty)
    }

    func testUnreadableMarkerIsTreatedAsEmpty() throws {
        try Data("not json".utf8).write(to: marker.url)

        XCTAssertTrue(marker.pending().isEmpty)
        XCTAssertThrowsError(
            try marker.record(.output, deviceUID: "BuiltInSpeakerDevice")
        )
    }

    func testUnknownRouteNamesAreIgnored() throws {
        try Data(#"{"speaker":"SomeDevice","input":"BuiltInMicrophoneDevice"}"#.utf8)
            .write(to: marker.url)

        XCTAssertEqual(marker.pending(), [.input: "BuiltInMicrophoneDevice"])
    }

    func testWriteFailureIsPropagated() throws {
        let nonDirectory = directory.appendingPathComponent("not-a-directory")
        try Data("blocker".utf8).write(to: nonDirectory)
        let unwritableMarker = DefaultAudioDeviceMarker(directory: nonDirectory)

        XCTAssertThrowsError(
            try unwritableMarker.record(.output, deviceUID: "BuiltInSpeakerDevice")
        )
    }
}
