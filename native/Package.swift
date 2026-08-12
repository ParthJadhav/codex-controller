// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ControllerBridge",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "ControllerBridge", targets: ["ControllerBridge"]),
        .executable(name: "DualSenseAudioProbe", targets: ["DualSenseAudioProbe"])
    ],
    targets: [
        .executableTarget(
            name: "ControllerBridge",
            dependencies: ["COpusShim"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("CoreHaptics"),
                .linkedFramework("GameController"),
                .linkedFramework("IOKit")
            ]
        ),
        .executableTarget(
            name: "DualSenseAudioProbe",
            dependencies: ["COpusShim"],
            exclude: ["README.md"],
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("CoreFoundation"),
                .linkedFramework("IOKit")
            ]
        ),
        .target(
            name: "COpusShim",
            publicHeadersPath: "include"
        ),
        .testTarget(
            name: "ControllerBridgeTests",
            dependencies: ["ControllerBridge"]
        )
    ],
    swiftLanguageVersions: [.v5]
)
