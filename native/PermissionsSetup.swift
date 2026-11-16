import Foundation
import ApplicationServices
import AVFoundation
import UserNotifications

/// One macOS permission Pip needs for its Mac abilities, with plain words about what it is for.
public struct MacPermission: Equatable, Sendable {
    public let id: String
    public let label: String
    public let why: String
    public init(id: String, label: String, why: String) {
        self.id = id; self.label = label; self.why = why
    }
}

/// The six permissions asked once at setup, in the order Pip asks them.
public enum MacPermissions {
    public static let all: [MacPermission] = [
        MacPermission(id: "accessibility", label: "Accessibility",
                      why: "Control other apps for you: window clicks, typing and reading through the automation tools."),
        MacPermission(id: "screen-recording", label: "Screen Recording",
                      why: "See a window you choose to share, and let the screen tools read the screen when you ask."),
        MacPermission(id: "automation", label: "Automation (Apple Events)",
                      why: "Let scripts act inside Calendar, Finder, System Events and other apps when you ask."),
        MacPermission(id: "full-disk-access", label: "Full Disk Access",
                      why: "Read and organise files anywhere you point Pip, beyond your home folder."),
        MacPermission(id: "microphone", label: "Microphone",
                      why: "Dictation: you hold the button, Pip transcribes on this Mac only."),
        MacPermission(id: "notifications", label: "Notifications",
                      why: "Alarms and reminders Pip schedules locally can reach you."),
    ]
}

public enum MacPermissionState: String, Codable, Sendable {
    case granted
    case notGranted
    case unknown
}

/// What Pip recorded about its permissions: when setup asked, and each permission's last known state.
public struct PermissionsRecord: Codable, Equatable, Sendable {
    public var version: Int
    public var askedAt: Date?
    public var state: [String: MacPermissionState]
    public init(version: Int = 1, askedAt: Date? = nil, state: [String: MacPermissionState] = [:]) {
        self.version = version; self.askedAt = askedAt; self.state = state
    }
}

public enum PermissionsSetupError: Error { case notPermissionsState }

/// Pure permission bookkeeping: the ask runner, the live checks that never prompt, and the saved record.
public enum PermissionsSetup {
    public static func fresh() -> PermissionsRecord { PermissionsRecord() }

    /// Runs each ask one at a time, so permission dialogs never stack, and records every answer.
    public struct Ask: Sendable {
        public let id: String
        public let prompt: @Sendable () async -> MacPermissionState
        public init(id: String, prompt: @escaping @Sendable () async -> MacPermissionState) {
            self.id = id; self.prompt = prompt
        }
    }
    public static func run(asks: [Ask]) async -> [String: MacPermissionState] {
        var states: [String: MacPermissionState] = [:]
        for ask in asks { states[ask.id] = await ask.prompt() }
        return states
    }

    /// Checks that never prompt. Automation and notifications are absent until setup asks or the page records them.
    public static func checkWithoutPrompting() -> [String: MacPermissionState] {
        var states: [String: MacPermissionState] = [:]
        states["accessibility"] = AXIsProcessTrusted() ? .granted : .notGranted
        states["screen-recording"] = CGPreflightScreenCaptureAccess() ? .granted : .notGranted
        let microphone = AVCaptureDevice.authorizationStatus(for: .audio)
        states["microphone"] = microphone == .authorized ? .granted : (microphone == .notDetermined ? .unknown : .notGranted)
        // The protected TCC database is readable only with Full Disk Access; existence is never read, only reachability.
        states["full-disk-access"] = FileManager.default.isReadableFile(atPath: NSHomeDirectory() + "/Library/Application Support/com.apple.TCC/TCC.db") ? .granted : .notGranted
        return states
    }

    public static func notificationState(authorized: Bool, notDetermined: Bool) -> MacPermissionState {
        notDetermined ? .unknown : (authorized ? .granted : .notGranted)
    }

    /// Live checks stand over the recorded ones, except where only the ask can answer (automation, notifications).
    public static func report(record: PermissionsRecord?, live: [String: MacPermissionState]) -> PermissionsRecord {
        var merged = record ?? fresh()
        for (id, state) in live { merged.state[id] = state }
        return merged
    }

    /// The rows the setup view shows, always all six, in ask order.
    public static func rows(record: PermissionsRecord) -> [(permission: MacPermission, state: MacPermissionState)] {
        MacPermissions.all.map { permission in
            (permission, record.state[permission.id] ?? .unknown)
        }
    }

    public static var grantedCount: (Int, of: Int) { (0, of: 0) }

    public static func load(from directory: URL) -> PermissionsRecord? {
        let url = directory.appendingPathComponent("permissions.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(PermissionsRecord.self, from: data)
    }

    public static func save(_ record: PermissionsRecord, to directory: URL) throws {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601; encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(record)
        try data.write(to: directory.appendingPathComponent("permissions.json"), options: .atomic)
    }
}
