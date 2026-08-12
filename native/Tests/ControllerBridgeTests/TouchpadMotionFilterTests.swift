import XCTest
@testable import ControllerBridge

final class TouchpadMotionFilterTests: XCTestCase {
    func testFirstTrackedSampleEstablishesContactWithoutMovingPointer() {
        var filter = TouchpadMotionFilter()

        XCTAssertNil(filter.moveTracked(x: 300, y: 400, timestamp: 1))
    }

    func testTrackedMotionUsesPhysicalSurfaceDeltasOnBothAxes() {
        var filter = TouchpadMotionFilter()
        filter.begin(x: 500, y: 500, timestamp: 1)

        let movement = filter.moveTracked(x: 596, y: 554, timestamp: 1.01)

        XCTAssertEqual(movement, TouchpadMotionDelta(x: 96, y: 54))
    }

    func testZeroCoordinateIsValidMotionRatherThanAReleaseSignal() {
        var filter = TouchpadMotionFilter()
        filter.begin(x: 12, y: 8, timestamp: 1)

        let movement = filter.moveTracked(x: 0, y: 0, timestamp: 1.01)

        XCTAssertEqual(movement, TouchpadMotionDelta(x: -12, y: -8))
    }

    func testTinyJitterIsIgnoredWithoutPoisoningNextSample() {
        var filter = TouchpadMotionFilter()
        filter.begin(x: 100, y: 100, timestamp: 1)

        XCTAssertNil(filter.moveTracked(x: 100.2, y: 100.2, timestamp: 1.01))
        let movement = filter.moveTracked(x: 110, y: 100, timestamp: 1.02)

        XCTAssertEqual(movement?.x ?? 0, 9.8, accuracy: 0.001)
        XCTAssertEqual(movement?.y ?? 0, -0.2, accuracy: 0.001)
    }

    func testFastMotionIsBoundedButNeverDropped() {
        var filter = TouchpadMotionFilter()
        filter.begin(x: 1_800, y: 500, timestamp: 1)

        let movement = filter.moveTracked(x: 200, y: 500, timestamp: 1.01)

        XCTAssertNotNil(movement)
        XCTAssertEqual(movement?.x ?? 0, -240, accuracy: 0.001)
        XCTAssertEqual(movement?.y ?? 0, 0, accuracy: 0.001)
    }

    func testPointerCurveIsDirectionallySymmetricIncludingLeftwardMotion() {
        let right = TouchpadPointerCurve.cursorDelta(
            for: TouchpadMotionDelta(x: 20, y: 0),
            speed: 1.25
        )
        let left = TouchpadPointerCurve.cursorDelta(
            for: TouchpadMotionDelta(x: -20, y: 0),
            speed: 1.25
        )
        let down = TouchpadPointerCurve.cursorDelta(
            for: TouchpadMotionDelta(x: 0, y: 20),
            speed: 1.25
        )

        XCTAssertEqual(left.x, -right.x, accuracy: 0.001)
        XCTAssertEqual(abs(left.x), down.y, accuracy: 0.001)
        XCTAssertEqual(left.y, 0)
        XCTAssertEqual(right.y, 0)
    }

    func testUntrackedFallbackDelaysOneReportAndDiscardsReleaseTail() {
        var filter = TouchpadMotionFilter()

        XCTAssertNil(filter.moveUntracked(x: 100, y: 100, timestamp: 1))
        XCTAssertNil(filter.moveUntracked(x: 110, y: 100, timestamp: 1.01))
        XCTAssertEqual(
            filter.moveUntracked(x: 120, y: 100, timestamp: 1.02),
            TouchpadMotionDelta(x: 10, y: 0)
        )

        // This simulates the invalid coordinate Apple may report on lift. It
        // stays pending and is discarded when the inferred contact ends.
        XCTAssertEqual(
            filter.moveUntracked(x: 0, y: 0, timestamp: 1.03),
            TouchpadMotionDelta(x: 10, y: 0)
        )
        filter.end()
        XCTAssertNil(filter.moveUntracked(x: 1_700, y: 800, timestamp: 1.04))
    }

    func testUntrackedFallbackRebasesAfterAnIdleGap() {
        var filter = TouchpadMotionFilter()
        XCTAssertNil(filter.moveUntracked(x: 100, y: 100, timestamp: 1))
        XCTAssertNil(filter.moveUntracked(x: 110, y: 100, timestamp: 1.01))

        XCTAssertNil(filter.moveUntracked(x: 1_700, y: 800, timestamp: 1.2))
        XCTAssertNil(filter.moveUntracked(x: 1_710, y: 800, timestamp: 1.21))
        XCTAssertEqual(
            filter.moveUntracked(x: 1_720, y: 800, timestamp: 1.22),
            TouchpadMotionDelta(x: 10, y: 0)
        )
    }
}
