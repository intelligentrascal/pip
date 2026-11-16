import Foundation

public enum ProviderSignInURL {
    public static func parse(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme == "https", url.user == nil,
              url.password == nil, url.port == nil else { return nil }
        guard url.host == "openrouter.ai" || (url.host == "auth.openai.com" && url.path == "/api/accounts/authorize") else { return nil }
        return url
    }
}

public struct BridgeMessage {
    public let id: String
    public let kind: String
    public let payload: [String: Any]
    public static func parse(_ raw: Any, isMainFrame: Bool, source: URL?, bundledPage: URL) -> BridgeMessage? {
        guard isMainFrame, source?.standardizedFileURL == bundledPage.standardizedFileURL,
              let body = raw as? [String: Any], Set(body.keys) == ["version", "id", "kind", "payload"],
              let version = body["version"] as? Int, version == 1,
              let id = body["id"] as? String, !id.isEmpty, id.count <= 100,
              let kind = body["kind"] as? String,
              ["hide", "resize", "snapshot", "submit", "stop", "propose", "approve", "cancel", "saveComposer", "saveDraft", "backendQuery", "reconcile", "tracker", "feedback.save", "feedback.correct", "work.backlog", "configureShortcut", "configureMagic", "configureWindow", "steer", "dim", "browser", "dictation.start", "dictation.stop", "dictation.cancel", "provider.allow", "provider.withdraw", "provider.select", "provider.backup", "provider.signIn", "provider.cancelSignIn", "provider.remove", "provider.enterKey", "permissions.setup", "permissions.status"].contains(kind),
              let payload = body["payload"] as? [String: Any] else { return nil }
        return BridgeMessage(id: id, kind: kind, payload: payload)
    }
}

/// Where Pip's panel sits. The panel holds the chat window, Pip's figure at its right and 8 pt of room under the window for his feet.
/// The window's bottom edge stays 24 pt above the visible screen bottom and its right side stays put, so it only ever grows upward.
public struct PanelGeometry {
    public static let figure = 150.0, gap = 6.0, feet = 8.0, lift = 24.0
    public static let minimumWidth = 420.0, defaultWidth = 600.0, maximumWidth = 760.0
    public static let smallestHeight = 163.0, heightShare = 0.7, smallestMost = 320.0, topRoom = 12.0
    /// The tallest the chat window may be: the height the person chose by dragging its top edge, or 70% of the visible screen height.
    /// A chosen height is kept between 320 pt and what fits under the top of the screen.
    public static func tallest(visibleHeight: Double, most: Double? = nil) -> Double {
        guard let most, most.isFinite else { return (visibleHeight * heightShare).rounded(.down) }
        return min(max(most, smallestMost), max(smallestMost, visibleHeight - lift - topRoom)).rounded(.down)
    }
    /// The window's width in points. A missing, zero or unreadable request keeps the current width, so a first measurement taken before the
    /// web view has a size can never narrow the window; a real request is held between 420 and 760 pt.
    public static func width(requested: Double?, current: Double, visibleWidth: Double) -> Double {
        let widest = min(maximumWidth, visibleWidth - figure - gap)
        let wanted = requested.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? (current.isFinite && current > 0 ? current : defaultWidth)
        return min(max(wanted, minimumWidth), max(minimumWidth, widest))
    }
    /// The panel's frame for a window of this size on a screen with this visible area (all in points, origin at the lower left).
    public static func panel(visible: CGRect, windowWidth: Double, windowHeight: Double, most: Double? = nil) -> CGRect {
        let width = Self.width(requested: windowWidth, current: defaultWidth, visibleWidth: Double(visible.width))
        let height = min(max(windowHeight, smallestHeight), tallest(visibleHeight: Double(visible.height), most: most))
        let panelWidth = width + gap + figure
        return CGRect(x: visible.maxX - panelWidth, y: visible.minY + lift - feet, width: panelWidth, height: height + feet)
    }
    /// The see-through backdrop covers exactly the chat window inside the panel.
    public static func backdrop(windowWidth: Double, windowHeight: Double) -> CGRect {
        CGRect(x: 0, y: feet, width: windowWidth, height: windowHeight)
    }
    /// Solid when the Mac asks for less transparency or more contrast.
    public static func solid(reduceTransparency: Bool, increaseContrast: Bool) -> Bool { reduceTransparency || increaseContrast }
}
