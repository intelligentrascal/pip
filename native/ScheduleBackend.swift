import Foundation
import CryptoKit

public func backendDigest<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; encoder.dateEncodingStrategy = .millisecondsSince1970
    return SHA256.hash(data: try encoder.encode(value)).map { String(format: "%02x", $0) }.joined()
}
public enum ScheduleKind: String, Codable, Sendable { case event, reminder }
public struct ScheduleTarget: Codable, Equatable, Sendable {
    public let id: String; public let title: String; public let kind: ScheduleKind
    public let writable: Bool; public let revision: String
    public init(id: String, title: String, kind: ScheduleKind, writable: Bool, revision: String) {
        self.id = id; self.title = title; self.kind = kind; self.writable = writable; self.revision = revision
    }
}
public struct ScheduleValue: Codable, Equatable, Sendable {
    public var kind: ScheduleKind; public var title: String
    public var start: ApprovedDue?; public var end: ApprovedDue?; public var due: ApprovedDue?
    public var completed: Bool
    public static func event(_ title: String, start: ApprovedDue, end: ApprovedDue) -> Self {
        Self(kind: .event, title: title, start: start, end: end, due: nil, completed: false)
    }
    public static func reminder(_ title: String, due: ApprovedDue? = nil) -> Self {
        Self(kind: .reminder, title: title, start: nil, end: nil, due: due, completed: false)
    }
    public func validate() throws {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 1000 else { throw BackendError.invalidOperation }
        if kind == .event {
            guard let start, let end, let a = start.instant, let b = end.instant, b > a,
                  start.wall.zone == end.wall.zone, due == nil, !completed else { throw BackendError.invalidRange }
            try DueTime.validate(start); try DueTime.validate(end)
        } else {
            guard start == nil, end == nil else { throw BackendError.invalidOperation }
            if let due { try DueTime.validate(due) }
        }
    }
}
public struct ScheduleObject: Codable, Equatable, Sendable {
    public let id: String; public let targetID: String; public let correlation: String
    public let revision: String; public let value: ScheduleValue
}
public enum MutationKind: String, Codable, Sendable { case create, reminderDue, reminderCompletion }
public struct NativeIntent: Codable, Equatable, Sendable {
    public let effectID: String; public let target: ScheduleTarget; public let kind: MutationKind
    public let objectID: String?; public let beforeRevision: String?; public let beforeCorrelation: String?; public let after: ScheduleValue
    /// This is a prepared payload, not consent. Production dispatch must first bind
    /// its digest to the existing proposal ledger. Nothing here opens a system store.
    public init(effectID: String, target: ScheduleTarget, kind: MutationKind = .create, before: ScheduleObject? = nil, after: ScheduleValue) throws {
        guard UUID(uuidString: effectID) != nil else { throw BackendError.invalidOperation }
        try after.validate()
        guard target.kind == after.kind, target.writable else { throw BackendError.readOnlyTarget }
        if kind == .create {
            guard before == nil, !after.completed else { throw BackendError.invalidOperation }
        } else {
            guard let before, before.targetID == target.id, before.value.kind == .reminder, after.kind == .reminder,
                  before.value.title == after.title else { throw BackendError.invalidOperation }
            if kind == .reminderDue { guard before.value.completed == after.completed else { throw BackendError.invalidOperation } }
            else { guard before.value.due == after.due else { throw BackendError.invalidOperation } }
        }
        self.effectID = effectID.lowercased(); self.target = target; self.kind = kind
        self.objectID = before?.id; self.beforeRevision = before?.revision; self.beforeCorrelation = before?.correlation; self.after = after
    }
    public func validate() throws {
        guard UUID(uuidString: effectID) != nil, effectID == effectID.lowercased(), target.kind == after.kind, target.writable,
              !target.id.isEmpty, !target.revision.isEmpty else { throw BackendError.invalidOperation }
        try after.validate()
        if kind == .create { guard objectID == nil, beforeRevision == nil, beforeCorrelation == nil, !after.completed else { throw BackendError.invalidOperation } }
        else { guard after.kind == .reminder, let objectID, !objectID.isEmpty, let beforeRevision, !beforeRevision.isEmpty, beforeCorrelation != nil else { throw BackendError.invalidOperation } }
    }
}
public struct ScheduleRange: Sendable { public let start: Date; public let end: Date
    public init(start: Date, end: Date) throws { guard end > start, end.timeIntervalSince(start) <= 366 * 86400 else { throw BackendError.invalidRange }; self.start = start; self.end = end }
}
public protocol ScheduleStore: Sendable {
    func targets(_ kind: ScheduleKind) async throws -> [ScheduleTarget]
    func read(_ id: String, target: ScheduleTarget) async throws -> ScheduleObject
    func list(_ target: ScheduleTarget, range: ScheduleRange?) async throws -> [ScheduleObject]
    func queryReminders(_ target: ScheduleTarget, query: ReminderQuery) async throws -> ReminderPage
    func apply(_ intent: NativeIntent) async throws -> ScheduleObject
    func matching(_ intent: NativeIntent) async throws -> [ScheduleObject]
}
// Only a proved pre-write rejection may become failed-known. Other errors are Unknown.
public struct NativeRejected: Error { public let reason: BackendError; public init(_ reason: BackendError) { self.reason = reason } }
public enum ReceiptState: String, Codable, Sendable { case intentRecorded, succeeded, failedKnown, unknown }
public struct NativeReceipt: Codable, Sendable {
    public let intent: NativeIntent; public var state: ReceiptState; public var nativeID: String?
}
public struct FixtureArea: Sendable {
    public let directory: URL
    public init(directory: URL, sandbox: URL) throws {
        let root = sandbox.standardizedFileURL.resolvingSymlinksInPath()
        let actual = directory.standardizedFileURL.resolvingSymlinksInPath()
        let production = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Pip").standardizedFileURL
        guard root.path != "/", root != FileManager.default.homeDirectoryForCurrentUser,
              actual.path.hasPrefix(root.path + "/"), !actual.path.hasPrefix(production.path),
              try String(contentsOf: actual.appendingPathComponent(".pip-test-home"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) == "pip-test-only" else { throw BackendError.unsafeFixture }
        self.directory = actual
    }
    public func load<T: Decodable>(_ type: T.Type, _ name: String) throws -> T? {
        let url = try file(name)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(type, from: Data(contentsOf: url))
    }
    public func save<T: Encodable>(_ value: T, _ name: String) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        try encoder.encode(value).write(to: file(name), options: .atomic)
    }
    private func file(_ name: String) throws -> URL {
        guard !name.contains("/"), !name.contains("..") else { throw BackendError.unsafeFixture }
        let url = directory.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: url.path), try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true { throw BackendError.unsafeFixture }
        return url
    }
}
public actor IsolatedScheduleStore: ScheduleStore {
    public struct State: Codable {
        public var targets: [ScheduleTarget]; public var objects: [ScheduleObject]; public var access: Bool
        public init(targets: [ScheduleTarget], objects: [ScheduleObject] = [], access: Bool = true) { self.targets = targets; self.objects = objects; self.access = access }
    }
    let area: FixtureArea
    var state: State
    public init(area: FixtureArea, initial: State) throws {
        self.area = area; state = try area.load(State.self, "schedule-fixture.json") ?? initial
        try area.save(state, "schedule-fixture.json")
    }
    public func targets(_ kind: ScheduleKind) throws -> [ScheduleTarget] { guard state.access else { throw BackendError.accessDenied }; return state.targets.filter { $0.kind == kind } }
    public func read(_ id: String, target: ScheduleTarget) throws -> ScheduleObject {
        _ = try checked(target)
        guard let item = state.objects.first(where: { $0.id == id && $0.targetID == target.id && $0.value.kind == target.kind }) else { throw BackendError.missingObject }; return item
    }
    public func list(_ target: ScheduleTarget, range: ScheduleRange?) throws -> [ScheduleObject] {
        _ = try checked(target)
        if target.kind == .event && range == nil { throw BackendError.invalidRange }
        if target.kind == .reminder && range != nil { throw BackendError.invalidRange }
        return state.objects.filter { item in
            guard item.targetID == target.id else { return false }
            guard let range, item.value.kind == .event else { return true }
            return item.value.start!.instant! < range.end && item.value.end!.instant! > range.start
        }
    }
    private func checked(_ target: ScheduleTarget) throws -> ScheduleTarget {
        guard state.access else { throw BackendError.accessDenied }
        guard let current = state.targets.first(where: { $0.id == target.id && $0.kind == target.kind }), current == target else { throw BackendError.staleTarget }; return current
    }
    public func apply(_ intent: NativeIntent) throws -> ScheduleObject {
        do {
            try intent.validate()
            let target = try checked(intent.target); guard target.writable else { throw BackendError.readOnlyTarget }
            try intent.after.validate()
            if intent.kind != .create {
                guard let prior = state.objects.first(where: { $0.id == intent.objectID }), prior.revision == intent.beforeRevision, prior.correlation == intent.beforeCorrelation else { throw BackendError.changedObject }
                _ = try NativeIntent(effectID: intent.effectID, target: target, kind: intent.kind, before: prior, after: intent.after)
            }
        } catch let error as BackendError { throw NativeRejected(error) }
        guard !state.objects.contains(where: { $0.correlation == intent.effectID }) else { throw NativeRejected(.alreadyDispatched) }
        let item = ScheduleObject(id: intent.objectID ?? UUID().uuidString, targetID: intent.target.id, correlation: intent.effectID,
                                  revision: UUID().uuidString, value: intent.after)
        var next = state; next.objects.removeAll { $0.id == item.id }; next.objects.append(item)
        try area.save(next, "schedule-fixture.json"); state = next; return item
    }
    public func matching(_ intent: NativeIntent) throws -> [ScheduleObject] {
        _ = try checked(intent.target)
        return state.objects.filter { $0.targetID == intent.target.id && $0.correlation == intent.effectID }
    }
}
public actor IsolatedReceiptLedger {
    let area: FixtureArea
    var receipts: [String: NativeReceipt]
    public init(area: FixtureArea) throws {
        self.area = area; receipts = try area.load([String: NativeReceipt].self, "native-ledger-fixture.json") ?? [:]
        for key in receipts.keys where receipts[key]?.state == .intentRecorded { receipts[key]?.state = .unknown }
        try area.save(receipts, "native-ledger-fixture.json")
    }
    public func receipt(_ id: String) -> NativeReceipt? { receipts[id] }
    public func dispatch(_ intent: NativeIntent, reviewedDigest: String, store: any ScheduleStore) async throws -> NativeReceipt {
        try intent.validate()
        guard reviewedDigest == (try backendDigest(intent)), receipts[intent.effectID] == nil else { throw BackendError.alreadyDispatched }
        guard !receipts.values.contains(where: { previous in
            guard previous.state == .unknown || previous.state == .intentRecorded else { return false }
            return intent.objectID != nil ? previous.intent.objectID == intent.objectID || previous.intent.effectID == intent.beforeCorrelation : previous.intent.target.id == intent.target.id && previous.intent.after == intent.after
        }) else { throw BackendError.ambiguousReceipt }
        receipts[intent.effectID] = NativeReceipt(intent: intent, state: .intentRecorded, nativeID: nil)
        try area.save(receipts, "native-ledger-fixture.json")
        do {
            let object = try await store.apply(intent)
            guard object.correlation == intent.effectID, object.targetID == intent.target.id, object.value == intent.after else { throw BackendError.ambiguousReceipt }
            receipts[intent.effectID]?.state = .succeeded; receipts[intent.effectID]?.nativeID = object.id
        } catch is NativeRejected { receipts[intent.effectID]?.state = .failedKnown }
        catch { receipts[intent.effectID]?.state = .unknown }
        try area.save(receipts, "native-ledger-fixture.json"); return receipts[intent.effectID]!
    }
    public func reconcile(_ id: String, store: any ScheduleStore) async throws -> NativeReceipt {
        guard let receipt = receipts[id], receipt.state == .unknown || receipt.state == .intentRecorded else { throw BackendError.invalidOperation }
        do {
            let matches = try await store.matching(receipt.intent)
            if matches.count == 1, let object = matches.first, object.value == receipt.intent.after,
               object.targetID == receipt.intent.target.id, object.correlation.lowercased() == id.lowercased(),
               receipt.intent.objectID == nil || receipt.intent.objectID == object.id {
                receipts[id]?.state = .succeeded; receipts[id]?.nativeID = object.id
            } else { receipts[id]?.state = .unknown }
        } catch { receipts[id]?.state = .unknown }
        try area.save(receipts, "native-ledger-fixture.json"); return receipts[id]!
    }
}
