import Foundation

public enum BackendError: Error, Equatable {
    case invalidDate, invalidZone, invalidTime, needsOccurrence, nonexistentTime
    case accessDenied, readOnlyTarget, staleTarget, invalidRange, invalidOperation
    case missingObject, ambiguousReceipt, changedObject, unsafeFixture, alreadyDispatched
    case overwriteReviewRequired, changedFile, unsafeFile
    case unsupportedAllDay, unsupportedFloating, unsupportedRecurring, invalidQuery
}
public enum Occurrence: String, Codable, Sendable { case earlier, later }
public struct WallTime: Codable, Equatable, Sendable {
    public var year: Int; public var month: Int; public var day: Int
    public var hour: Int?; public var minute: Int?; public var zone: String
    public init(_ year: Int, _ month: Int, _ day: Int, hour: Int? = nil, minute: Int? = nil, zone: String) {
        self.year = year; self.month = month; self.day = day; self.hour = hour; self.minute = minute; self.zone = zone
    }
}
public struct ApprovedDue: Codable, Equatable, Sendable {
    public let wall: WallTime
    public let instant: Date?
    public let occurrence: Occurrence?
    fileprivate init(wall: WallTime, instant: Date?, occurrence: Occurrence?) {
        self.wall = wall; self.instant = instant; self.occurrence = occurrence
    }
}
public enum DueResolution: Equatable, Sendable {
    case resolved(ApprovedDue)
    case ambiguous(earlier: Date, later: Date)
    case gap(nextValid: WallTime)
}
public enum DueTime {
    /// Explicit Gregorian wall fields only. Natural-language interpretation must ask
    /// for missing fields before this boundary; it cannot silently choose a DST fold.
    public static func resolve(_ wall: WallTime, occurrence: Occurrence? = nil) throws -> DueResolution {
        guard let zone = TimeZone(identifier: wall.zone) else { throw BackendError.invalidZone }
        guard (1...9999).contains(wall.year), (1...12).contains(wall.month), (1...31).contains(wall.day) else { throw BackendError.invalidDate }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(secondsFromGMT: 0)!
        let dateFields = DateComponents(year: wall.year, month: wall.month, day: wall.day, hour: 12)
        guard let noon = utc.date(from: dateFields), matchesDate(noon, wall, utc) else { throw BackendError.invalidDate }
        if wall.hour == nil && wall.minute == nil {
            guard occurrence == nil else { throw BackendError.invalidTime }
            return .resolved(ApprovedDue(wall: wall, instant: nil, occurrence: nil))
        }
        guard let hour = wall.hour, let minute = wall.minute, (0...23).contains(hour), (0...59).contains(minute) else { throw BackendError.invalidTime }
        // Read actual zone offsets/transitions, then round-trip candidate instants.
        // Foundation's repeatedTimePolicy alone misses sub-hour folds on this SDK.
        let nominal = utc.date(from: DateComponents(year: wall.year, month: wall.month, day: wall.day, hour: hour, minute: minute, second: 0))!
        let lower = nominal.addingTimeInterval(-3 * 86400), upper = nominal.addingTimeInterval(3 * 86400)
        var offsets: Set<Int> = [zone.secondsFromGMT(for: lower), zone.secondsFromGMT(for: nominal), zone.secondsFromGMT(for: upper)]
        var transitions: [Date] = []; var cursor = lower
        while let transition = zone.nextDaylightSavingTimeTransition(after: cursor), transition <= upper {
            guard transition > cursor, transitions.count < 32 else { throw BackendError.invalidTime }
            transitions.append(transition)
            offsets.insert(zone.secondsFromGMT(for: transition.addingTimeInterval(-1)))
            offsets.insert(zone.secondsFromGMT(for: transition)); cursor = transition.addingTimeInterval(1)
        }
        let candidates = offsets.map { nominal.addingTimeInterval(-Double($0)) }.filter { date in
            matchesDate(date, wall, calendar) && calendar.component(.hour, from: date) == hour && calendar.component(.minute, from: date) == minute && calendar.component(.second, from: date) == 0
        }.sorted()
        guard let first = candidates.first else {
            for transition in transitions {
                let before = zone.secondsFromGMT(for: transition.addingTimeInterval(-1)), after = zone.secondsFromGMT(for: transition)
                if after > before, nominal >= transition.addingTimeInterval(Double(before)), nominal < transition.addingTimeInterval(Double(after)) {
                    let f = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: transition)
                    return .gap(nextValid: WallTime(f.year!, f.month!, f.day!, hour: f.hour, minute: f.minute, zone: wall.zone))
                }
            }
            throw BackendError.nonexistentTime
        }
        guard candidates.count <= 2 else { throw BackendError.needsOccurrence }
        let last = candidates.last!
        if first != last {
            guard let occurrence else { return .ambiguous(earlier: min(first, last), later: max(first, last)) }
            return .resolved(ApprovedDue(wall: wall, instant: occurrence == .earlier ? min(first, last) : max(first, last), occurrence: occurrence))
        }
        return .resolved(ApprovedDue(wall: wall, instant: first, occurrence: nil))
    }
    public static func validate(_ due: ApprovedDue) throws {
        guard case .resolved(let checked) = try resolve(due.wall, occurrence: due.occurrence), checked == due else { throw BackendError.invalidTime }
    }
    private static func matchesDate(_ date: Date, _ wall: WallTime, _ calendar: Calendar) -> Bool {
        let fields = calendar.dateComponents([.year, .month, .day], from: date)
        return fields.year == wall.year && fields.month == wall.month && fields.day == wall.day
    }
}
