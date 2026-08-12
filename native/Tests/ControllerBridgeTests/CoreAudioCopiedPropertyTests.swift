import CoreAudio
import XCTest
@testable import ControllerBridge

final class CoreAudioCopiedPropertyTests: XCTestCase {
    /// This cannot replace Instruments/leaks, but it continuously exercises the
    /// exact retained-return path that used to leak once per system.refresh.
    func testRepeatedDeviceNameReadsUseTheSharedOwnedPropertyPath() throws {
        guard let device = AudioDeviceUID.allDeviceIDs().first else {
            throw XCTSkip("This machine exposes no CoreAudio devices.")
        }
        let expected = CoreAudioCopiedProperty.string(
            objectID: device,
            selector: kAudioObjectPropertyName
        )

        for _ in 0..<100 {
            XCTAssertEqual(
                CoreAudioCopiedProperty.string(
                    objectID: device,
                    selector: kAudioObjectPropertyName
                ),
                expected
            )
        }
    }
}
