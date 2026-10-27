// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Liuli",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .executable(name: "Liuli", targets: ["Liuli"])
    ],
    dependencies: [
        .package(url: "https://github.com/mgriebling/SwiftMath.git", from: "1.7.3"),
    ],
    targets: [
        .target(name: "ClipboardCore", path: "ClipboardCore"),
        .target(name: "ClipboardMac", dependencies: ["ClipboardCore"], path: "ClipboardMac"),
        .executableTarget(
            name: "Liuli",
            dependencies: [
                "SwiftMath",
                "ClipboardCore",
                "ClipboardMac",
            ],
            path: "Sources"
        ),
        .testTarget(name: "ClipboardCoreTests", dependencies: ["ClipboardCore", "ClipboardMac"], path: "Tests")
    ]
)
