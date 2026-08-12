import Foundation

/// Parses the light colour the renderer asks for into GameController's
/// components.
enum ControllerLightColor {
    /// Accepts `#rrggbb` and `rrggbb`, and nothing else.
    ///
    /// The digits are checked before `Int(_:radix:)` sees them because that
    /// initialiser also accepts a sign — `+ff000` would otherwise light the
    /// controller a colour nobody asked for instead of being refused.
    static func rgb(_ value: String) -> (red: Float, green: Float, blue: Float)? {
        var digits = Substring(value)
        if digits.first == "#" { digits = digits.dropFirst() }
        guard digits.count == 6,
              digits.allSatisfy(\.isHexDigit),
              let integer = Int(digits, radix: 16) else { return nil }
        return (
            Float((integer >> 16) & 0xff) / 255,
            Float((integer >> 8) & 0xff) / 255,
            Float(integer & 0xff) / 255
        )
    }
}
