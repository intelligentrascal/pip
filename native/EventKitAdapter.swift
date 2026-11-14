import Foundation
@preconcurrency import EventKit

/// Unwired production port. Importing this type does not create EKEventStore,
/// request access, enumerate data or save anything. A future authorized caller
/// must supply its own store after source consent. Tests use IsolatedScheduleStore.
@MainActor
public final class EventKitScheduleStore: ScheduleStore {
    private let store: EKEventStore
    public init(authorizedStore: EKEventStore) { store = authorizedStore }
    private func access(_ kind: ScheduleKind) throws {
        let entity: EKEntityType = kind == .event ? .event : .reminder
        guard EKEventStore.authorizationStatus(for: entity) == .fullAccess else { throw BackendError.accessDenied }
    }
    private func target(_ calendar: EKCalendar, _ kind: ScheduleKind) throws -> ScheduleTarget {
        let revision = try backendDigest([calendar.calendarIdentifier, calendar.title, calendar.source.sourceIdentifier, String(calendar.allowsContentModifications), kind.rawValue])
        return ScheduleTarget(id: calendar.calendarIdentifier, title: calendar.title, kind: kind, writable: calendar.allowsContentModifications, revision: revision)
    }
    public func targets(_ kind: ScheduleKind) async throws -> [ScheduleTarget] {
        try access(kind)
        return try store.calendars(for: kind == .event ? .event : .reminder).map { try target($0, kind) }
    }
    private func checked(_ wanted: ScheduleTarget) throws -> EKCalendar {
        try access(wanted.kind)
        guard let calendar = store.calendar(withIdentifier: wanted.id), try target(calendar, wanted.kind) == wanted,
              calendar.allowedEntityTypes.contains(wanted.kind == .event ? .event : .reminder) else { throw BackendError.staleTarget }
        return calendar
    }
    private func due(_ date: Date, zone: TimeZone) throws -> ApprovedDue {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        guard c.second == 0 else { throw BackendError.invalidTime }
        let wall = WallTime(c.year!, c.month!, c.day!, hour: c.hour!, minute: c.minute!, zone: zone.identifier)
        let result = try DueTime.resolve(wall)
        switch result {
        case .resolved(let due): return due
        case .ambiguous(let earlier, let later):
            guard date == earlier || date == later, case .resolved(let due) = try DueTime.resolve(wall, occurrence: date == earlier ? .earlier : .later) else { throw BackendError.invalidTime }; return due
        case .gap: throw BackendError.invalidTime
        }
    }
    private func reminderDue(_ item: EKReminder) throws -> ApprovedDue? {
        guard let fields = item.dueDateComponents else {
            guard (item.alarms ?? []).isEmpty else { throw BackendError.invalidOperation }
            return nil
        }
        guard let year = fields.year, let month = fields.month, let day = fields.day,
              let zone = fields.timeZone ?? fields.calendar?.timeZone else { throw BackendError.invalidZone }
        let wall = WallTime(year, month, day, hour: fields.hour, minute: fields.minute, zone: zone.identifier)
        if fields.hour == nil && fields.minute == nil, case .resolved(let result) = try DueTime.resolve(wall) {
            guard (item.alarms ?? []).isEmpty else { throw BackendError.invalidOperation }
            return result
        }
        switch try DueTime.resolve(wall) {
        case .resolved(let result): return result
        case .ambiguous(let earlier, let later):
            let evidence = (item.alarms ?? []).compactMap(\.absoluteDate).filter { $0 == earlier || $0 == later }
            guard Set(evidence).count == 1, let instant = evidence.first,
                  case .resolved(let result) = try DueTime.resolve(wall, occurrence: instant == earlier ? .earlier : .later) else { throw BackendError.needsOccurrence }
            return result
        case .gap: throw BackendError.nonexistentTime
        }
    }
    private func object(_ item: EKCalendarItem) throws -> ScheduleObject {
        guard (item.recurrenceRules ?? []).isEmpty else { throw BackendError.unsupportedRecurring }
        var value: ScheduleValue
        if let event = item as? EKEvent {
            guard !event.isAllDay else { throw BackendError.unsupportedAllDay }
            guard let zone = event.timeZone else { throw BackendError.unsupportedFloating }
            value = .event(event.title ?? "", start: try due(event.startDate, zone: zone), end: try due(event.endDate, zone: zone))
        } else if let reminder = item as? EKReminder {
            value = .reminder(reminder.title ?? "", due: try reminderDue(reminder)); value.completed = reminder.isCompleted
        } else { throw BackendError.invalidOperation }
        let correlation = item.url?.scheme == "pip-effect" ? (item.url?.host ?? "") : ""
        let revision = try backendDigest([item.calendarItemIdentifier, try backendDigest(value), item.url?.absoluteString ?? "", String(item.lastModifiedDate?.timeIntervalSince1970 ?? 0)])
        return ScheduleObject(id: item.calendarItemIdentifier, targetID: item.calendar.calendarIdentifier, correlation: correlation, revision: revision, value: value)
    }
    public func read(_ id: String, target: ScheduleTarget) async throws -> ScheduleObject {
        _ = try checked(target)
        guard let item = store.calendarItem(withIdentifier: id), item.calendar.calendarIdentifier == target.id, (target.kind == .event ? item is EKEvent : item is EKReminder) else { throw BackendError.missingObject }
        return try object(item)
    }
    public func list(_ target: ScheduleTarget, range: ScheduleRange?) async throws -> [ScheduleObject] {
        let calendar = try checked(target)
        if target.kind == .event {
            guard let range else { throw BackendError.invalidRange }
            return try store.events(matching: store.predicateForEvents(withStart: range.start, end: range.end, calendars: [calendar])).map(object)
        }
        // Do not silently broaden a requested due-date range into a whole-list read.
        // A bounded native due-query port needs its own validated contract.
        guard range == nil else { throw BackendError.invalidRange }
        let predicate = store.predicateForReminders(in: [calendar])
        let objects: [ScheduleObject] = try await withCheckedThrowingContinuation { continuation in
            store.fetchReminders(matching: predicate) { values in
                do {
                    guard let values else { throw BackendError.invalidOperation }
                    continuation.resume(returning: try values.map(self.object))
                } catch { continuation.resume(throwing: error) }
            }
        }
        // Only value snapshots cross the callback boundary, never EKReminder objects.
        // Recheck revocation; a cancelled fetch or denial is never an empty list.
        try access(.reminder)
        return objects
    }
    public func queryReminders(_ target: ScheduleTarget, query: ReminderQuery) async throws -> ReminderPage {
        try query.validate()
        guard target.kind == .reminder, !query.includeCompleted else { throw BackendError.invalidQuery }
        let calendar = try checked(target)
        var zoneCalendar = Calendar(identifier: .gregorian); zoneCalendar.timeZone = TimeZone(identifier: query.zone)!
        let lower = query.includeDateOnly ? zoneCalendar.startOfDay(for: query.start) : query.start
        let upper = query.includeDateOnly ? zoneCalendar.date(byAdding: .day, value: 1, to: zoneCalendar.startOfDay(for: query.end))! : query.end
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: lower, ending: upper, calendars: [calendar])
        let snapshots: [ScheduleObject] = try await withCheckedThrowingContinuation { continuation in
            store.fetchReminders(matching: predicate) { values in
                do { guard let values else { throw BackendError.invalidOperation }; continuation.resume(returning: try values.map(self.object)) }
                catch { continuation.resume(throwing: error) }
            }
        }
        try access(.reminder)
        return try ReminderPage.select(snapshots, query: query)
    }
    public func apply(_ intent: NativeIntent) async throws -> ScheduleObject {
        let calendar: EKCalendar
        var prior: EKReminder?
        do {
            try intent.validate()
            calendar = try checked(intent.target)
            guard calendar.allowsContentModifications else { throw BackendError.readOnlyTarget }
            try intent.after.validate()
            if intent.kind != .create {
                guard let id = intent.objectID, let item = store.calendarItem(withIdentifier: id) as? EKReminder else { throw BackendError.missingObject }
                let before = try object(item)
                guard item.url == nil || item.url?.scheme == "pip-effect", (item.alarms ?? []).count <= 1,
                      (item.alarms ?? []).allSatisfy({ $0.absoluteDate != nil && $0.structuredLocation == nil }) else { throw BackendError.invalidOperation }
                guard before.revision == intent.beforeRevision, before.correlation == intent.beforeCorrelation else { throw BackendError.changedObject }
                _ = try NativeIntent(effectID: intent.effectID, target: intent.target, kind: intent.kind, before: before, after: intent.after)
                prior = item
            } else { _ = try NativeIntent(effectID: intent.effectID, target: intent.target, after: intent.after) }
        } catch let error as BackendError { throw NativeRejected(error) }
        let marker = URL(string: "pip-effect://" + intent.effectID.lowercased())!
        if intent.after.kind == .event {
            let event = EKEvent(eventStore: store); event.calendar = calendar; event.title = intent.after.title
            event.startDate = intent.after.start!.instant!; event.endDate = intent.after.end!.instant!
            event.timeZone = TimeZone(identifier: intent.after.start!.wall.zone); event.url = marker
            try store.save(event, span: .thisEvent, commit: true)
            return try object(event)
        }
        let reminder = prior ?? EKReminder(eventStore: store)
        reminder.calendar = calendar; reminder.title = intent.after.title; reminder.url = marker
        if intent.kind == .create || intent.kind == .reminderDue {
            reminder.dueDateComponents = nil; reminder.alarms = nil
            if let due = intent.after.due {
                var fields = DateComponents(); fields.calendar = Calendar(identifier: .gregorian)
                fields.timeZone = TimeZone(identifier: due.wall.zone); fields.year = due.wall.year; fields.month = due.wall.month; fields.day = due.wall.day
                fields.hour = due.wall.hour; fields.minute = due.wall.minute
                reminder.dueDateComponents = fields
                if let instant = due.instant { reminder.addAlarm(EKAlarm(absoluteDate: instant)) }
            }
        }
        if intent.kind == .reminderCompletion { reminder.isCompleted = intent.after.completed }
        try store.save(reminder, commit: true)
        return try object(reminder)
    }
    public func matching(_ intent: NativeIntent) async throws -> [ScheduleObject] {
        if let id = intent.objectID {
            let item = try await read(id, target: intent.target)
            return item.correlation.lowercased() == intent.effectID.lowercased() ? [item] : []
        }
        let range = intent.after.kind == .event ? try ScheduleRange(start: intent.after.start!.instant!.addingTimeInterval(-1), end: intent.after.end!.instant!.addingTimeInterval(1)) : nil
        return try await list(intent.target, range: range).filter { $0.correlation.lowercased() == intent.effectID.lowercased() }
    }
}
