import Foundation

public enum ProviderSignInURL {
    public static func parse(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme == "https", url.user == nil,
              url.password == nil, url.port == nil else { return nil }
        guard url.host == "openrouter.ai" || (url.host == "auth.openai.com" && url.path == "/api/accounts/authorize") else { return nil }
        return url
    }
}

public struct BridgeMessage {
    public let id: String
    public let kind: String
    public let payload: [String: Any]
    public static func parse(_ raw: Any, isMainFrame: Bool, source: URL?, bundledPage: URL) -> BridgeMessage? {
        guard isMainFrame, source?.standardizedFileURL == bundledPage.standardizedFileURL,
              let body = raw as? [String: Any], Set(body.keys) == ["version", "id", "kind", "payload"],
              let version = body["version"] as? Int, version == 1,
              let id = body["id"] as? String, !id.isEmpty, id.count <= 100,
              let kind = body["kind"] as? String,
              ["hide", "resize", "snapshot", "submit", "stop", "propose", "approve", "cancel", "saveComposer", "saveDraft", "backendQuery", "reconcile", "tracker", "feedback.save", "feedback.correct", "work.backlog", "configureShortcut", "browser", "dictation.start", "dictation.stop", "dictation.cancel", "provider.allow", "provider.withdraw", "provider.select", "provider.backup", "provider.signIn", "provider.cancelSignIn", "provider.remove", "provider.enterKey"].contains(kind),
              let payload = body["payload"] as? [String: Any] else { return nil }
        return BridgeMessage(id: id, kind: kind, payload: payload)
    }
}
