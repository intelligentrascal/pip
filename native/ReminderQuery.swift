import Foundation

public struct ReminderQuery: Codable, Sendable {
    public let start: Date; public let end: Date; public let zone: String
    public let includeCompleted: Bool; public let includeDateOnly: Bool; public let limit: Int
    public init(start: Date, end: Date, zone: String, includeCompleted: Bool, includeDateOnly: Bool, limit: Int) throws {
        self.start = start; self.end = end; self.zone = zone; self.includeCompleted = includeCompleted; self.includeDateOnly = includeDateOnly; self.limit = limit
        try validate()
    }
    public func validate() throws {
        guard end > start, end.timeIntervalSince(start) <= 32 * 86400, TimeZone(identifier: zone) != nil, (1...100).contains(limit) else { throw BackendError.invalidQuery }
    }
    public func contains(_ object: ScheduleObject) -> Bool {
        guard object.value.kind == .reminder, includeCompleted || !object.value.completed, let due = object.value.due else { return false }
        if let instant = due.instant { return instant >= start && instant < end }
        guard includeDateOnly, let timeZone = TimeZone(identifier: zone) else { return false }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        // Date-only labels overlap local days in the explicitly requested query zone.
        // The interval is for filtering only: the stored task never gains an instant/alarm.
        guard let noon = calendar.date(from: DateComponents(year: due.wall.year, month: due.wall.month, day: due.wall.day, hour: 12)),
              calendar.component(.year, from: noon) == due.wall.year, calendar.component(.month, from: noon) == due.wall.month,
              calendar.component(.day, from: noon) == due.wall.day, let day = calendar.dateInterval(of: .day, for: noon) else { return false }
        return day.start < end && day.end > start
    }
}
public struct ReminderPage: Codable, Sendable {
    public let items: [ScheduleObject]; public let truncated: Bool
    public static func select(_ objects: [ScheduleObject], query: ReminderQuery) throws -> ReminderPage {
        try query.validate()
        let matching = objects.filter(query.contains).sorted { $0.id < $1.id }
        return ReminderPage(items: Array(matching.prefix(query.limit)), truncated: matching.count > query.limit)
    }
}
extension ScheduleStore {
    public func queryReminders(_ target: ScheduleTarget, query: ReminderQuery) async throws -> ReminderPage {
        guard target.kind == .reminder else { throw BackendError.invalidQuery }
        return try ReminderPage.select(await list(target, range: nil), query: query)
    }
}
/// Refusals occur before JSON decoding could drop unsupported event fields.
public enum EventShape {
    public static func validate(_ value: [String: Any]) throws {
        guard value["kind"] as? String == "event" else { return }
        let allowed: Set<String> = ["kind", "title", "start", "end", "due", "completed", "allDay", "floating", "recurrence"]
        guard Set(value.keys).isSubset(of: allowed) else { throw BackendError.invalidOperation }
        if value["allDay"] as? Bool == true { throw BackendError.unsupportedAllDay }
        if value["floating"] as? Bool == true { throw BackendError.unsupportedFloating }
        if let rules = value["recurrence"] as? [Any], !rules.isEmpty { throw BackendError.unsupportedRecurring }
        if let rules = value["recurrence"] as? String, !rules.isEmpty { throw BackendError.unsupportedRecurring }
        if let flag = value["allDay"], !(flag is Bool) { throw BackendError.invalidOperation }
        if let flag = value["floating"], !(flag is Bool) { throw BackendError.invalidOperation }
        if let rules = value["recurrence"], !(rules is [String]) { throw BackendError.invalidOperation }
        for key in ["start", "end"] {
            guard let due = value[key] as? [String: Any], let wall = due["wall"] as? [String: Any], let zone = wall["zone"] as? String, !zone.isEmpty,
                  due["instant"] is NSNumber else { throw BackendError.unsupportedFloating }
        }
    }
}
