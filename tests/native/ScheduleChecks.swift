import Foundation
import PipCore

private enum ReceiptLost: Error { case afterWrite }
private actor LostReceiptStore: ScheduleStore {
    let base: IsolatedScheduleStore
    init(_ base: IsolatedScheduleStore) { self.base = base }
    func targets(_ kind: ScheduleKind) async throws -> [ScheduleTarget] { try await base.targets(kind) }
    func read(_ id: String, target: ScheduleTarget) async throws -> ScheduleObject { try await base.read(id, target: target) }
    func list(_ target: ScheduleTarget, range: ScheduleRange?) async throws -> [ScheduleObject] { try await base.list(target, range: range) }
    func apply(_ intent: NativeIntent) async throws -> ScheduleObject { _ = try await base.apply(intent); throw ReceiptLost.afterWrite }
    func matching(_ intent: NativeIntent) async throws -> [ScheduleObject] { try await base.matching(intent) }
}

struct ScheduleChecks {
    static func require(_ condition: Bool, _ reason: String) { precondition(condition, reason) }
    static func rejected(_ expected: BackendError, _ body: () async throws -> Void) async throws {
        do { try await body(); preconditionFailure("Expected backend refusal: \(expected)") }
        catch let error as BackendError { require(error == expected, "Unexpected refusal: \(error)") }
    }
    static func resolved(_ wall: WallTime, occurrence: Occurrence? = nil) throws -> ApprovedDue {
        guard case .resolved(let due) = try DueTime.resolve(wall, occurrence: occurrence) else { throw BackendError.invalidTime }; return due
    }
    static func area(_ sandbox: URL, _ label: String) throws -> FixtureArea {
        let directory = sandbox.appendingPathComponent("pip-\(label)-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data("pip-test-only".utf8).write(to: directory.appendingPathComponent(".pip-test-home"))
        return try FixtureArea(directory: directory, sandbox: sandbox)
    }
    // Intent: V1-SPEC A12 explicit wall times, date-only tasks and DST gap/fold choice.
    static func dates() async throws -> [String: Any] {
        let day = try resolved(WallTime(2026, 11, 6, zone: "Europe/Madrid"))
        require(day.instant == nil && day.wall.hour == nil && day.wall.minute == nil, "Date-only gained a midnight alarm")
        let gap = WallTime(2026, 3, 29, hour: 2, minute: 30, zone: "Europe/Madrid")
        guard case .gap(let next) = try DueTime.resolve(gap) else { preconditionFailure("Spring gap was silently resolved") }
        require(next.hour == 3 && next.minute == 0, "Did not offer next valid local time")
        let fold = WallTime(2026, 10, 25, hour: 2, minute: 30, zone: "Europe/Madrid")
        guard case .ambiguous(let first, let last) = try DueTime.resolve(fold) else { preconditionFailure("Fold occurrence was silently selected") }
        let early = try resolved(fold, occurrence: .earlier), late = try resolved(fold, occurrence: .later)
        require(first == early.instant && last == late.instant && first < last, "Fold choice does not identify distinct instants")
        let halfHour = WallTime(2026, 4, 5, hour: 1, minute: 45, zone: "Australia/Lord_Howe")
        guard case .ambiguous(let a, let b) = try DueTime.resolve(halfHour), let zone = TimeZone(identifier: halfHour.zone) else { preconditionFailure("Half-hour fold not recognized") }
        require(b.timeIntervalSince(a) == Double(zone.secondsFromGMT(for: a) - zone.secondsFromGMT(for: b)), "Assumed every DST fold is one hour")
        try await rejected(.invalidDate) { _ = try DueTime.resolve(WallTime(2026, 2, 30, zone: "Europe/Madrid")) }
        try await rejected(.invalidZone) { _ = try DueTime.resolve(WallTime(2026, 11, 6, zone: "Not/A_Zone")) }
        try await rejected(.invalidTime) { _ = try DueTime.resolve(WallTime(2026, 11, 6, hour: 9, zone: "Europe/Madrid")) }
        // Re-encoding/reopen preserves the absolute instant; no default-zone arithmetic.
        let reopened = try JSONDecoder().decode(ApprovedDue.self, from: JSONEncoder().encode(late))
        try DueTime.validate(reopened); require(reopened.instant == late.instant, "Approved instant shifted")
        var tampered = try JSONSerialization.jsonObject(with: JSONEncoder().encode(late)) as! [String: Any]
        tampered["instant"] = late.instant!.addingTimeInterval(3600).timeIntervalSinceReferenceDate
        let forged = try JSONDecoder().decode(ApprovedDue.self, from: JSONSerialization.data(withJSONObject: tampered))
        try await rejected(.invalidTime) { try DueTime.validate(forged) }
        let iso = ISO8601DateFormatter()
        return ["dateOnlyHasNoInstant": true, "gapOfferedHour": next.hour!, "gapOfferedMinute": next.minute!, "foldEarlier": iso.string(from: first), "foldLater": iso.string(from: last), "halfHourFoldSeconds": b.timeIntervalSince(a), "forgedInstantRefused": true]
    }
    // Intent: A10/A11/A14 selected native target, independent mutations, persisted receipts.
    // All reads/writes below are to the actual isolated JSON store, never EKEventStore.
    static func stores(_ sandbox: URL) async throws -> [String: Any] {
        let fixture = try area(sandbox, "schedule")
        let eventTarget = ScheduleTarget(id: UUID().uuidString, title: "Fixture calendar", kind: .event, writable: true, revision: UUID().uuidString)
        let listTarget = ScheduleTarget(id: UUID().uuidString, title: "Fixture reminders", kind: .reminder, writable: true, revision: UUID().uuidString)
        let otherList = ScheduleTarget(id: UUID().uuidString, title: "Other fixture list", kind: .reminder, writable: true, revision: UUID().uuidString)
        let store = try IsolatedScheduleStore(area: fixture, initial: .init(targets: [eventTarget, listTarget, otherList]))
        let ledger = try IsolatedReceiptLedger(area: fixture)
        let start = try resolved(WallTime(2026, 11, 6, hour: 9, minute: 0, zone: "Europe/Madrid"))
        let end = try resolved(WallTime(2026, 11, 6, hour: 10, minute: 0, zone: "Europe/Madrid"))
        let event = try NativeIntent(effectID: UUID().uuidString, target: eventTarget, after: .event("Review the notes", start: start, end: end))
        let receipt = try await ledger.dispatch(event, reviewedDigest: backendDigest(event), store: store)
        require(receipt.state == .succeeded && receipt.nativeID != nil, "Event receipt missing")
        let range = try ScheduleRange(start: start.instant!, end: end.instant!)
        let selected = try await store.list(eventTarget, range: range)
        try await rejected(.invalidRange) { _ = try await store.list(listTarget, range: range) }
        require(selected.count == 1 && selected.first?.id == receipt.nativeID, "Selected schedule omitted saved event")
        let afterRange = try ScheduleRange(start: end.instant!, end: end.instant!.addingTimeInterval(3600))
        let adjacent = try await store.list(eventTarget, range: afterRange)
        require(adjacent.isEmpty, "Half-open schedule range leaked adjacent event")
        let dateOnly = try resolved(WallTime(2026, 11, 6, zone: "Europe/Madrid"))
        let reminder = try NativeIntent(effectID: UUID().uuidString, target: listTarget, after: .reminder("Pick up tea", due: dateOnly))
        let saved = try await ledger.dispatch(reminder, reviewedDigest: backendDigest(reminder), store: store)
        let before = try await store.read(saved.nativeID!, target: listTarget)
        try await rejected(.missingObject) { _ = try await store.read(saved.nativeID!, target: otherList) }
        require(before.value.due?.instant == nil, "Date-only reminder acquired an alarm instant")
        var newValue = before.value; newValue.due = start
        let change = try NativeIntent(effectID: UUID().uuidString, target: listTarget, kind: .reminderDue, before: before, after: newValue)
        let changed = try await ledger.dispatch(change, reviewedDigest: backendDigest(change), store: store)
        let beforeComplete = try await store.read(changed.nativeID!, target: listTarget)
        var completed = beforeComplete.value; completed.completed = true
        let complete = try NativeIntent(effectID: UUID().uuidString, target: listTarget, kind: .reminderCompletion, before: beforeComplete, after: completed)
        let done = try await ledger.dispatch(complete, reviewedDigest: backendDigest(complete), store: store)
        require(done.state == .succeeded, "Separate completion failed")
        do { _ = try await store.apply(change); preconditionFailure("Stale reminder revision accepted") } catch let error as NativeRejected { require(error.reason == .changedObject, "Unexpected stale-item error") }
        try await rejected(.alreadyDispatched) { _ = try await ledger.dispatch(event, reviewedDigest: backendDigest(event), store: store) }
        let lost = try NativeIntent(effectID: UUID().uuidString, target: listTarget, after: .reminder("Check the repaired receipt"))
        let unknown = try await ledger.dispatch(lost, reviewedDigest: backendDigest(lost), store: LostReceiptStore(store))
        require(unknown.state == .unknown, "Lost receipt falsely reported success or known failure")
        let duplicate = try NativeIntent(effectID: UUID().uuidString, target: listTarget, after: lost.after)
        try await rejected(.ambiguousReceipt) { _ = try await ledger.dispatch(duplicate, reviewedDigest: backendDigest(duplicate), store: store) }
        let uncertainObject = try await store.matching(lost).first!
        var prematureValue = uncertainObject.value; prematureValue.completed = true
        let premature = try NativeIntent(effectID: UUID().uuidString, target: listTarget, kind: .reminderCompletion, before: uncertainObject, after: prematureValue)
        try await rejected(.ambiguousReceipt) { _ = try await ledger.dispatch(premature, reviewedDigest: backendDigest(premature), store: store) }
        let reopen = try IsolatedScheduleStore(area: fixture, initial: .init(targets: []))
        let reopenedLedger = try IsolatedReceiptLedger(area: fixture)
        let reconciled = try await reopenedLedger.reconcile(lost.effectID, store: reopen)
        require(reconciled.state == .succeeded, "Read-only reconciliation did not find actual persisted object")
        let matches = try await reopen.matching(lost)
        require(matches.count == 1 && matches.first?.id == reconciled.nativeID, "Reconciliation duplicated the native object")
        let denied = try IsolatedScheduleStore(area: area(sandbox, "denied"), initial: .init(targets: [eventTarget], access: false))
        try await rejected(.accessDenied) { _ = try await denied.list(eventTarget, range: range) }
        let readOnly = ScheduleTarget(id: UUID().uuidString, title: "Fixture read-only", kind: .event, writable: false, revision: UUID().uuidString)
        try await rejected(.readOnlyTarget) { _ = try NativeIntent(effectID: UUID().uuidString, target: readOnly, after: event.after) }
        return ["fixtureDirectory": fixture.directory.path, "eventID": receipt.nativeID!, "reminderID": saved.nativeID!, "dateOnlyNoAlarm": true, "dueChangeAndCompletionSeparate": true, "lostReceiptBecameUnknown": true, "reconciledID": reconciled.nativeID!, "correlationMatchesAfterReopen": matches.count, "duplicateDispatchRefused": true, "permissionDenialNotEmptySchedule": true]
    }
    // Intent: A14 absence, changed payload, duplicate correlation and revocation
    // cannot turn Unknown into success or authorize a repeat. Fault variants mutate
    // actual isolated store data after a real fixture write; no native data is read.
    static func reconciliationFaults(_ sandbox: URL) async throws -> [String: Any] {
        for variant in ["absent", "changed", "duplicate", "denied"] {
            let fixture = try area(sandbox, "reconcile-" + variant)
            let target = ScheduleTarget(id: UUID().uuidString, title: "Fixture list", kind: .reminder, writable: true, revision: UUID().uuidString)
            let store = try IsolatedScheduleStore(area: fixture, initial: .init(targets: [target]))
            let ledger = try IsolatedReceiptLedger(area: fixture)
            let intent = try NativeIntent(effectID: UUID().uuidString, target: target, after: .reminder("Pick up tea"))
            _ = try await ledger.dispatch(intent, reviewedDigest: backendDigest(intent), store: LostReceiptStore(store))
            let reader: IsolatedScheduleStore
            let readerArea: FixtureArea
            if variant == "absent" || variant == "denied" {
                readerArea = try area(sandbox, "lookup-" + variant)
                reader = try IsolatedScheduleStore(area: readerArea, initial: .init(targets: [target], access: variant != "denied"))
            } else {
                readerArea = fixture
                let file = fixture.directory.appendingPathComponent("schedule-fixture.json")
                var state = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
                var objects = state["objects"] as! [[String: Any]]
                if variant == "changed" {
                    var value = objects[0]["value"] as! [String: Any]; value["title"] = "Explicit external-edit fixture variant"; objects[0]["value"] = value
                } else {
                    var extra = objects[0]; extra["id"] = UUID().uuidString; objects.append(extra)
                }
                state["objects"] = objects; try JSONSerialization.data(withJSONObject: state).write(to: file)
                reader = try IsolatedScheduleStore(area: fixture, initial: .init(targets: []))
            }
            let files = [fixture.directory, readerArea.directory].map { $0.appendingPathComponent("schedule-fixture.json") }
            let before = try files.map { try Data(contentsOf: $0) }
            let reconciled = try await ledger.reconcile(intent.effectID, store: reader)
            require(reconciled.state == .unknown, "Unprovable receipt incorrectly became success: " + variant)
            let after = try files.map { try Data(contentsOf: $0) }
            require(before == after, "Reconciliation modified the native fixture")
        }
        return ["missingObjectHeld": true, "changedPayloadHeld": true, "duplicateCorrelationHeld": true, "permissionRevokedHeld": true, "noStoreWritesDuringReconciliation": true]
    }
    // Intent: A16 distinct overwrite review binds existing bytes, identity and replacement.
    static func notes(_ sandbox: URL) async throws -> [String: Any] {
        let fixture = try area(sandbox, "notes"), review = IsolatedNoteReview(area: fixture)
        let file = fixture.directory.appendingPathComponent("notes.txt")
        let original = "Can you send the notes today?\n"; try Data(original.utf8).write(to: file)
        let proposal = try await review.prepare(file, replacement: "Could you send the notes today? Thank you.\n")
        try await rejected(.overwriteReviewRequired) { _ = try await review.confirm(proposal.id, reviewedDigest: "unreviewed") }
        _ = try await review.confirm(proposal.id, reviewedDigest: backendDigest(proposal))
        require(try String(contentsOf: file, encoding: .utf8) == original, "Review performed an unapproved file overwrite")
        try await rejected(.overwriteReviewRequired) { _ = try await review.confirm(proposal.id, reviewedDigest: backendDigest(proposal)) }
        let stale = try await review.prepare(file, replacement: "A shorter note.")
        try Data("A later fixture edit.\n".utf8).write(to: file)
        try await rejected(.changedFile) { _ = try await review.confirm(stale.id, reviewedDigest: backendDigest(stale)) }
        let link = fixture.directory.appendingPathComponent("link.txt")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
        try await rejected(.unsafeFile) { _ = try await review.prepare(link, replacement: "Do not follow links.") }
        return ["distinctReviewRequired": true, "confirmationDidNotWrite": true, "staleFileRefused": true, "symlinkRefused": true]
    }
    static func run() async throws {
        let environment = ProcessInfo.processInfo.environment
        let sandbox = URL(fileURLWithPath: environment["PIP_TEST_ROOT"] ?? NSTemporaryDirectory()).standardizedFileURL.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: sandbox, withIntermediateDirectories: true)
        let proof: [String: Any] = ["scope": "isolated stores only; no EventKit store or notification center constructed", "dates": try await dates(), "stores": try await stores(sandbox), "reconciliationFaults": try await reconciliationFaults(sandbox), "noteReview": try await notes(sandbox)]
        let data = try JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys])
        if let output = environment["PIP_NATIVE_EVIDENCE"] { try data.write(to: URL(fileURLWithPath: output)) }
        print(String(data: data, encoding: .utf8)!)
        print("Native date, isolated-store, reconciliation and overwrite-review interfaces passed")
    }
}
