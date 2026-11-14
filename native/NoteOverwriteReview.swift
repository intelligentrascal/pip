import Foundation
import CryptoKit
import Darwin

public struct NoteReview: Codable, Equatable, Sendable {
    public let id: String; public let path: String
    public let device: UInt64; public let inode: UInt64
    public let oldDigest: String; public let replacementDigest: String
    public let oldText: String; public let replacement: String
}
/// Fixture-only review port, deliberately not an overwrite executor. The running
/// app still refuses replacement. No hash-then-write race is presented as atomic CAS.
public actor IsolatedNoteReview {
    let area: FixtureArea
    var pending: [String: NoteReview] = [:]
    public init(area: FixtureArea) { self.area = area }
    public func prepare(_ file: URL, replacement: String) throws -> NoteReview {
        guard !replacement.isEmpty, replacement.utf8.count <= 120000 else { throw BackendError.invalidOperation }
        let read = try snapshot(file)
        let review = NoteReview(id: UUID().uuidString, path: file.standardizedFileURL.path,
                                device: read.device, inode: read.inode, oldDigest: read.hash,
                                replacementDigest: SHA256.hash(data: Data(replacement.utf8)).map { String(format: "%02x", $0) }.joined(),
                                oldText: read.text, replacement: replacement)
        pending[review.id] = review; return review
    }
    /// Separate confirmation checks the exact replacement and current file snapshot.
    /// Returns a reviewed plan only; no call in this component writes the note.
    public func confirm(_ id: String, reviewedDigest: String) throws -> NoteReview {
        guard let review = pending[id], reviewedDigest == (try backendDigest(review)) else { throw BackendError.overwriteReviewRequired }
        let current = try snapshot(URL(fileURLWithPath: review.path))
        guard current.device == review.device, current.inode == review.inode, current.hash == review.oldDigest else { throw BackendError.changedFile }
        pending[id] = nil; return review
    }
    private func snapshot(_ file: URL) throws -> (device: UInt64, inode: UInt64, hash: String, text: String) {
        let url = file.standardizedFileURL
        guard url.path.hasPrefix(area.directory.path + "/"), url.resolvingSymlinksInPath() == url else { throw BackendError.unsafeFile }
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard fd >= 0 else { throw BackendError.unsafeFile }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close() }
        var before = stat(); guard fstat(fd, &before) == 0, (before.st_mode & S_IFMT) == S_IFREG,
            before.st_nlink == 1, before.st_size >= 0, before.st_size <= 1048576 else { throw BackendError.unsafeFile }
        let data = try handle.read(upToCount: 1048577) ?? Data()
        var after = stat(); guard fstat(fd, &after) == 0, before.st_ino == after.st_ino, before.st_size == after.st_size,
            before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
            data.count == before.st_size, let text = String(data: data, encoding: .utf8) else { throw BackendError.changedFile }
        return (UInt64(before.st_dev), UInt64(before.st_ino), SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(), text)
    }
}
