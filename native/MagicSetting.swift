import Foundation

/// How much magic Pip shows. Calm: Pip moves, nothing else is drawn. Balanced: effects around Pip, none inside the window. Rich: everything, with the desktop dimmed on arrival.
public enum MagicLevel: String, Codable, CaseIterable, Sendable { case calm, balanced, rich }

/// The Magic row in Pip's settings. A new install, a missing or unreadable file and an unknown level all give Balanced.
public struct MagicSetting: Codable, Equatable, Sendable {
    public static let fileName = "magic.json"
    public let level: MagicLevel
    public init(level: MagicLevel = .balanced) { self.level = level }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        self.init(level: MagicLevel(rawValue: try fields.decode(String.self, forKey: .level)) ?? .balanced)
    }
    private enum CodingKeys: String, CodingKey { case level }
    public static func load(from home: URL) -> MagicSetting {
        guard let data = try? Data(contentsOf: home.appendingPathComponent(fileName)), let saved = try? JSONDecoder().decode(MagicSetting.self, from: data) else { return MagicSetting() }
        return saved
    }
    public func save(to home: URL) throws { try JSONEncoder().encode(self).write(to: home.appendingPathComponent(MagicSetting.fileName), options: .atomic) }
}

/// Where the mouse pointer is, in the page's own coordinates, so Pip can look at it from anywhere on the screen. Read only while Pip is shown; nothing is stored or sent anywhere.
public enum PointerFeed {
    /// The pointer on this screen: points from the panel's top left. Off this screen: nil, and Pip looks at what is happening in the window.
    public static func position(mouse: CGPoint, panel: CGRect, screen: CGRect) -> CGPoint? {
        guard screen.contains(mouse) else { return nil }
        return CGPoint(x: mouse.x - panel.minX, y: panel.maxY - mouse.y)
    }
}
