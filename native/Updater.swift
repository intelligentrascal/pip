import Foundation
import CryptoKit

// In-app updates, headless part. Trust comes from one place: an Ed25519 signature over the exact bytes of the feed,
// checked with the public key inside the app. The feed names each download's SHA-256 and size, so a download is
// trusted only if the signed feed vouches for it. Nothing here touches the network, the screen or the installed app
// except `UpdateInstaller`, which only ever works in a staging folder and a script the person has agreed to run.

/// Version numbers as Pip writes them: 1.2.3 or 1.2.3-alpha.2. Ordering follows semantic versioning.
public struct UpdateVersion: Comparable, Equatable, Sendable, CustomStringConvertible {
    public let core: [Int]
    public let prerelease: [String]
    public init?(_ text: String) {
        let halves = text.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard halves.count >= 1, !text.contains("+") else { return nil }
        let numbers = halves[0].split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
        guard numbers.count == 3, numbers.allSatisfy({ $0 != nil && $0! >= 0 }) else { return nil }
        let identifiers = halves.count == 2 ? halves[1].split(separator: ".", omittingEmptySubsequences: false).map(String.init) : []
        guard halves.count == 1 || (!identifiers.isEmpty && identifiers.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }) })) else { return nil }
        core = numbers.map { $0! }; prerelease = identifiers
    }
    public var description: String { core.map(String.init).joined(separator: ".") + (prerelease.isEmpty ? "" : "-" + prerelease.joined(separator: ".")) }
    public static func < (a: UpdateVersion, b: UpdateVersion) -> Bool {
        if a.core != b.core { return a.core.lexicographicallyPrecedes(b.core) }
        if a.prerelease.isEmpty || b.prerelease.isEmpty { return !a.prerelease.isEmpty && b.prerelease.isEmpty }
        for (x, y) in zip(a.prerelease, b.prerelease) where x != y {
            switch (Int(x), Int(y)) {
            case let (m?, n?): return m < n
            case (.some, nil): return true
            case (nil, .some): return false
            default: return x < y
            }
        }
        return a.prerelease.count < b.prerelease.count
    }
}

/// Release channels from least to most settled. A build follows its own channel and every more settled one.
public enum UpdateChannel: String, Codable, CaseIterable, Sendable, Comparable {
    case alpha, beta, stable
    private var rank: Int { Self.allCases.firstIndex(of: self)! }
    public static func < (a: UpdateChannel, b: UpdateChannel) -> Bool { a.rank < b.rank }
}

public struct UpdateRelease: Codable, Equatable, Sendable {
    public let version: String
    public let channel: String
    public let minimumSystemVersion: String
    public let architecture: String
    public let url: String
    public let sha256: String
    public let size: Int
    public let notes: String
    public init(version: String, channel: String, minimumSystemVersion: String, architecture: String, url: String, sha256: String, size: Int, notes: String) {
        self.version = version; self.channel = channel; self.minimumSystemVersion = minimumSystemVersion; self.architecture = architecture
        self.url = url; self.sha256 = sha256; self.size = size; self.notes = notes
    }
}

public struct UpdateFeed: Codable, Equatable, Sendable {
    public let schema: Int
    public let product: String
    public let releases: [UpdateRelease]
    public init(schema: Int, product: String, releases: [UpdateRelease]) { self.schema = schema; self.product = product; self.releases = releases }
}

public enum UpdateError: Error, Equatable, Sendable {
    case notConfigured, badKey, badSignature, badFeed, notDownloadable, wrongSize, wrongHash, badArchive(String), cannotInstall(String)
}

public enum UpdateDecision: Equatable, Sendable {
    case upToDate
    case available(UpdateRelease)
}

public enum SignedFeed {
    /// The feed's bytes, only if `signature` (base64 text of 64 bytes) is a valid Ed25519 signature of exactly those bytes by `publicKey` (base64 of 32 bytes).
    public static func verify(feed: Data, signature: Data, publicKey: String) throws -> UpdateFeed {
        guard let raw = Data(base64Encoded: publicKey.trimmingCharacters(in: .whitespacesAndNewlines)), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { throw UpdateError.badKey }
        guard let text = String(data: signature, encoding: .utf8), let bytes = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              key.isValidSignature(bytes, for: feed) else { throw UpdateError.badSignature }
        guard let decoded = try? JSONDecoder().decode(UpdateFeed.self, from: feed), decoded.schema == 1, decoded.product == "pip" else { throw UpdateError.badFeed }
        return decoded
    }
}

public enum UpdatePolicy {
    /// The newest release this build may install, if it is newer than the running version. Anything the feed offers for another chip,
    /// a newer macOS, a less settled channel or an address that is not HTTPS is ignored, never offered.
    public static func decide(current: String, channel: UpdateChannel, system: OperatingSystemVersion, architecture: String, feed: UpdateFeed, allowedSchemes: Set<String> = ["https"]) throws -> UpdateDecision {
        guard let running = UpdateVersion(current) else { throw UpdateError.badFeed }
        let eligible = feed.releases.compactMap { release -> (UpdateVersion, UpdateRelease)? in
            guard let version = UpdateVersion(release.version), let offered = UpdateChannel(rawValue: release.channel), offered >= channel,
                  release.architecture == architecture, let minimum = Self.operatingSystem(release.minimumSystemVersion), Self.atLeast(system, minimum),
                  let address = URL(string: release.url), let scheme = address.scheme, allowedSchemes.contains(scheme), scheme == "file" || address.host != nil, release.sha256.count == 64, release.size > 0 else { return nil }
            return (version, release)
        }
        guard let best = eligible.max(by: { $0.0 < $1.0 }), best.0 > running else { return .upToDate }
        return .available(best.1)
    }
    static func operatingSystem(_ text: String) -> OperatingSystemVersion? {
        let parts = text.split(separator: ".").map { Int($0) }
        guard (1...3).contains(parts.count), parts.allSatisfy({ $0 != nil }) else { return nil }
        return OperatingSystemVersion(majorVersion: parts[0]!, minorVersion: parts.count > 1 ? parts[1]! : 0, patchVersion: parts.count > 2 ? parts[2]! : 0)
    }
    static func atLeast(_ system: OperatingSystemVersion, _ minimum: OperatingSystemVersion) -> Bool {
        (system.majorVersion, system.minorVersion, system.patchVersion) >= (minimum.majorVersion, minimum.minorVersion, minimum.patchVersion)
    }
}

/// Who updates this copy of Pip. The in-app updater only replaces a copy it owns.
public enum InstallOwner: Equatable, Sendable {
    case direct
    /// Homebrew installed this copy; `brew upgrade --cask` updates it and the app must not.
    case homebrew
    /// Running from a mounted disk image or a translocated (quarantined) location: move Pip to Applications first.
    case notInstalled
    /// The folder holding Pip cannot be written by this person.
    case notWritable

    public static func detect(bundle: URL, caskToken: String, homebrewPrefixes: [String] = ["/opt/homebrew", "/usr/local"], fileManager: FileManager = .default) -> InstallOwner {
        let path = bundle.resolvingSymlinksInPath().path
        if path.hasPrefix("/Volumes/") || path.contains("/AppTranslocation/") { return .notInstalled }
        let inApplications = bundle.deletingLastPathComponent().lastPathComponent == "Applications"
        for prefix in homebrewPrefixes {
            let versions = (try? fileManager.contentsOfDirectory(atPath: prefix + "/Caskroom/" + caskToken)) ?? []
            if inApplications, versions.contains(where: { !$0.hasPrefix(".") }) { return .homebrew }
        }
        return fileManager.isWritableFile(atPath: bundle.deletingLastPathComponent().path) && fileManager.isWritableFile(atPath: bundle.path) ? .direct : .notWritable
    }
}

public struct UpdateFiles: Sendable {
    public let folder: URL
    public init(home: URL) { folder = home.appendingPathComponent("updates", isDirectory: true) }
    public var staging: URL { folder.appendingPathComponent("staging", isDirectory: true) }
    public var log: URL { folder.appendingPathComponent("install.log") }
    public func launchedMarker(version: String) -> URL { folder.appendingPathComponent("launched-" + version) }
    /// Called by every launch: records which version is running and clears any marker or leftovers of an older one.
    public static func recordLaunch(home: URL, version: String, fileManager: FileManager = .default) {
        let files = UpdateFiles(home: home)
        try? fileManager.createDirectory(at: files.folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for name in (try? fileManager.contentsOfDirectory(atPath: files.folder.path)) ?? [] where name.hasPrefix("launched-") && name != "launched-" + version {
            try? fileManager.removeItem(at: files.folder.appendingPathComponent(name))
        }
        try? Data().write(to: files.launchedMarker(version: version))
        try? fileManager.removeItem(at: files.staging)
    }
}

public enum UpdateInstaller {
    /// The download's size and SHA-256 must match the signed feed before anything is opened.
    public static func verifyDownload(_ file: URL, release: UpdateRelease) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard (attributes[.size] as? NSNumber)?.intValue == release.size else { throw UpdateError.wrongSize }
        let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
        var hash = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hash.update(data: chunk) }
        guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == release.sha256.lowercased() else { throw UpdateError.wrongHash }
    }

    /// Opens the verified ZIP in `staging` and checks that it holds exactly one Pip app of the expected version and chip. Returns that app.
    public static func stage(archive: URL, release: UpdateRelease, bundleIdentifier: String, staging: URL, fileManager: FileManager = .default) throws -> URL {
        try verifyDownload(archive, release: release)
        try? fileManager.removeItem(at: staging)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let opened = staging.appendingPathComponent("opened", isDirectory: true)
        try fileManager.createDirectory(at: opened, withIntermediateDirectories: true)
        let ditto = Process(); ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        ditto.arguments = ["-x", "-k", archive.path, opened.path]
        ditto.standardOutput = FileHandle.nullDevice; ditto.standardError = FileHandle.nullDevice
        do { try ditto.run() } catch { throw UpdateError.badArchive("The download could not be opened.") }
        ditto.waitUntilExit()
        guard ditto.terminationStatus == 0 else { throw UpdateError.badArchive("The download could not be opened.") }
        let top = (try? fileManager.contentsOfDirectory(atPath: opened.path).filter { !$0.hasPrefix("__MACOSX") && $0 != ".DS_Store" }) ?? []
        guard top == ["Pip.app"] else { throw UpdateError.badArchive("The download does not hold exactly Pip.app.") }
        let app = opened.appendingPathComponent("Pip.app")
        let root = opened.resolvingSymlinksInPath().path + "/"
        for case let entry as String in fileManager.enumerator(atPath: app.path) ?? NSEnumerator() {
            let url = app.appendingPathComponent(entry)
            if let destination = try? fileManager.destinationOfSymbolicLink(atPath: url.path) {
                let target = URL(fileURLWithPath: destination, relativeTo: url.deletingLastPathComponent()).standardized.path
                guard target.hasPrefix(app.resolvingSymlinksInPath().path + "/") || target.hasPrefix(root) else { throw UpdateError.badArchive("The app links to something outside itself.") }
            }
        }
        guard let plist = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")),
              plist["CFBundleIdentifier"] as? String == bundleIdentifier, plist["CFBundleShortVersionString"] as? String == release.version
        else { throw UpdateError.badArchive("The app's identity or version is not the one the feed announced.") }
        let executable = app.appendingPathComponent("Contents/MacOS/Pip")
        guard fileManager.isExecutableFile(atPath: executable.path), isAppleSilicon(executable) else { throw UpdateError.badArchive("The app does not run on this Mac's chip.") }
        return app
    }

    static func isAppleSilicon(_ file: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: file), let head = try? handle.read(upToCount: 8), head.count == 8 else { return false }
        try? handle.close()
        let words = head.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in (raw.loadUnaligned(fromByteOffset: 0, as: UInt32.self), raw.loadUnaligned(fromByteOffset: 4, as: UInt32.self)) }
        return words.0 == 0xfeedfacf && words.1 == 0x0100000c
    }

    /// The script that finishes an update after Pip has quit. It waits for Pip to exit, moves the old app aside, puts the new one in place,
    /// opens it, and waits for the new version to say it started. If it does not, the old app is put back and opened again.
    /// Exit codes: 0 updated, 1 Pip did not quit (nothing changed), 2 the old app could not be moved, 3 the new app could not be placed (restored), 4 the new app did not start (restored).
    public static func script(openCommand: String = "/usr/bin/open", forwardedEnvironment: [String] = []) -> String {
        let open = ([shellQuote(openCommand)] + forwardedEnvironment.flatMap { ["--env", shellQuote($0)] }).joined(separator: " ")
        return """
        #!/bin/sh
        # Arguments: pid, installed app, new app, expected launch marker, log file
        pid="$1"; installed="$2"; fresh="$3"; marker="$4"; log="$5"
        trap '' HUP
        say() { printf '%s %s\\n' "$(date '+%H:%M:%S')" "$1" >> "$log"; }
        waited=0
        while kill -0 "$pid" 2>/dev/null; do
          waited=$((waited + 1)); [ "$waited" -gt "${PIP_UPDATE_QUIT_TICKS:-120}" ] && { say "Pip did not quit; nothing changed."; exit 1; }
          sleep 0.5
        done
        say "Pip quit."
        previous="$installed.previous"; incoming="$installed.incoming"
        rm -rf "$previous" "$incoming"
        mv "$installed" "$previous" || { say "Could not move the old app aside; nothing changed."; exit 2; }
        if ! ditto "$fresh" "$incoming" || ! mv "$incoming" "$installed"; then
          rm -rf "$incoming" "$installed"; mv "$previous" "$installed"; say "Could not place the new app; the old app is back."; exit 3
        fi
        say "New app in place."
        rm -f "$marker"
        \(open) "$installed"
        say "New app opened."
        waited=0
        while [ ! -e "$marker" ]; do
          waited=$((waited + 1))
          if [ "$waited" -gt "${PIP_UPDATE_START_TICKS:-60}" ]; then
            pkill -f "$installed/Contents/MacOS/Pip" 2>/dev/null; sleep 1
            rm -rf "$installed"; mv "$previous" "$installed"; \(open) "$installed"
            say "The new app did not start; the old app is back."; exit 4
          fi
          sleep 0.5
        done
        rm -rf "$previous"
        say "Updated."
        exit 0
        """
    }

    static func shellQuote(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    /// Writes the script to `staging` and starts it detached, so it outlives Pip. The caller then quits Pip.
    public static func launchInstaller(installed: URL, fresh: URL, version: String, files: UpdateFiles, pid: Int32, openCommand: String = "/usr/bin/open", forwardedEnvironment: [String] = []) throws {
        let file = files.staging.appendingPathComponent("install.sh")
        try Data(script(openCommand: openCommand, forwardedEnvironment: forwardedEnvironment).utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        FileManager.default.createFile(atPath: files.log.path, contents: nil)
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [file.path, String(pid), installed.path, fresh.path, files.launchedMarker(version: version).path, files.log.path]
        process.standardInput = FileHandle.nullDevice; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { throw UpdateError.cannotInstall("The installer could not start.") }
    }
}
