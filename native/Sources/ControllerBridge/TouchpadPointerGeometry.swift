import CoreGraphics
import Foundation

/// Pointer geometry: where a touch lands on the pad, and where the cursor it
/// drives is allowed to end up.
enum TouchpadPointerGeometry {
    /// Maps a GameController-normalised touch (−1…1, y up) onto the pixel
    /// surface the HID reports decode into (0…surface, y down), so both input
    /// paths hand the motion filter identical units.
    ///
    /// A non-finite axis reads as the centre: a NaN reaching the filter would
    /// poison its running position for the rest of the contact.
    static func surfacePoint(x: Float, y: Float) -> (x: Float, y: Float) {
        let clampedX = min(max(x.isFinite ? x : 0, -1), 1)
        let clampedY = min(max(y.isFinite ? y : 0, -1), 1)
        return (
            (clampedX + 1) * DualSenseTouchReport.surfaceWidth / 2,
            (1 - clampedY) * DualSenseTouchReport.surfaceHeight / 2
        )
    }

    /// Keeps the cursor on an actual display, a pixel short of each far edge so
    /// it stays on a display rather than on the boundary.
    ///
    /// An empty list means the display list could not be read; the point passes
    /// through untouched rather than being clamped to nothing. When a staggered
    /// arrangement leaves a hole inside the displays' bounding union, the point
    /// is projected to the closest real display instead of being left in that
    /// unreachable hole.
    static func clamped(_ point: CGPoint, toDisplayBounds bounds: [CGRect]) -> CGPoint {
        let displays = bounds
            .filter { !$0.isNull && !$0.isEmpty }
            .map(safeDisplayBounds)
        guard !displays.isEmpty, point.x.isFinite, point.y.isFinite else { return point }
        if displays.contains(where: { contains(point, in: $0) }) { return point }

        return displays
            .map { bounds -> (point: CGPoint, bounds: CGRect, distance: CGFloat) in
                let candidate = CGPoint(
                    x: min(max(point.x, bounds.minX), bounds.maxX),
                    y: min(max(point.y, bounds.minY), bounds.maxY)
                )
                let deltaX = candidate.x - point.x
                let deltaY = candidate.y - point.y
                return (
                    candidate,
                    bounds,
                    deltaX * deltaX + deltaY * deltaY
                )
            }
            .min { left, right in
                if left.distance != right.distance {
                    return left.distance < right.distance
                }
                // Geometry, rather than the framework's display enumeration
                // order, breaks an exact tie: leftmost, then uppermost.
                if left.bounds.minX != right.bounds.minX {
                    return left.bounds.minX < right.bounds.minX
                }
                if left.bounds.minY != right.bounds.minY {
                    return left.bounds.minY < right.bounds.minY
                }
                if left.bounds.maxX != right.bounds.maxX {
                    return left.bounds.maxX < right.bounds.maxX
                }
                return left.bounds.maxY < right.bounds.maxY
            }?
            .point ?? point
    }

    private static func safeDisplayBounds(_ bounds: CGRect) -> CGRect {
        CGRect(
            x: bounds.minX,
            y: bounds.minY,
            width: max(0, bounds.width - 1),
            height: max(0, bounds.height - 1)
        )
    }

    private static func contains(_ point: CGPoint, in bounds: CGRect) -> Bool {
        point.x >= bounds.minX && point.x <= bounds.maxX
            && point.y >= bounds.minY && point.y <= bounds.maxY
    }
}
