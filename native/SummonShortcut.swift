import Foundation

/// ELF-8: keep Command+E available to other apps. Only the letter of the
/// Command+Shift chord is configurable; never silently substitute another chord.
public struct SummonShortcut: Codable, Equatable, Sendable {
    public let letter: String
    public init(letter: String = "e") throws {
        let value = letter.lowercased()
        guard value.utf8.count == 1, let byte = value.utf8.first, byte >= 97, byte <= 122 else {
            throw ShortcutError.invalidLetter
        }
        self.letter = value
    }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(letter: fields.decode(String.self, forKey: .letter))
    }
    private enum CodingKeys: String, CodingKey { case letter }
    public var label: String { "⌘⇧" + letter.uppercased() }
    public enum ShortcutError: Error { case invalidLetter }
}
