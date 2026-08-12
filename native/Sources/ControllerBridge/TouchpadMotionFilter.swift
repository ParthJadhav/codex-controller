import Foundation

struct TouchpadMotionDelta: Equatable {
    let x: Float
    let y: Float
}

enum TouchpadPointerCurve {
    static func cursorDelta(
        for surfaceDelta: TouchpadMotionDelta,
        speed: Float
    ) -> TouchpadMotionDelta {
        let magnitude = hypotf(surfaceDelta.x, surfaceDelta.y)
        let acceleration = 1 + min(magnitude / 48, 1) * 0.62
        let gain = 0.42 * min(max(speed, 0.5), 2.5) * acceleration
        return TouchpadMotionDelta(
            x: surfaceDelta.x * gain,
            y: surfaceDelta.y * gain
        )
    }
}

struct TouchpadMotionFilter {
    // Samples are expressed in the DualSense's physical 1920 × 1080 touch
    // coordinate space. Keep the full vector: dropping a large sample makes a
    // quick swipe feel slower than a careful one.
    private static let jitterRadius: Float = 0.65
    private static let maximumSampleRadius: Float = 240
    private static let fallbackContactTimeout: TimeInterval = 0.12
    private static let trackedContactTimeout: TimeInterval = 0.35

    private var lastPosition: (x: Float, y: Float)?
    private var lastTimestamp: TimeInterval?
    private var pendingFallbackDelta: TouchpadMotionDelta?

    mutating func begin(x: Float, y: Float, timestamp: TimeInterval) {
        lastPosition = (x, y)
        lastTimestamp = timestamp
        pendingFallbackDelta = nil
    }

    /// Maps a coordinate stream with a real touch-down/up lifecycle, such as
    /// the DualSense HID contact bit or GCControllerTouchpad callbacks.
    mutating func moveTracked(
        x: Float,
        y: Float,
        timestamp: TimeInterval
    ) -> TouchpadMotionDelta? {
        guard canContinue(at: timestamp, timeout: Self.trackedContactTimeout) else {
            begin(x: x, y: y, timestamp: timestamp)
            return nil
        }
        return consume(x: x, y: y, timestamp: timestamp)
    }

    /// GameController exposes DualSense finger position as a direction pad on
    /// some macOS versions, with no contact-valid flag. Delay each delta by one
    /// sample so the final invalid coordinate generated on lift is never sent.
    /// The delay is one controller report (normally 4–8 ms), not a time filter.
    mutating func moveUntracked(
        x: Float,
        y: Float,
        timestamp: TimeInterval
    ) -> TouchpadMotionDelta? {
        guard canContinue(at: timestamp, timeout: Self.fallbackContactTimeout) else {
            begin(x: x, y: y, timestamp: timestamp)
            return nil
        }

        let next = consume(x: x, y: y, timestamp: timestamp)
        let ready = pendingFallbackDelta
        pendingFallbackDelta = next
        return ready
    }

    mutating func end() {
        lastPosition = nil
        lastTimestamp = nil
        pendingFallbackDelta = nil
    }

    private func canContinue(at timestamp: TimeInterval, timeout: TimeInterval) -> Bool {
        guard lastPosition != nil, let previousTimestamp = lastTimestamp else { return false }
        return timestamp >= previousTimestamp && timestamp - previousTimestamp <= timeout
    }

    private mutating func consume(
        x: Float,
        y: Float,
        timestamp: TimeInterval
    ) -> TouchpadMotionDelta? {
        guard let previous = lastPosition else {
            begin(x: x, y: y, timestamp: timestamp)
            return nil
        }
        lastPosition = (x, y)
        lastTimestamp = timestamp

        let raw = TouchpadMotionDelta(x: x - previous.x, y: y - previous.y)
        let magnitude = hypotf(raw.x, raw.y)
        guard magnitude >= Self.jitterRadius else { return nil }
        guard magnitude > Self.maximumSampleRadius else { return raw }

        // Preserve the direction of a fast or coalesced report while bounding
        // a single packet's effect. Never turn valid fast movement into zero.
        let scale = Self.maximumSampleRadius / magnitude
        return TouchpadMotionDelta(x: raw.x * scale, y: raw.y * scale)
    }
}
