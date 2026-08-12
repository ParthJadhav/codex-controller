import CoreGraphics
import XCTest
@testable import ControllerBridge

final class TouchpadPointerGeometryTests: XCTestCase {
    func testCentreMapsToTheMiddleOfTheSurface() {
        let point = TouchpadPointerGeometry.surfacePoint(x: 0, y: 0)

        XCTAssertEqual(point.x, DualSenseTouchReport.surfaceWidth / 2, accuracy: 0.001)
        XCTAssertEqual(point.y, DualSenseTouchReport.surfaceHeight / 2, accuracy: 0.001)
    }

    /// GameController's y points up and the decoded surface's points down, so
    /// the top of the pad has to come out as the smaller number.
    func testVerticalAxisIsFlippedToMatchDecodedReports() {
        XCTAssertEqual(TouchpadPointerGeometry.surfacePoint(x: 0, y: 1).y, 0, accuracy: 0.001)
        XCTAssertEqual(
            TouchpadPointerGeometry.surfacePoint(x: 0, y: -1).y,
            DualSenseTouchReport.surfaceHeight,
            accuracy: 0.001
        )
    }

    func testHorizontalExtremesSpanTheSurface() {
        XCTAssertEqual(TouchpadPointerGeometry.surfacePoint(x: -1, y: 0).x, 0, accuracy: 0.001)
        XCTAssertEqual(
            TouchpadPointerGeometry.surfacePoint(x: 1, y: 0).x,
            DualSenseTouchReport.surfaceWidth,
            accuracy: 0.001
        )
    }

    func testOutOfRangeInputIsClampedToTheSurface() {
        let point = TouchpadPointerGeometry.surfacePoint(x: 4, y: -9)

        XCTAssertEqual(point.x, DualSenseTouchReport.surfaceWidth, accuracy: 0.001)
        XCTAssertEqual(point.y, DualSenseTouchReport.surfaceHeight, accuracy: 0.001)
    }

    /// A NaN reaching the motion filter poisons its running position for the
    /// rest of the contact, so it is turned into the centre here.
    func testNonFiniteInputReadsAsTheCentre() {
        let nan = TouchpadPointerGeometry.surfacePoint(x: .nan, y: .nan)
        let infinite = TouchpadPointerGeometry.surfacePoint(x: .infinity, y: -.infinity)

        XCTAssertEqual(nan.x, DualSenseTouchReport.surfaceWidth / 2, accuracy: 0.001)
        XCTAssertEqual(nan.y, DualSenseTouchReport.surfaceHeight / 2, accuracy: 0.001)
        // Infinity is treated as unreadable rather than as the far edge: a pad
        // cannot report a contact past its own surface, so the value is noise.
        XCTAssertEqual(infinite.x, DualSenseTouchReport.surfaceWidth / 2, accuracy: 0.001)
        XCTAssertEqual(infinite.y, DualSenseTouchReport.surfaceHeight / 2, accuracy: 0.001)
    }

    func testPointInsideASingleDisplayIsUntouched() {
        let bounds = [CGRect(x: 0, y: 0, width: 1_920, height: 1_080)]

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(CGPoint(x: 400, y: 300), toDisplayBounds: bounds),
            CGPoint(x: 400, y: 300)
        )
    }

    func testPointBeyondTheFarEdgeStaysOnTheDisplay() {
        let bounds = [CGRect(x: 0, y: 0, width: 1_920, height: 1_080)]

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(CGPoint(x: 5_000, y: 5_000), toDisplayBounds: bounds),
            CGPoint(x: 1_919, y: 1_079)
        )
    }

    func testPointBeforeTheNearEdgeIsPulledBack() {
        let bounds = [CGRect(x: 0, y: 0, width: 1_920, height: 1_080)]

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(CGPoint(x: -80, y: -80), toDisplayBounds: bounds),
            CGPoint(x: 0, y: 0)
        )
    }

    /// A second display to the left puts negative coordinates on a real screen,
    /// and the cursor has to be allowed to reach them.
    func testNegativeCoordinatesOnARealDisplayAreAllowed() {
        let bounds = [
            CGRect(x: 0, y: 0, width: 1_920, height: 1_080),
            CGRect(x: -1_440, y: -200, width: 1_440, height: 900)
        ]

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(CGPoint(x: -900, y: -100), toDisplayBounds: bounds),
            CGPoint(x: -900, y: -100)
        )
        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(CGPoint(x: -9_000, y: -9_000), toDisplayBounds: bounds),
            CGPoint(x: -1_440, y: -200)
        )
    }

    func testPointInsideAStaggeredDisplayGapProjectsToTheClosestDisplay() {
        let bounds = [
            CGRect(x: 0, y: 0, width: 1_920, height: 1_080),
            CGRect(x: 1_920, y: 500, width: 1_920, height: 1_080)
        ]

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(
                CGPoint(x: 2_500, y: 100),
                toDisplayBounds: bounds
            ),
            CGPoint(x: 2_500, y: 500)
        )
    }

    func testVerticalStaggerGapProjectsToARealDisplay() {
        let bounds = [
            CGRect(x: 0, y: 0, width: 1_000, height: 800),
            CGRect(x: 400, y: 800, width: 600, height: 800)
        ]

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(
                CGPoint(x: 100, y: 1_100),
                toDisplayBounds: bounds
            ),
            CGPoint(x: 400, y: 1_100)
        )
    }

    func testPointInOverlappingOrMirroredDisplaysIsUntouched() {
        let point = CGPoint(x: 600, y: 400)
        let bounds = [
            CGRect(x: 0, y: 0, width: 1_920, height: 1_080),
            CGRect(x: 0, y: 0, width: 1_280, height: 720)
        ]

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(point, toDisplayBounds: bounds),
            point
        )
    }

    func testEquidistantGapUsesGeometricTieBreakIndependentOfInputOrder() {
        let left = CGRect(x: 0, y: 0, width: 100, height: 100)
        let right = CGRect(x: 200, y: 0, width: 100, height: 100)
        let point = CGPoint(x: 149.5, y: 50)

        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(point, toDisplayBounds: [right, left]),
            CGPoint(x: 99, y: 50)
        )
        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(point, toDisplayBounds: [left, right]),
            CGPoint(x: 99, y: 50)
        )
    }

    func testUnreadableDisplayListLetsThePointThrough() {
        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(CGPoint(x: 4_000, y: -20), toDisplayBounds: []),
            CGPoint(x: 4_000, y: -20)
        )
    }

    func testEmptyDisplayBoundsLetThePointThrough() {
        XCTAssertEqual(
            TouchpadPointerGeometry.clamped(
                CGPoint(x: 400, y: 300),
                toDisplayBounds: [CGRect(x: 0, y: 0, width: 0, height: 0)]
            ),
            CGPoint(x: 400, y: 300)
        )
    }
}
