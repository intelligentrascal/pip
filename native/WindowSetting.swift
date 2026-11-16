import Foundation

/// How wide the person pulled Pip's chat window and the most height they allowed it, saved on this Mac so Pip opens the same way next time.
/// A new install, a missing or damaged file and a value outside the allowed range give the default size: 600 pt wide, tallest at 70% of the screen.
public struct WindowSetting: Codable, Equatable, Sendable {
    public static let fileName = "window.json"
    public let width: Double
    /// The most height the window may grow to, in points. nil means the default share of the visible screen.
    public let most: Double?
    public init(width: Double = PanelGeometry.defaultWidth, most: Double? = nil) {
        self.width = PanelGeometry.width(requested: width, current: PanelGeometry.defaultWidth, visibleWidth: .infinity)
        self.most = most.flatMap { $0.isFinite && $0 >= PanelGeometry.smallestMost ? $0 : nil }
    }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.init(width: try fields.decode(Double.self, forKey: .width), most: try fields.decodeIfPresent(Double.self, forKey: .most))
    }
    private enum CodingKeys: String, CodingKey { case width, most }
    public static func load(from home: URL) -> WindowSetting {
        guard let data = try? Data(contentsOf: home.appendingPathComponent(fileName)), let saved = try? JSONDecoder().decode(WindowSetting.self, from: data) else { return WindowSetting() }
        return saved
    }
    public func save(to home: URL) throws { try JSONEncoder().encode(self).write(to: home.appendingPathComponent(WindowSetting.fileName), options: .atomic) }
}
