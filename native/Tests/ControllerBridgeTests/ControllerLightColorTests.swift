import XCTest
@testable import ControllerBridge

final class ControllerLightColorTests: XCTestCase {
    func testParsesHashPrefixedHex() throws {
        let color = try XCTUnwrap(ControllerLightColor.rgb("#3366ff"))

        XCTAssertEqual(color.red, 0x33 / 255, accuracy: 0.000_1)
        XCTAssertEqual(color.green, 0x66 / 255, accuracy: 0.000_1)
        XCTAssertEqual(color.blue, 1, accuracy: 0.000_1)
    }

    func testParsesBareHex() throws {
        let color = try XCTUnwrap(ControllerLightColor.rgb("ff0000"))

        XCTAssertEqual(color.red, 1, accuracy: 0.000_1)
        XCTAssertEqual(color.green, 0, accuracy: 0.000_1)
        XCTAssertEqual(color.blue, 0, accuracy: 0.000_1)
    }

    func testParsesUppercaseHex() throws {
        let color = try XCTUnwrap(ControllerLightColor.rgb("#00FF80"))

        XCTAssertEqual(color.green, 1, accuracy: 0.000_1)
        XCTAssertEqual(color.blue, 0x80 / 255, accuracy: 0.000_1)
    }

    func testBlackAndWhiteSitAtTheEndsOfTheRange() throws {
        let black = try XCTUnwrap(ControllerLightColor.rgb("#000000"))
        let white = try XCTUnwrap(ControllerLightColor.rgb("#ffffff"))

        XCTAssertEqual(black.red + black.green + black.blue, 0)
        XCTAssertEqual(white.red, 1)
        XCTAssertEqual(white.green, 1)
        XCTAssertEqual(white.blue, 1)
    }

    func testRejectsShorthandHex() {
        XCTAssertNil(ControllerLightColor.rgb("#f0f"))
    }

    func testRejectsOverlongHex() {
        XCTAssertNil(ControllerLightColor.rgb("#ff00ff00"))
    }

    func testRejectsNonHexCharacters() {
        XCTAssertNil(ControllerLightColor.rgb("#gg0000"))
    }

    /// `Int(_:radix:)` accepts a sign, so a signed string of the right length
    /// used to light the controller a colour nobody asked for.
    func testRejectsSignedValue() {
        XCTAssertNil(ControllerLightColor.rgb("+ff000"))
        XCTAssertNil(ControllerLightColor.rgb("#-f0000"))
    }

    func testRejectsEmptyAndBareHash() {
        XCTAssertNil(ControllerLightColor.rgb(""))
        XCTAssertNil(ControllerLightColor.rgb("#"))
    }

    func testRejectsTrailingHash() {
        XCTAssertNil(ControllerLightColor.rgb("#ff0000#"))
    }
}
