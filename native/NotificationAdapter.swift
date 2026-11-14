import Foundation
@preconcurrency import UserNotifications

public enum NotificationReceipt: String, Sendable { case queued, denied, absent, unknown }
/// Unwired port: no .current() call and no requestAuthorization call. The app does
/// not construct this adapter. Queueing is not proof that a person saw an alert.
@MainActor
public final class NativeNotificationPort {
    private let center: UNUserNotificationCenter
    public init(authorizedCenter: UNUserNotificationCenter) { center = authorizedCenter }
    public func lookup(_ occurrenceID: String, title: String, approvedInstant: Date) async -> NotificationReceipt {
        let matches: @Sendable (UNNotificationRequest) -> Bool = { request in
            request.content.body == title && (request.content.userInfo["pipApprovedInstant"] as? NSNumber)?.doubleValue == approvedInstant.timeIntervalSince1970
        }
        let pending: [Bool] = await withCheckedContinuation { continuation in
            center.getPendingNotificationRequests { values in continuation.resume(returning: values.filter { $0.identifier == occurrenceID }.map(matches)) }
        }
        if !pending.isEmpty { return pending.allSatisfy { $0 } ? .queued : .unknown }
        let delivered: [Bool] = await withCheckedContinuation { continuation in
            center.getDeliveredNotifications { values in continuation.resume(returning: values.filter { $0.request.identifier == occurrenceID }.map { matches($0.request) }) }
        }
        return delivered.isEmpty ? .absent : delivered.allSatisfy { $0 } ? .queued : .unknown
    }
    public func queue(_ occurrenceID: String, title: String, approvedInstant: Date, now: Date) async throws -> NotificationReceipt {
        guard occurrenceID.count == 64, occurrenceID.allSatisfy({ $0.isHexDigit }), !title.isEmpty, title.count <= 1000, now >= approvedInstant else { throw BackendError.invalidOperation }
        let existing = await lookup(occurrenceID, title: title, approvedInstant: approvedInstant)
        if existing == .queued { return .queued }
        if existing == .unknown { throw BackendError.ambiguousReceipt }
        let allowed: Bool = await withCheckedContinuation { continuation in
            center.getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional)
            }
        }
        guard allowed else { return .denied }
        let content = UNMutableNotificationContent(); content.title = "Pip reminder"; content.body = title
        content.userInfo = ["pipApprovedInstant": approvedInstant.timeIntervalSince1970]
        // The durable task has already reached the approved instant. One stable
        // occurrence queues once; waking late does not create repeating triggers.
        let request = UNNotificationRequest(identifier: occurrenceID, content: content, trigger: nil)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            center.add(request) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        return .queued
    }
}
