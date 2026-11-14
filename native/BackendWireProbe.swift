import Foundation
import AppKit

/// Hidden-app protocol verification only. No keyboard, screenshots, focus changes,
/// system stores or permission requests; not enabled in ordinary profiles.
@MainActor
final class BackendWireProbe {
    unowned let host: Pip
    let output: URL
    var stage = "ready"
    var target: [String: Any] = [:]
    var proposalID = ""
    var objectID = ""
    var deadline: DispatchWorkItem?
    var observations: [[String: Any]] = []
    func observe(_ kind: String) {
        observations.append(["kind":kind,"stage":stage,"uptime":ProcessInfo.processInfo.systemUptime])
        try? JSONSerialization.data(withJSONObject:observations,options:[.prettyPrinted,.sortedKeys]).write(to:output.appendingPathComponent("backend-observations.json"),options:.atomic)
    }
    init(host: Pip, output: URL) {
        self.host = host; self.output = output
        let pid = ["pid":ProcessInfo.processInfo.processIdentifier]
        try? JSONSerialization.data(withJSONObject: pid).write(to: output.appendingPathComponent("backend-process.json"), options: .atomic)
        let timeout = DispatchWorkItem { [weak self] in self?.finish(error: "Native app backend protocol exceeded its deadline") }
        deadline = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
    }
    func receive(_ message: [String: Any]) {
        guard stage != "finished", let kind = message["kind"] as? String else { return }
        observe(kind)
        if kind == "error" || kind == "disconnected" { finish(error: "Native app service failed"); return }
        if stage == "ready", kind == "state" { stage = "targets"; host.send("backendQuery", ["op":"targets", "args":["kind":"reminder"]]); return }
        if kind == "backendResult" {
            if stage == "targets" {
                guard let values = message["payload"] as? [[String: Any]], let selected = values.first(where: { $0["title"] as? String == "Fixture reminders" }) else { finish(error:"Isolated fixture target missing"); return }
                target = selected; stage = "due"
                host.send("backendQuery", ["op":"resolveDue", "args":["wall":["year":2026,"month":11,"day":6,"zone":"Europe/Madrid"]]]); return
            }
            if stage == "due" {
                guard let result = message["payload"] as? [String: Any], result["kind"] as? String == "resolved", let due = result["due"] as? [String: Any], due["instant"] == nil else { finish(error:"Date-only resolution invented an instant"); return }
                let after: [String: Any] = ["kind":"reminder", "title":"Pick up tea", "due":due, "completed":false]
                let change: [String: Any] = ["target":target, "kind":"create", "after":after]
                stage = "proposed"; host.send("propose", ["action":["type":"schedule.mutate", "change":change]]); return
            }
            if stage == "query" {
                guard let page = message["payload"] as? [String: Any], let items = page["items"] as? [[String: Any]], items.count == 1, items.first?["id"] as? String == objectID else { finish(error:"Bounded query did not return the approved isolated object"); return }
                finish(); return
            }
        }
        guard kind == "state", let payload = message["payload"] as? [String: Any], let state = payload["state"] as? [String: Any], let proposals = state["proposals"] as? [[String: Any]] else { return }
        if stage == "proposed", let p = proposals.last, p["status"] as? String == "proposed", let id = p["id"] as? String, let revision = p["revision"], let digest = p["digest"] {
            proposalID = id; stage = "approved"
            host.send("approve", ["id":id,"revision":revision,"digest":digest]); return
        }
        if stage == "approved", let p = proposals.first(where: { $0["id"] as? String == proposalID }), p["status"] as? String == "succeeded" {
            guard let raw = p["backendResult"] as? String, let result = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any], result["correlation"] as? String == proposalID, let id = result["id"] as? String else { finish(error:"Native app receipt did not bind the exact proposal"); return }
            objectID = id; stage = "query"
            var calendar = Calendar(identifier:.gregorian); calendar.timeZone = TimeZone(identifier:"Europe/Madrid")!
            let start = calendar.date(from:DateComponents(year:2026,month:11,day:6))!, end = calendar.date(byAdding:.day,value:1,to:start)!
            host.send("backendQuery", ["op":"queryReminders", "args":["target":target,"query":["start":start.timeIntervalSince1970*1000,"end":end.timeIntervalSince1970*1000,"zone":"Europe/Madrid","includeCompleted":false,"includeDateOnly":true,"limit":10]]])
        }
    }
    func finish(error: String? = nil) {
        guard stage != "finished" else { return }; stage = "finished"; deadline?.cancel()
        var proof: [String: Any] = ["nativeAppPrivateBridge":error == nil,"proposal":proposalID,"nativeObject":objectID,"isolatedStoresOnly":true,"keyboardUsed":false,"systemStoreConstructed":false]
        if let error { proof["failure"] = error }
        observe(error == nil ? "finish-success" : "finish-failure")
        do { try JSONSerialization.data(withJSONObject:proof,options:[.prettyPrinted,.sortedKeys]).write(to:output.appendingPathComponent("backend-app-proof.json"), options: .atomic) }
        catch { try? FileHandle.standardError.write(contentsOf:Data("Backend verification proof could not be written: \(error)\n".utf8)) }
        NSApp.terminate(nil)
    }
}
