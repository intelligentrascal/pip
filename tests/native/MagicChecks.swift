import Foundation
import PipCore

// Intent (ELF-65's accepted screen spec, built by ELF-62): the Magic setting is Calm, Balanced or Rich, a new install or anyone who never chose gets
// Balanced, and the choice survives a restart; Pip reads the pointer only to look at it, on the screen he is on, in the page's own coordinates.
// Fixtures: a real folder on disk, the saved file as an older or damaged install would leave it, and the frames of a two-display Mac.
enum MagicChecks {
    static func require(_ condition: Bool, _ what: String) { precondition(condition, "Magic setting failed: " + what) }
    static func run() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("pip-magic-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        require(MagicLevel.allCases.map(\.rawValue) == ["calm", "balanced", "rich"], "three levels, in the order the row shows them")
        require(MagicSetting.load(from: home).level == .balanced, "a new install gets Balanced")
        for level in MagicLevel.allCases {
            try MagicSetting(level: level).save(to: home)
            require(MagicSetting.load(from: home).level == level, "\(level) survives a restart")
        }
        let file = home.appendingPathComponent(MagicSetting.fileName)
        try Data("{\"level\":\"cinematic\"}".utf8).write(to: file)
        require(MagicSetting.load(from: home).level == .balanced, "a level this version does not know gives Balanced")
        try Data("not json".utf8).write(to: file)
        require(MagicSetting.load(from: home).level == .balanced, "a damaged file gives Balanced")

        // The page's coordinates start at the panel's top left; the Mac's start at the screen's lower left.
        let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let panel = CGRect(x: 756, y: 16, width: 756, height: 171)
        require(PointerFeed.position(mouse: CGPoint(x: 756, y: 187), panel: panel, screen: screen) == CGPoint(x: 0, y: 0), "the panel's top left is the page's origin")
        require(PointerFeed.position(mouse: CGPoint(x: 1512 - 1, y: 16), panel: panel, screen: screen) == CGPoint(x: 755, y: 171), "the panel's lower right is its size")
        require(PointerFeed.position(mouse: CGPoint(x: 0, y: 981), panel: panel, screen: screen) == CGPoint(x: -756, y: -794), "far corners give positions outside the page, so Pip looks toward them")
        let left = CGRect(x: -1920, y: 100, width: 1920, height: 1055)
        require(PointerFeed.position(mouse: CGPoint(x: -500, y: 500), panel: panel, screen: screen) == nil, "a pointer on another display is not read")
        require(PointerFeed.position(mouse: CGPoint(x: -500, y: 500), panel: CGRect(x: -756, y: 116, width: 756, height: 171), screen: left) == CGPoint(x: 256, y: -213), "a display left of the main one keeps its own origin")
        print("Magic setting checks passed")
    }
}
