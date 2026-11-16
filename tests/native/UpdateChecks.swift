import Foundation
import CryptoKit
import PipCore

// Intent (ELF-68, direction C, the captain's "build B and add in-app updates before release"): an update is offered only when a feed signed by Pip's
// release key says so, only forward, only for this Mac and channel; Pip never replaces a copy Homebrew or a disk image owns; a download that
// is not the signed bytes is never opened; and a failed replacement leaves the old Pip in place. Nothing installs without the person agreeing.
// Fixtures: a feed and signature made by scripts/update-feed.ts (Node's Ed25519, read here by CryptoKit), real folders and real /bin/sh runs.
enum UpdateChecks {
    static func require(_ condition: Bool, _ what: String) { precondition(condition, "Updates failed: " + what) }
    static let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("fixtures/update-feed")
    static let sequoia = OperatingSystemVersion(majorVersion: 15, minorVersion: 1, patchVersion: 0)
    static func fail<T>(_ expected: UpdateError, _ body: () throws -> T) -> Bool {
        do { _ = try body(); return false } catch let error as UpdateError { return error == expected } catch { return false }
    }
    static func run() throws {
        versions(); try feeds(); try policy(); try owners(); try downloads(); try installer()
        print("Update checks passed")
    }

    static func versions() {
        let ordered = ["0.1.0-alpha.1", "0.1.0-alpha.2", "0.1.0-alpha.10", "0.1.0-beta", "0.1.0", "0.1.1", "0.2.0", "1.0.0"].map { UpdateVersion($0) }
        require(ordered.allSatisfy { $0 != nil }, "versions as Pip writes them parse")
        require(Swift.zip(ordered, ordered.dropFirst()).allSatisfy { $0!  < $1! }, "alpha.2 comes before alpha.10, a prerelease before its release, then 0.1.1, 0.2.0, 1.0.0")
        for bad in ["", "1", "1.2", "1.2.3.4", "v1.2.3", "1.2.3-", "1.2.3+build", "1.2.x", "-1.2.3"] { require(UpdateVersion(bad) == nil, "\(bad) is not a version") }
        require(UpdateVersion("1.2.3-alpha.1")!.description == "1.2.3-alpha.1", "a version prints as it was written")
        require(UpdateChannel.alpha < .beta && .beta < .stable, "channels run from alpha to stable")
    }

    static func feeds() throws {
        let feed = try Data(contentsOf: fixtures.appendingPathComponent("feed.json"))
        let signature = try Data(contentsOf: fixtures.appendingPathComponent("feed.json.sig"))
        let key = try String(contentsOf: fixtures.appendingPathComponent("public-key.txt"), encoding: .utf8)
        let decoded = try SignedFeed.verify(feed: feed, signature: signature, publicKey: key)
        require(decoded.releases.map(\.version) == ["0.1.0-alpha.1", "0.1.0-alpha.2", "0.2.0"], "the release tool's feed is accepted, releases in order")
        var tampered = feed; tampered[tampered.count / 2] ^= 1
        require(fail(.badSignature) { try SignedFeed.verify(feed: tampered, signature: signature, publicKey: key) }, "one changed byte breaks the signature")
        let stranger = Curve25519.Signing.PrivateKey()
        require(fail(.badSignature) { try SignedFeed.verify(feed: feed, signature: signature, publicKey: stranger.publicKey.rawRepresentation.base64EncodedString()) }, "another key's feed is refused")
        require(fail(.badKey) { try SignedFeed.verify(feed: feed, signature: signature, publicKey: "") }, "a build without a key trusts no feed")
        require(fail(.badSignature) { try SignedFeed.verify(feed: feed, signature: Data("not a signature".utf8), publicKey: key) }, "a damaged signature is refused")
        let other = try JSONSerialization.data(withJSONObject: ["schema": 1, "product": "someone-else", "releases": []])
        require(fail(.badFeed) { try SignedFeed.verify(feed: other, signature: Data(try stranger.signature(for: other).base64EncodedString().utf8), publicKey: stranger.publicKey.rawRepresentation.base64EncodedString()) }, "a signed feed for another product is refused")
    }

    static func policy() throws {
        let feed = try JSONDecoder().decode(UpdateFeed.self, from: Data(contentsOf: fixtures.appendingPathComponent("feed.json")))
        func offered(_ current: String, _ channel: UpdateChannel, _ system: OperatingSystemVersion = sequoia, _ arch: String = "arm64") throws -> String? {
            if case .available(let release) = try UpdatePolicy.decide(current: current, channel: channel, system: system, architecture: arch, feed: feed) { return release.version }; return nil
        }
        require(try offered("0.1.0-alpha.1", .alpha) == "0.2.0", "an alpha build is offered the newest release of any channel it follows")
        require(try offered("0.1.0-alpha.1", .stable) == "0.2.0", "a stable build is offered a stable release")
        require(try offered("0.1.0-alpha.1", .alpha, OperatingSystemVersion(majorVersion: 14, minorVersion: 6, patchVersion: 1)) == "0.1.0-alpha.2", "a release that needs a newer macOS is not offered; the best one this Mac can run is")
        require(try offered("0.1.0-alpha.2", .alpha, OperatingSystemVersion(majorVersion: 14, minorVersion: 6, patchVersion: 1)) == nil, "nothing newer this Mac can run means up to date")
        require(try offered("0.2.0", .alpha) == nil, "the running version is up to date")
        require(try offered("0.3.0", .alpha) == nil, "a newer build than the feed is never offered a downgrade")
        require(try offered("0.1.0-alpha.1", .alpha, sequoia, "x86_64") == nil, "another chip is never offered an arm64 app")
        require(try offered("0.1.0-alpha.1", .alpha, OperatingSystemVersion(majorVersion: 15, minorVersion: 0, patchVersion: 0)) == "0.2.0", "a minimum of exactly 15.0 allows macOS 15.0")
        let insecure = UpdateFeed(schema: 1, product: "pip", releases: [UpdateRelease(version: "9.0.0", channel: "alpha", minimumSystemVersion: "14.0", architecture: "arm64", url: "http://example.com/Pip.zip", sha256: String(repeating: "a", count: 64), size: 10, notes: "")])
        if case .available = try UpdatePolicy.decide(current: "0.1.0-alpha.1", channel: .alpha, system: sequoia, architecture: "arm64", feed: insecure) { require(false, "a plain http address is never offered") }
        let local = UpdateFeed(schema: 1, product: "pip", releases: [UpdateRelease(version: "9.0.0", channel: "alpha", minimumSystemVersion: "14.0", architecture: "arm64", url: "file:///tmp/Pip.zip", sha256: String(repeating: "a", count: 64), size: 10, notes: "")])
        if case .available = try UpdatePolicy.decide(current: "0.1.0-alpha.1", channel: .alpha, system: sequoia, architecture: "arm64", feed: local) { require(false, "a file address is never offered to a real build") }
        if case .upToDate = try UpdatePolicy.decide(current: "0.1.0-alpha.1", channel: .alpha, system: sequoia, architecture: "arm64", feed: local, allowedSchemes: ["https", "file"]) { require(false, "an isolated rehearsal may allow a file address") }
        require(fail(.badFeed) { try UpdatePolicy.decide(current: "dev", channel: .alpha, system: sequoia, architecture: "arm64", feed: feed) }, "a running version that is not a version cannot be compared")
    }

    static func owners() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("pip-owner-" + UUID().uuidString, isDirectory: true)
        defer { try? fm.removeItem(at: root) }
        let applications = root.appendingPathComponent("Applications", isDirectory: true)
        try fm.createDirectory(at: applications.appendingPathComponent("Pip.app"), withIntermediateDirectories: true)
        let app = applications.appendingPathComponent("Pip.app")
        let brew = root.appendingPathComponent("brew")
        require(InstallOwner.detect(bundle: app, caskToken: "pip-house-elf", homebrewPrefixes: [brew.path]) == .direct, "a copy dragged to Applications belongs to the in-app updater")
        try fm.createDirectory(at: brew.appendingPathComponent("Caskroom/pip-house-elf/0.1.0-alpha.1"), withIntermediateDirectories: true)
        require(InstallOwner.detect(bundle: app, caskToken: "pip-house-elf", homebrewPrefixes: [brew.path]) == .homebrew, "a copy Homebrew installed belongs to Homebrew")
        require(InstallOwner.detect(bundle: app, caskToken: "another-cask", homebrewPrefixes: [brew.path]) == .direct, "another cask's Caskroom does not claim Pip")
        let elsewhere = root.appendingPathComponent("Downloads/Pip.app")
        try fm.createDirectory(at: elsewhere, withIntermediateDirectories: true)
        require(InstallOwner.detect(bundle: elsewhere, caskToken: "pip-house-elf", homebrewPrefixes: [brew.path]) == .direct, "a stray copy outside Applications is not Homebrew's even if the cask exists")
        require(InstallOwner.detect(bundle: URL(fileURLWithPath: "/Volumes/Pip 0.1.0/Pip.app"), caskToken: "pip-house-elf", homebrewPrefixes: []) == .notInstalled, "running from a disk image asks to move Pip first")
        require(InstallOwner.detect(bundle: URL(fileURLWithPath: "/private/var/folders/xx/AppTranslocation/ABC/d/Pip.app"), caskToken: "pip-house-elf", homebrewPrefixes: []) == .notInstalled, "a translocated copy asks to move Pip first")
        try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: applications.path)
        defer { try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: applications.path) }
        require(InstallOwner.detect(bundle: app, caskToken: "pip-house-elf", homebrewPrefixes: [root.appendingPathComponent("none").path]) == .notWritable, "a folder the person cannot write is reported, not attempted")
    }

    static func release(for file: URL, version: String = "0.1.0-alpha.2") throws -> UpdateRelease {
        let data = try Data(contentsOf: file)
        return UpdateRelease(version: version, channel: "alpha", minimumSystemVersion: "14.0", architecture: "arm64", url: "https://github.com/intelligentrascal/pip/releases/download/v\(version)/Pip.zip",
                             sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), size: data.count, notes: "")
    }

    /// A Pip.app as the release build lays it out; a marker path makes the app record that it started.
    static func fakeApp(at url: URL, version: String, startsBy marker: URL?, runnable: Bool = false) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: url.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
        try fm.createDirectory(at: url.appendingPathComponent("Contents/Resources"), withIntermediateDirectories: true)
        let plist: [String: Any] = ["CFBundleIdentifier": "io.github.intelligentrascal.pip", "CFBundleShortVersionString": version, "CFBundleExecutable": "Pip"]
        try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: url.appendingPathComponent("Contents/Info.plist"))
        // The structural checks read a real Apple silicon Mach-O header; the replacement runs start the app, so those bodies are shell scripts.
        var body = runnable ? Data("#!/bin/sh\n".utf8) : Data([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01, 0x0a])
        body.append(Data((marker.map { "touch '\($0.path)'\n" } ?? "").utf8))
        let executable = url.appendingPathComponent("Contents/MacOS/Pip")
        try body.write(to: executable)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    }

    static func makeZip(_ app: URL, to archive: URL) throws {
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        process.arguments = ["-c", "-k", "--keepParent", app.path, archive.path]; try process.run(); process.waitUntilExit()
        require(process.terminationStatus == 0, "the fixture archive is made")
    }

    static func downloads() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("pip-download-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }
        try fakeApp(at: root.appendingPathComponent("build/Pip.app"), version: "0.1.0-alpha.2", startsBy: nil)
        let archive = root.appendingPathComponent("Pip.zip")
        try makeZip(root.appendingPathComponent("build/Pip.app"), to: archive)
        let good = try release(for: archive)
        try UpdateInstaller.verifyDownload(archive, release: good)
        let staged = try UpdateInstaller.stage(archive: archive, release: good, bundleIdentifier: "io.github.intelligentrascal.pip", staging: root.appendingPathComponent("staging"))
        require(staged.lastPathComponent == "Pip.app" && fm.isExecutableFile(atPath: staged.appendingPathComponent("Contents/MacOS/Pip").path), "a verified download opens as one Pip.app")
        require(fail(.wrongSize) { try UpdateInstaller.verifyDownload(archive, release: UpdateRelease(version: good.version, channel: "alpha", minimumSystemVersion: "14.0", architecture: "arm64", url: good.url, sha256: good.sha256, size: good.size + 1, notes: "")) }, "a download of the wrong size is refused")
        require(fail(.wrongHash) { try UpdateInstaller.verifyDownload(archive, release: UpdateRelease(version: good.version, channel: "alpha", minimumSystemVersion: "14.0", architecture: "arm64", url: good.url, sha256: String(repeating: "0", count: 64), size: good.size, notes: "")) }, "a download that is not the signed bytes is refused")
        var damaged = try Data(contentsOf: archive); damaged[damaged.count / 3] ^= 0xff
        let tamperedArchive = root.appendingPathComponent("Tampered.zip"); try damaged.write(to: tamperedArchive)
        require(fail(.wrongHash) { try UpdateInstaller.stage(archive: tamperedArchive, release: good, bundleIdentifier: "io.github.intelligentrascal.pip", staging: root.appendingPathComponent("staging2")) }, "a tampered archive is never opened")
        require({ do { _ = try UpdateInstaller.stage(archive: archive, release: good, bundleIdentifier: "com.example.other", staging: root.appendingPathComponent("staging3")); return false } catch { return true } }(), "an app with another identity is refused")
        let wrongVersion = try release(for: archive, version: "0.1.0-alpha.3")
        require({ do { _ = try UpdateInstaller.stage(archive: archive, release: wrongVersion, bundleIdentifier: "io.github.intelligentrascal.pip", staging: root.appendingPathComponent("staging4")); return false } catch { return true } }(), "an app whose version is not the announced one is refused")
        // An Intel-only app, a second app beside Pip, and a link out of the bundle.
        try fakeApp(at: root.appendingPathComponent("intel/Pip.app"), version: "0.1.0-alpha.2", startsBy: nil)
        var header = try Data(contentsOf: root.appendingPathComponent("intel/Pip.app/Contents/MacOS/Pip")); header[4] = 0x07
        try header.write(to: root.appendingPathComponent("intel/Pip.app/Contents/MacOS/Pip"))
        try makeZip(root.appendingPathComponent("intel/Pip.app"), to: root.appendingPathComponent("Intel.zip"))
        require({ do { _ = try UpdateInstaller.stage(archive: root.appendingPathComponent("Intel.zip"), release: try release(for: root.appendingPathComponent("Intel.zip")), bundleIdentifier: "io.github.intelligentrascal.pip", staging: root.appendingPathComponent("staging5")); return false } catch { return true } }(), "an app that is not Apple silicon is refused")
        try fakeApp(at: root.appendingPathComponent("link/Pip.app"), version: "0.1.0-alpha.2", startsBy: nil)
        try fm.createSymbolicLink(atPath: root.appendingPathComponent("link/Pip.app/Contents/Resources/escape").path, withDestinationPath: "/etc")
        try makeZip(root.appendingPathComponent("link/Pip.app"), to: root.appendingPathComponent("Link.zip"))
        require({ do { _ = try UpdateInstaller.stage(archive: root.appendingPathComponent("Link.zip"), release: try release(for: root.appendingPathComponent("Link.zip")), bundleIdentifier: "io.github.intelligentrascal.pip", staging: root.appendingPathComponent("staging6")); return false } catch { return true } }(), "a link out of the app is refused")
    }

    /// Runs the real install script against disposable apps. `open` is replaced by a stub that starts the app's executable directly.
    static func runScript(root: URL, installed: URL, fresh: URL, marker: URL, startTicks: String = "6") throws -> Int32 {
        let fm = FileManager.default
        let stub = root.appendingPathComponent("open-stub.sh")
        try Data("#!/bin/sh\n\"$1/Contents/MacOS/Pip\" >/dev/null 2>&1 &\n".utf8).write(to: stub)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: stub.path)
        let script = root.appendingPathComponent("install.sh")
        try Data(UpdateInstaller.script(openCommand: stub.path).utf8).write(to: script)
        let log = root.appendingPathComponent("install.log")
        let idle = Process(); idle.executableURL = URL(fileURLWithPath: "/bin/sleep"); idle.arguments = ["3"]; try idle.run()
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path, String(idle.processIdentifier), installed.path, fresh.path, marker.path, log.path]
        process.environment = ["PATH": "/usr/bin:/bin", "PIP_UPDATE_START_TICKS": startTicks]
        let started = Date()
        try process.run()
        process.waitUntilExit()
        require(Date().timeIntervalSince(started) >= 2, "the script waits for Pip to quit before touching the app")
        return process.terminationStatus
    }

    static func version(of app: URL) -> String? { (NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist"))?["CFBundleShortVersionString"]) as? String }

    static func installer() throws {
        let fm = FileManager.default
        func scenario(_ name: String, body: (URL) throws -> Void) throws {
            let root = fm.temporaryDirectory.appendingPathComponent("pip-install-\(name)-" + UUID().uuidString, isDirectory: true)
            try fm.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? fm.removeItem(at: root) }
            try body(root)
        }
        let version = "0.1.0-alpha.2"
        try scenario("success") { root in
            let marker = root.appendingPathComponent("launched-" + version)
            let installed = root.appendingPathComponent("Applications/Pip.app"), fresh = root.appendingPathComponent("staging/Pip.app")
            try fakeApp(at: installed, version: "0.1.0-alpha.1", startsBy: nil, runnable: true); try fakeApp(at: fresh, version: version, startsBy: marker, runnable: true)
            try Data("my notes".utf8).write(to: root.appendingPathComponent("saved-work.txt"))
            require(try runScript(root: root, installed: installed, fresh: fresh, marker: marker) == 0, "the update finishes")
            require(Self.version(of: installed) == version, "the new app is where the old one was")
            require(!fm.fileExists(atPath: installed.path + ".previous") && !fm.fileExists(atPath: installed.path + ".incoming"), "the old copy is removed once the new one has started")
            require((try? String(contentsOf: root.appendingPathComponent("saved-work.txt"), encoding: .utf8)) == "my notes", "saved work is untouched")
        }
        try scenario("never-starts") { root in
            let marker = root.appendingPathComponent("launched-" + version), restored = root.appendingPathComponent("old-started")
            let installed = root.appendingPathComponent("Applications/Pip.app"), fresh = root.appendingPathComponent("staging/Pip.app")
            try fakeApp(at: installed, version: "0.1.0-alpha.1", startsBy: restored, runnable: true); try fakeApp(at: fresh, version: version, startsBy: nil, runnable: true)
            require(try runScript(root: root, installed: installed, fresh: fresh, marker: marker, startTicks: "4") == 4, "a new app that never reports its start is rolled back")
            require(Self.version(of: installed) == "0.1.0-alpha.1", "the old app is back in place")
            Thread.sleep(forTimeInterval: 1)
            require(fm.fileExists(atPath: restored.path), "the old app is opened again")
        }
        try scenario("cannot-place") { root in
            let marker = root.appendingPathComponent("launched-" + version)
            let installed = root.appendingPathComponent("Applications/Pip.app")
            try fakeApp(at: installed, version: "0.1.0-alpha.1", startsBy: nil, runnable: true)
            require(try runScript(root: root, installed: installed, fresh: root.appendingPathComponent("staging/missing/Pip.app"), marker: marker) == 3, "a missing new app is reported")
            require(Self.version(of: installed) == "0.1.0-alpha.1", "the old app is restored when the new one cannot be placed")
        }
        try scenario("launch-markers") { root in
            let files = UpdateFiles(home: root)
            try fm.createDirectory(at: files.staging, withIntermediateDirectories: true)
            try Data().write(to: files.launchedMarker(version: "0.1.0-alpha.1"))
            UpdateFiles.recordLaunch(home: root, version: "0.1.0-alpha.2")
            require(fm.fileExists(atPath: files.launchedMarker(version: "0.1.0-alpha.2").path) && !fm.fileExists(atPath: files.launchedMarker(version: "0.1.0-alpha.1").path), "a launch records its own version and forgets an older one")
            require(!fm.fileExists(atPath: files.staging.path), "a launch clears the update leftovers")
        }
    }
}
