import Foundation

/// The shared production native router has exactly one enabled store factory:
/// explicitly marked isolated files. It never constructs EventKit or UN centers.
@MainActor
public final class IsolatedBackendBridge {
    public struct Seed: Codable { let targets: [ScheduleTarget]; let objects: [ScheduleObject]; let access: Bool; let notificationPermission: String }
    struct NotificationSpec: Codable, Equatable { let reminderId: String; let title: String; let at: Double; let zone: String; let owner: String }
    struct RequestRecord: Codable { let id: String; let alarm: NotificationSpec }
    struct NotificationState: Codable { var requests: [RequestRecord]; var enqueueCalls: Int }
    let area: FixtureArea
    let store: IsolatedScheduleStore
    let notes: IsolatedNoteReview
    let seed: Seed
    public init(home: URL, sandbox: URL) throws {
        area = try FixtureArea(directory: home, sandbox: sandbox)
        guard let seed = try area.load(Seed.self, "backend-seed.json"), ["granted", "denied"].contains(seed.notificationPermission) else { throw BackendError.unsafeFixture }
        self.seed = seed
        store = try IsolatedScheduleStore(area: area, initial: .init(targets: seed.targets, objects: seed.objects, access: seed.access))
        notes = IsolatedNoteReview(area: area)
    }
    private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
        return try decoder.decode(type, from: JSONSerialization.data(withJSONObject: value))
    }
    private func json<T: Encodable>(_ value: T) throws -> Any {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .millisecondsSince1970
        return try JSONSerialization.jsonObject(with: encoder.encode(value))
    }
    private func intent(_ change: [String: Any], id: String) throws -> NativeIntent {
        guard let value = change["after"] as? [String: Any] else { throw BackendError.invalidOperation }
        try EventShape.validate(value)
        var wire = change; wire["effectID"] = id.lowercased()
        let result = try decode(NativeIntent.self, wire); try result.validate(); return result
    }
    private func checked(_ value: NativeIntent) async throws {
        guard try await store.targets(value.target.kind).contains(value.target) else { throw BackendError.staleTarget }
        if value.kind != .create {
            let before = try await store.read(value.objectID!, target: value.target)
            guard before.revision == value.beforeRevision, before.correlation == value.beforeCorrelation else { throw BackendError.changedObject }
            _ = try NativeIntent(effectID: value.effectID, target: value.target, kind: value.kind, before: before, after: value.after)
        }
    }
    private func notification(_ op: String, _ args: [String: Any]) throws -> String {
        guard let id = args["id"] as? String, id.count == 64, id.allSatisfy(\.isHexDigit), let raw = args["alarm"] else { throw BackendError.invalidOperation }
        let spec = try decode(NotificationSpec.self, raw)
        guard spec.owner == "local", !spec.title.isEmpty, spec.title.count <= 1000, spec.at.isFinite, TimeZone(identifier: spec.zone) != nil else { throw BackendError.invalidOperation }
        var state = try area.load(NotificationState.self, "notification-requests.json") ?? .init(requests: [], enqueueCalls: 0)
        let matches = state.requests.filter { $0.id == id }
        if !matches.isEmpty { return matches.count == 1 && matches[0].alarm == spec ? "queued" : "unknown" }
        if op == "notification.lookup" { return "absent" }
        state.enqueueCalls += 1
        if seed.notificationPermission == "denied" { try area.save(state, "notification-requests.json"); return "denied" }
        state.requests.append(RequestRecord(id: id, alarm: spec)); try area.save(state, "notification-requests.json"); return "queued"
    }
    private func effect(_ proposal: [String: Any], reconcile: Bool) async throws -> [String: Any] {
        guard let id = proposal["id"] as? String, UUID(uuidString: id) != nil,
              proposal["status"] as? String == (reconcile ? "unknown" : "intent-recorded"),
              let action = proposal["action"] as? [String: Any], let type = action["type"] as? String else { throw BackendError.invalidOperation }
        var started = false
        do {
            switch type {
            case "schedule.mutate":
                guard let change = action["change"] as? [String: Any] else { throw BackendError.invalidOperation }
                let prepared = try intent(change, id: id)
                if reconcile {
                    let found = try await store.matching(prepared)
                    guard found.count == 1, let object = found.first, object.targetID == prepared.target.id, object.value == prepared.after,
                          prepared.objectID == nil || prepared.objectID == object.id else { return ["status":"unknown", "receipt":"The isolated store cannot prove the outcome. No operation was repeated."] }
                    return ["status":"succeeded", "receipt":"Confirmed the exact isolated object without repeating the change.", "result":try json(object)]
                }
                try await checked(prepared); started = true
                let object = try await store.apply(prepared)
                guard object.value == prepared.after, object.correlation == prepared.effectID else { throw BackendError.ambiguousReceipt }
                return ["status":"succeeded", "receipt":"Saved the approved change in the isolated store only.", "result":try json(object)]
            case "note.review":
                guard !reconcile, let path = action["path"] as? String, let replacement = action["replacement"] as? String else { throw BackendError.overwriteReviewRequired }
                let review = try await notes.prepare(URL(fileURLWithPath: path), replacement: replacement)
                return ["status":"succeeded", "receipt":"Prepared an isolated overwrite review. No note was changed.", "result":["review":try json(review), "digest":try backendDigest(review)]]
            case "note.review.confirm":
                guard !reconcile, let reviewID = action["reviewId"] as? String, let digest = action["reviewDigest"] as? String else { throw BackendError.overwriteReviewRequired }
                _ = try await notes.confirm(reviewID, reviewedDigest: digest)
                return ["status":"succeeded", "receipt":"Confirmed the isolated overwrite review. Execution is still disabled; no note was changed."]
            default: throw BackendError.invalidOperation
            }
        } catch is NativeRejected { return ["status":"failed-known", "receipt":"The isolated store rejected the stale or invalid change before writing."] }
        catch {
            return ["status":reconcile || started ? "unknown" : "failed-known", "receipt":"Isolated backend refused: \(error). No operation will be repeated automatically."]
        }
    }
    public func handle(_ data: Data) async -> Data {
        var id = "invalid"
        do {
            guard data.count <= 200000, let message = try JSONSerialization.jsonObject(with: data) as? [String: Any], message["version"] as? Int == 1,
                  message["kind"] as? String == "backend.request", let requestID = message["id"] as? String,
                  let payload = message["payload"] as? [String: Any], let op = payload["op"] as? String, let args = payload["args"] as? [String: Any] else { throw BackendError.invalidOperation }
            id = requestID
            let result: Any
            switch op {
            case "targets":
                guard let raw = args["kind"] as? String, let kind = ScheduleKind(rawValue: raw) else { throw BackendError.invalidOperation }
                result = try json(await store.targets(kind))
            case "resolveDue":
                guard let wall = args["wall"] else { throw BackendError.invalidTime }
                let choice: Occurrence?
                if let raw = args["occurrence"] as? String { guard let value = Occurrence(rawValue: raw) else { throw BackendError.needsOccurrence }; choice = value } else { choice = nil }
                switch try DueTime.resolve(decode(WallTime.self, wall), occurrence: choice) {
                case .resolved(let due): result = ["kind":"resolved", "due":try json(due)]
                case .gap(let next): result = ["kind":"gap", "nextValid":try json(next), "requiresConfirmation":true]
                case .ambiguous(let a, let b): result = ["kind":"ambiguous", "earlier":a.timeIntervalSince1970*1000, "later":b.timeIntervalSince1970*1000, "requiresOccurrence":true]
                }
            case "read":
                guard let raw = args["target"], let objectID = args["id"] as? String else { throw BackendError.invalidOperation }
                result = try json(await store.read(objectID, target: decode(ScheduleTarget.self, raw)))
            case "listEvents":
                guard let raw = args["target"], let start = args["start"] as? Double, let end = args["end"] as? Double else { throw BackendError.invalidRange }
                result = try json(await store.list(decode(ScheduleTarget.self, raw), range: ScheduleRange(start: Date(timeIntervalSince1970:start/1000), end: Date(timeIntervalSince1970:end/1000))))
            case "queryReminders":
                guard let raw = args["target"], let query = args["query"] else { throw BackendError.invalidQuery }
                result = try json(await store.queryReminders(decode(ScheduleTarget.self, raw), query: decode(ReminderQuery.self, query)))
            case "checkChange":
                guard let change = args["change"] as? [String: Any] else { throw BackendError.invalidOperation }
                try await checked(intent(change, id: UUID().uuidString)); result = ["valid":true]
            case "execute", "reconcile":
                guard let proposal = args["proposal"] as? [String: Any] else { throw BackendError.invalidOperation }
                result = try await effect(proposal, reconcile: op == "reconcile")
            case "notification.enqueue", "notification.lookup": result = ["status":try notification(op, args)]
            default: throw BackendError.invalidOperation
            }
            let output = try JSONSerialization.data(withJSONObject: ["version":1,"id":id,"kind":"backend.response","payload":["ok":true,"result":result]], options: [.sortedKeys])
            guard output.count <= 1000000 else { throw BackendError.invalidOperation }; return output
        } catch {
            return (try? JSONSerialization.data(withJSONObject: ["version":1,"id":id,"kind":"backend.response","payload":["ok":false,"code":String(describing:error),"message":"Isolated backend refused: \(error)"]])) ?? Data()
        }
    }
}
