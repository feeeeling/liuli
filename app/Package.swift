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
        .executableTarget(
            name: "Liuli",
            dependencies: [
                "SwiftMath",
            ],
            path: "Sources"
        )
    ]
)
