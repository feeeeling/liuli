import AppKit

/// Panel / toast chrome: Liquid Glass on macOS 26+, frosted `NSVisualEffectView` below.
@MainActor
enum GlassChrome {
    static func wrap(_ content: NSView, cornerRadius: CGFloat = 16) -> NSView {
        if #available(macOS 26.0, *), NSClassFromString("NSGlassEffectView") != nil {
            return wrapLiquidGlass(content, cornerRadius: cornerRadius)
        }
        return wrapFrosted(content, cornerRadius: cornerRadius)
    }

    @available(macOS 26.0, *)
    private static func wrapLiquidGlass(_ content: NSView, cornerRadius: CGFloat) -> NSView {
        let glass = NSGlassEffectView()
        glass.cornerRadius = cornerRadius
        glass.style = .regular
        glass.tintColor = NSColor(name: nil) { appearance in
            let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor.black.withAlphaComponent(dark ? 0.32 : 0.10)
        }
        glass.contentView = content
        glass.focusRingType = .none
        glass.wantsLayer = true
        glass.layer?.borderWidth = 0
        glass.layer?.borderColor = CGColor.clear
        content.focusRingType = .none
        content.translatesAutoresizingMaskIntoConstraints = false
        if let container = glass.contentView ?? content.superview {
            NSLayoutConstraint.activate([
                content.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                content.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                content.topAnchor.constraint(equalTo: container.topAnchor),
                content.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            ])
        }
        return glass
    }

    private static func wrapFrosted(_ content: NSView, cornerRadius: CGFloat) -> NSView {
        let effect = NSVisualEffectView()
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = cornerRadius
        effect.layer?.masksToBounds = true
        if #available(macOS 10.15, *) {
            effect.layer?.cornerCurve = .continuous
        }
        // Soft rim so the frosted plate reads as glass, not a flat card.
        effect.layer?.borderWidth = 1
        let dark = effect.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        effect.layer?.borderColor = NSColor.white.withAlphaComponent(dark ? 0.20 : 0.45).cgColor

        let tint = NSView()
        tint.wantsLayer = true
        tint.layer?.backgroundColor = NSColor.black.withAlphaComponent(dark ? 0.16 : 0.03).cgColor
        tint.translatesAutoresizingMaskIntoConstraints = false

        content.focusRingType = .none
        content.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(tint)
        effect.addSubview(content)
        NSLayoutConstraint.activate([
            tint.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            tint.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            tint.topAnchor.constraint(equalTo: effect.topAnchor),
            tint.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            content.topAnchor.constraint(equalTo: effect.topAnchor),
            content.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
        ])
        return effect
    }
}
