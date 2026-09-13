import AppKit

/// Panel / toast chrome: Liquid Glass on macOS 26+, frosted `NSVisualEffectView` below.
@MainActor
enum GlassChrome {
    static func wrap(_ content: NSView, cornerRadius: CGFloat = 16) -> NSView {
        if shouldUseLiquidGlass {
            if #available(macOS 26.0, *) {
                return wrapLiquidGlass(content, cornerRadius: cornerRadius)
            }
        }
        if NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency {
            return OpaquePlateView(content: content, cornerRadius: cornerRadius)
        }
        return FrostedPlateView(content: content, cornerRadius: cornerRadius)
    }

    static var shouldUseLiquidGlass: Bool {
        if ProcessInfo.processInfo.environment["LIULI_FORCE_FROSTED"] == "1" {
            return false
        }
        if #available(macOS 26.0, *), NSClassFromString("NSGlassEffectView") != nil {
            return true
        }
        return false
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

    static func roundedMask(cornerRadius: CGFloat) -> NSImage {
        let side = max(cornerRadius * 2, 2)
        let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: cornerRadius, yRadius: cornerRadius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(
            top: cornerRadius,
            left: cornerRadius,
            bottom: cornerRadius,
            right: cornerRadius
        )
        image.resizingMode = .stretch
        return image
    }
}

/// Frosted plate that samples the desktop. `maskImage` keeps the window shadow rounded.
@MainActor
final class FrostedPlateView: NSVisualEffectView {
    private let tint = NSView()
    private let cornerRadius: CGFloat

    init(content: NSView, cornerRadius: CGFloat) {
        self.cornerRadius = cornerRadius
        super.init(frame: .zero)
        material = .hudWindow
        blendingMode = .behindWindow
        state = .active
        wantsLayer = true
        maskImage = GlassChrome.roundedMask(cornerRadius: cornerRadius)
        if #available(macOS 10.15, *) {
            layer?.cornerCurve = .continuous
        }
        layer?.masksToBounds = true
        layer?.cornerRadius = cornerRadius

        tint.wantsLayer = true
        tint.translatesAutoresizingMaskIntoConstraints = false
        content.focusRingType = .none
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(tint)
        addSubview(content)
        NSLayoutConstraint.activate([
            tint.leadingAnchor.constraint(equalTo: leadingAnchor),
            tint.trailingAnchor.constraint(equalTo: trailingAnchor),
            tint.topAnchor.constraint(equalTo: topAnchor),
            tint.bottomAnchor.constraint(equalTo: bottomAnchor),
            content.leadingAnchor.constraint(equalTo: leadingAnchor),
            content.trailingAnchor.constraint(equalTo: trailingAnchor),
            content.topAnchor.constraint(equalTo: topAnchor),
            content.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        applyChrome()
        _ = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.applyChrome()
            }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        applyChrome()
    }

    private func applyChrome() {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        if reduce {
            material = .contentBackground
            tint.layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.92).cgColor
        } else {
            material = .hudWindow
            blendingMode = .behindWindow
            state = .active
            tint.layer?.backgroundColor = NSColor.black.withAlphaComponent(dark ? 0.16 : 0.03).cgColor
        }
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(dark ? 0.20 : 0.45).cgColor
    }
}

/// Solid rounded plate when the user turns on Reduce Transparency.
@MainActor
final class OpaquePlateView: NSView {
    init(content: NSView, cornerRadius: CGFloat) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = cornerRadius
        layer?.masksToBounds = true
        if #available(macOS 10.15, *) {
            layer?.cornerCurve = .continuous
        }
        content.focusRingType = .none
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: leadingAnchor),
            content.trailingAnchor.constraint(equalTo: trailingAnchor),
            content.topAnchor.constraint(equalTo: topAnchor),
            content.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        applyFill()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        applyFill()
    }

    private func applyFill() {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        layer?.backgroundColor = (dark
            ? NSColor(white: 0.14, alpha: 1)
            : NSColor(white: 0.96, alpha: 1)).cgColor
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(dark ? 0.16 : 0.55).cgColor
    }
}
