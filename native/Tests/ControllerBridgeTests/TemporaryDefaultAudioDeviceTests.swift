import CoreAudio
import XCTest
@testable import ControllerBridge

final class TemporaryDefaultAudioDeviceTests: XCTestCase {
    private var directory = FileManager.default.temporaryDirectory
    private var marker = DefaultAudioDeviceMarker()

    override func setUpWithError() throws {
        try super.setUpWithError()
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("audio-lease-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        marker = DefaultAudioDeviceMarker(directory: directory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
        try super.tearDownWithError()
    }

    func testInvalidStreamResultStillRestoresInputAndClearsMarker() async {
        var selected: [AudioDeviceID] = []

        let result = await TemporaryDefaultAudioDevice.performAsync(
            route: .input,
            previousDevice: 10,
            temporaryDevice: 20,
            previousDeviceUID: "BuiltInMicrophone",
            marker: marker,
            selectionFailure: "selection failed",
            restorationFailure: "restore failed",
            setDefault: {
                if selected.isEmpty {
                    XCTAssertEqual(marker.pending(), [.input: "BuiltInMicrophone"])
                }
                selected.append($0)
                return noErr
            }
        ) {
            (false, "The wired DualSense microphone has no usable stream.")
        }

        XCTAssertFalse(result.0)
        XCTAssertEqual(
            result.1,
            "The wired DualSense microphone has no usable stream."
        )
        XCTAssertEqual(selected, [20, 10])
        XCTAssertTrue(marker.pending().isEmpty)
    }

    func testRestoreFailureIsSeparateAndPreservesRecoveryMarker() {
        var selected: [AudioDeviceID] = []

        let result = TemporaryDefaultAudioDevice.perform(
            route: .output,
            previousDevice: 11,
            temporaryDevice: 21,
            previousDeviceUID: "BuiltInOutput",
            marker: marker,
            selectionFailure: "selection failed",
            restorationFailure: "macOS could not restore output.",
            setDefault: {
                selected.append($0)
                return selected.count == 1 ? noErr : OSStatus(-1)
            }
        ) {
            (true, "Playback completed.")
        }

        XCTAssertFalse(result.0)
        XCTAssertEqual(
            result.1,
            "Audio cleanup failed: macOS could not restore output."
        )
        XCTAssertEqual(selected, [21, 11])
        XCTAssertEqual(marker.pending(), [.output: "BuiltInOutput"])
    }

    func testPrimaryAndCleanupFailuresAreBothReported() {
        var calls = 0

        let result = TemporaryDefaultAudioDevice.perform(
            route: .input,
            previousDevice: 12,
            temporaryDevice: 22,
            previousDeviceUID: "BuiltInInput",
            marker: marker,
            selectionFailure: "selection failed",
            restorationFailure: "restore failed.",
            setDefault: { _ in
                calls += 1
                return calls == 1 ? noErr : OSStatus(-1)
            }
        ) {
            (false, "No buffers arrived.")
        }

        XCTAssertEqual(
            result.1,
            "No buffers arrived. Cleanup also failed: restore failed."
        )
        XCTAssertEqual(marker.pending(), [.input: "BuiltInInput"])
    }

    func testFailedTemporarySelectionDoesNotRunOperationOrLeaveMarker() {
        var operationRan = false
        var selected: [AudioDeviceID] = []

        let result = TemporaryDefaultAudioDevice.perform(
            route: .output,
            previousDevice: 13,
            temporaryDevice: 23,
            previousDeviceUID: "BuiltInOutput",
            marker: marker,
            selectionFailure: "selection failed",
            restorationFailure: "restore failed",
            setDefault: {
                selected.append($0)
                return selected.count == 1 ? OSStatus(-1) : noErr
            }
        ) {
            operationRan = true
            return (true, "unexpected")
        }

        XCTAssertEqual(result.1, "selection failed")
        XCTAssertEqual(selected, [23, 13])
        XCTAssertFalse(operationRan)
        XCTAssertTrue(marker.pending().isEmpty)
    }

    func testFailedTemporarySelectionAndFailedRestorationPreserveMarker() {
        var operationRan = false
        var selected: [AudioDeviceID] = []

        let result = TemporaryDefaultAudioDevice.perform(
            route: .output,
            previousDevice: 13,
            temporaryDevice: 23,
            previousDeviceUID: "BuiltInOutput",
            marker: marker,
            selectionFailure: "selection failed",
            restorationFailure: "restore failed",
            setDefault: {
                selected.append($0)
                return OSStatus(-1)
            }
        ) {
            operationRan = true
            return (true, "unexpected")
        }

        XCTAssertFalse(result.0)
        XCTAssertEqual(result.1, "selection failed Cleanup also failed: restore failed")
        XCTAssertEqual(selected, [23, 13])
        XCTAssertFalse(operationRan)
        XCTAssertEqual(marker.pending(), [.output: "BuiltInOutput"])
    }

    func testMissingPreviousUIDNeverSwitchesOrRunsOperation() {
        var selected: [AudioDeviceID] = []
        var operationRan = false

        let result = TemporaryDefaultAudioDevice.perform(
            route: .output,
            previousDevice: 13,
            temporaryDevice: 23,
            previousDeviceUID: nil,
            marker: marker,
            selectionFailure: "selection failed",
            restorationFailure: "restore failed",
            setDefault: {
                selected.append($0)
                return noErr
            }
        ) {
            operationRan = true
            return (true, "unexpected")
        }

        XCTAssertFalse(result.0)
        XCTAssertTrue(result.1.contains("no stable UID"))
        XCTAssertTrue(selected.isEmpty)
        XCTAssertFalse(operationRan)
        XCTAssertTrue(marker.pending().isEmpty)
    }

    func testEmptyPreviousUIDNeverSwitchesOrRunsOperation() {
        var selected: [AudioDeviceID] = []
        var operationRan = false

        let result = TemporaryDefaultAudioDevice.perform(
            route: .output,
            previousDevice: 13,
            temporaryDevice: 23,
            previousDeviceUID: "",
            marker: marker,
            selectionFailure: "selection failed",
            restorationFailure: "restore failed",
            setDefault: {
                selected.append($0)
                return noErr
            }
        ) {
            operationRan = true
            return (true, "unexpected")
        }

        XCTAssertFalse(result.0)
        XCTAssertTrue(result.1.contains("no stable UID"))
        XCTAssertTrue(selected.isEmpty)
        XCTAssertFalse(operationRan)
        XCTAssertTrue(marker.pending().isEmpty)
    }

    func testMarkerWriteFailureNeverSwitchesOrRunsOperationAndIsReported() throws {
        let nonDirectory = directory.appendingPathComponent("not-a-directory")
        try Data("blocker".utf8).write(to: nonDirectory)
        let unwritableMarker = DefaultAudioDeviceMarker(directory: nonDirectory)
        var selected: [AudioDeviceID] = []
        var operationRan = false

        let result = TemporaryDefaultAudioDevice.perform(
            route: .output,
            previousDevice: 13,
            temporaryDevice: 23,
            previousDeviceUID: "BuiltInOutput",
            marker: unwritableMarker,
            selectionFailure: "selection failed",
            restorationFailure: "restore failed",
            setDefault: {
                selected.append($0)
                return noErr
            }
        ) {
            operationRan = true
            return (true, "unexpected")
        }

        XCTAssertFalse(result.0)
        XCTAssertTrue(result.1.contains("Audio recovery could not be prepared"))
        XCTAssertTrue(selected.isEmpty)
        XCTAssertFalse(operationRan)
    }
}
