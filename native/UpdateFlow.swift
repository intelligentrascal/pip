import AppKit

/// "Check for Updates…" in Pip's menu. Checking only reads the signed feed; nothing is downloaded or replaced until the person says
/// "Download and restart". The headless rules live in Updater.swift; this file is the questions Pip asks and the steps it takes.
@MainActor final class UpdateFlow {
    struct Setup { let feed: URL; let publicKey: String; let channel: UpdateChannel; let caskToken: String; let bundleIdentifier: String; let version: String; let allowedSchemes: Set<String> }

    let home: URL
    let bundle: URL
    let stopWork: () -> Void
    private var busy = false
    /// Test-only switches, honoured only for an isolated test home (the same guard as the native probe).
    private let testing: [String: String]

    init(home: URL, bundle: URL = Bundle.main.bundleURL, stopWork: @escaping () -> Void) {
        self.home = home; self.bundle = bundle; self.stopWork = stopWork
        let env = ProcessInfo.processInfo.environment
        let marker = try? String(contentsOf: home.appendingPathComponent(".pip-test-home"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        testing = env["PIP_TEST"] == "1" && marker == "pip-test-only" ? env.filter { $0.key.hasPrefix("PIP_") } : [:]
    }

    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0" }

    var setup: Setup? {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let key = testing["PIP_UPDATE_PUBLIC_KEY"] ?? info["PipUpdatePublicKey"] as? String, let address = (testing["PIP_UPDATE_FEED_URL"] ?? info["PipUpdateFeedURL"] as? String).flatMap(URL.init(string:)),
              let channel = (info["PipUpdateChannel"] as? String).flatMap(UpdateChannel.init(rawValue:)), let identifier = info["CFBundleIdentifier"] as? String else { return nil }
        return Setup(feed: address, publicKey: key, channel: channel, caskToken: "pip-house-elf", bundleIdentifier: identifier, version: Self.version, allowedSchemes: testing.isEmpty ? ["https"] : ["https", "file"])
    }

    /// Runs the whole check once when an isolated test asks for it, so a test needs no menu click.
    func checkWhenTestRequests() { if testing["PIP_UPDATE_CHECK_ON_LAUNCH"] == "1" { check() } }

    func check() {
        guard !busy else { return }
        busy = true
        Task { @MainActor in defer { busy = false }; await run() }
    }

    private func record(_ outcome: String) {
        guard let path = testing["PIP_UPDATE_RESULT"] else { return }
        try? Data((outcome + "\n").utf8).write(to: URL(fileURLWithPath: path))
    }

    private func tell(_ title: String, _ text: String, buttons: [String] = ["OK"]) -> NSApplication.ModalResponse {
        let alert = NSAlert()
        alert.messageText = title; alert.informativeText = text
        buttons.forEach { alert.addButton(withTitle: $0) }
        // An isolated test may ask for a picture of this alert's own window (never the screen): the alert is shown and its window number
        // is written beside the pictures, then Pip waits a moment so the test can capture that one window.
        if let folder = testing["PIP_UPDATE_SNAPSHOT_DIR"] {
            alert.layout()
            alert.window.orderFrontRegardless()
            let name = title.lowercased().filter { $0.isLetter || $0.isNumber || $0 == " " }.replacingOccurrences(of: " ", with: "-")
            try? Data(String(alert.window.windowNumber).utf8).write(to: URL(fileURLWithPath: folder).appendingPathComponent(name + ".window"))
            RunLoop.current.run(until: Date().addingTimeInterval(2.5))
        }
        if testing["PIP_UPDATE_AUTO_CONSENT"] == "1" { return .alertFirstButtonReturn }
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal()
    }

    private func run() async {
        guard let setup else {
            record("not-configured")
            _ = tell("Updates are not set up in this build", "This copy of Pip was built without an update key, so it cannot check for updates. Download the latest release from the project’s releases page instead.")
            return
        }
        let release: UpdateRelease
        do {
            let decision = try await Self.decide(setup)
            guard case .available(let found) = decision else {
                record("up-to-date")
                _ = tell("Pip is up to date", "You have Pip \(setup.version).")
                return
            }
            release = found
        } catch {
            record("check-failed")
            _ = tell("Pip couldn’t check for updates", "The update information could not be read or did not pass its signature check. Nothing was changed. Try again later.")
            return
        }
        let prefixes = testing["PIP_UPDATE_HOMEBREW_PREFIX"].map { [$0] } ?? ["/opt/homebrew", "/usr/local"]
        switch InstallOwner.detect(bundle: bundle, caskToken: setup.caskToken, homebrewPrefixes: prefixes) {
        case .homebrew:
            record("homebrew:" + release.version)
            let command = "brew upgrade --cask \(setup.caskToken)"
            if tell("Pip \(release.version) is available", "Homebrew installed this copy of Pip, so Homebrew updates it.\n\nRun this in Terminal:\n\(command)", buttons: ["Copy command", "Close"]) == .alertFirstButtonReturn, testing.isEmpty {
                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(command, forType: .string)
            }
        case .notInstalled:
            record("not-installed:" + release.version)
            _ = tell("Pip \(release.version) is available", "Move Pip to your Applications folder first, then check again. Pip can’t replace a copy that is running from a disk image.")
        case .notWritable:
            record("not-writable:" + release.version)
            _ = tell("Pip \(release.version) is available", "Pip can’t replace itself in this folder. Download the release and replace the app yourself.")
        case .direct:
            record("available:" + release.version)
            let notes = release.notes.isEmpty ? "" : "\n\n" + release.notes
            guard tell("Pip \(release.version) is available", "You have \(setup.version).\(notes)\n\nPip will download the update, quit, replace itself and reopen. Anything running is paused. Your saved work stays where it is.", buttons: ["Download and restart", "Not now"]) == .alertFirstButtonReturn else { return }
            await install(release, setup)
        }
    }

    private static func fetch(_ address: URL) async throws -> Data {
        var request = URLRequest(url: address, timeoutInterval: 20)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 { throw UpdateError.badFeed }
        return data
    }

    private static func decide(_ setup: Setup) async throws -> UpdateDecision {
        let feed = try await fetch(setup.feed)
        let signature = try await fetch(setup.feed.appendingPathExtension("sig"))
        let verified = try SignedFeed.verify(feed: feed, signature: signature, publicKey: setup.publicKey)
        return try UpdatePolicy.decide(current: setup.version, channel: setup.channel, system: ProcessInfo.processInfo.operatingSystemVersion, architecture: "arm64", feed: verified, allowedSchemes: setup.allowedSchemes)
    }

    private func install(_ release: UpdateRelease, _ setup: Setup) async {
        let files = UpdateFiles(home: home)
        do {
            try FileManager.default.createDirectory(at: files.folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            guard let address = URL(string: release.url) else { throw UpdateError.notDownloadable }
            let (temporary, response) = try await URLSession(configuration: .ephemeral).download(from: address)
            if let http = response as? HTTPURLResponse, http.statusCode != 200 { throw UpdateError.notDownloadable }
            let archive = files.folder.appendingPathComponent("download.zip")
            try? FileManager.default.removeItem(at: archive)
            try FileManager.default.moveItem(at: temporary, to: archive)
            let staged = try UpdateInstaller.stage(archive: archive, release: release, bundleIdentifier: setup.bundleIdentifier, staging: files.staging)
            try? FileManager.default.removeItem(at: archive)
            let forwarded = testing.isEmpty ? [] : testing.map { $0.key + "=" + $0.value }
            record("installing:" + release.version)
            try UpdateInstaller.launchInstaller(installed: bundle, fresh: staged, version: release.version, files: files, pid: ProcessInfo.processInfo.processIdentifier, forwardedEnvironment: forwarded)
            stopWork()
            NSApp.terminate(nil)
        } catch {
            try? FileManager.default.removeItem(at: files.staging)
            record("install-failed")
            _ = tell("Pip couldn’t install the update", "The download did not match what the signed update information promised, or could not be opened. Nothing was changed; Pip is still the version you had.")
        }
    }
}
