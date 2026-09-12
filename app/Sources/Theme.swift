import SwiftUI

enum LiuliTheme {
    static let panelWidth: CGFloat = 420
    static let panelPadding: CGFloat = 16
    static let sectionSpacing: CGFloat = 12
    static let chipRadius: CGFloat = 8
    static let cardRadius: CGFloat = 10
    static let panelRadius: CGFloat = 16
    static let hoverDuration: Double = 0.12
    static let appearSpring = Animation.spring(duration: 0.28, bounce: 0.12)
    static let snappy = Animation.snappy(duration: 0.24)

    static let titleFont = Font.system(size: 13, weight: .semibold)
    static let bodyFont = Font.system(size: 13)
    static let resultFont = Font.system(size: 15)
    static let captionFont = Font.system(size: 11)
    static let shortcutFont = Font.system(size: 11, weight: .medium).monospaced()
}
