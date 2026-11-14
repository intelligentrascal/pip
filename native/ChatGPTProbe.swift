import AppKit
import WebKit
import Darwin

// Intent: ELF-26's approved live check. Enabled only by the isolated native
// launcher AND a task-scoped consent flag. The captain signs in on OpenAI's page.
// This observer never reads a credential, sign-in URL, account identity or browser.
extension PipNativeProbe {
    static let chatGPTRequest = "read https://developers.openai.com/siwc/token-sharing-open-source using read_public_url then write a short editable draft explaining one eligibility rule for locally hosted apps cite the page and name your model"

    func receiveChatGPT(_ object: [String: Any]) {
        guard ProcessInfo.processInfo.environment["PIP_CHATGPT_LIVE_ALLOWED"] == "1" else { fail("ChatGPT live consent flag is missing"); return }
        if let data = try? JSONSerialization.data(withJSONObject: ["stage":stage,"kind":object["kind"] as? String ?? "unknown"]) { try? data.write(to: URL(fileURLWithPath: directory + "/chatgpt-stage.json")) }
        if ["error","disconnected"].contains(object["kind"] as? String ?? "") { fail("Pip could not complete the ChatGPT check"); return }
        guard object["kind"] as? String == "state", let payload = object["payload"] as? [String: Any],
              let providerView = payload["providers"] as? [String: Any],
              let providers = providerView["providers"] as? [[String: Any]], let provider = providers.first(where: { $0["id"] as? String == "openai" }),
              let state = payload["state"] as? [String: Any] else { return }
        if stage == "ready" {
            // Keep only this isolated app and its own service at the reserved low priority.
            setpriority(PRIO_PROCESS, 0, 19)
            if let child = host.child { setpriority(PRIO_PROCESS, UInt32(child.processIdentifier), 19) }
            facts["chatGPTProbeNice"] = getpriority(PRIO_PROCESS, 0)
            stage = "opening ChatGPT settings"
            let timeout = DispatchWorkItem { [weak self] in self?.fail("ChatGPT sign-in or live check exceeded its deadline") }
            overallDeadline = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 600, execute: timeout)
            if scenario == "chatgpt-draft" {
                // Provider proof is not another native-keyboard test. Reuse the
                // service-owned connection without reading it or taking key focus.
                guard provider["connected"] as? Bool == true, provider["allowed"] as? Bool == true,
                      provider["active"] as? Bool == true,
                      providerView["backup"] == nil || providerView["backup"] is NSNull,
                      let memories = state["memory"] as? [[String: Any]], memories.isEmpty,
                      let works = state["works"] as? [[String: Any]], works.isEmpty else {
                    fail("This isolated profile is not an empty, allowed ChatGPT connection. No request was sent or repeated."); return
                }
                facts["chatGPTConnectedInPip"] = true
                facts["typingMethod"] = "Not exercised; request uses the app-owned private service pipe"
                stage = "waiting for ChatGPT draft"
                host.panel.orderFrontRegardless()
                facts["draftWindowDidNotTakeKey"] = !host.panel.isKeyWindow
                guard !host.panel.isKeyWindow else { fail("Provider proof unexpectedly took keyboard focus. No request was sent."); return }
                host.deliver(["kind":"summon", "payload":[:]])
                facts["chatGPTPrivateSubmitUsed"] = true
                host.send("submit", ["request":Self.chatGPTRequest], id:"chatgpt-native-provider-proof")
                return
            }
            host.settings()
            chatGPTScript("document.querySelector('[data-provider=openai] button').click(); return document.querySelector('#result').innerText.includes('Let Pip send requests to ChatGPT plan?')") {
                self.snapshot("chatgpt-native-allow") {
                    self.stage = "waiting for ChatGPT Allow"
                    self.chatGPTScript("[...document.querySelectorAll('#result button')].find(b=>b.textContent==='Allow ChatGPT plan').click(); return true") {}
                }
            }
            return
        }
        if stage == "waiting for ChatGPT Allow", provider["allowed"] as? Bool == true {
            stage = "waiting for captain to start ChatGPT sign-in"
            // The captain, not the probe, presses Continue with ChatGPT in Pip.
            chatGPTScript("const row=document.querySelector('[data-provider=openai]'); row.scrollIntoView({block:'center'}); return !!row") {
                let marker = ["waitingForCaptainSignInClick": true, "isolatedProfile": true]
                if let data = try? JSONSerialization.data(withJSONObject: marker) { try? data.write(to: URL(fileURLWithPath: self.directory + "/chatgpt-ready.json")) }
            }
            return
        }
        if stage == "waiting for captain to start ChatGPT sign-in", provider["signingIn"] as? Bool == true || provider["connected"] as? Bool == true {
            stage = "waiting for ChatGPT sign-in"
            let marker = ["waitingForCaptainSignIn": true, "isolatedProfile": true]
            if let data = try? JSONSerialization.data(withJSONObject: marker) { try? data.write(to: URL(fileURLWithPath: directory + "/chatgpt-waiting.json")) }
        }
        if stage == "waiting for ChatGPT sign-in", provider["signingIn"] as? Bool == false, provider["connected"] as? Bool == false,
           let message = provider["message"] as? String, !message.isEmpty {
            facts["chatGPTSignInMessage"] = message
            fail(message); return
        }
        if stage == "waiting for ChatGPT sign-in", provider["connected"] as? Bool == true {
            facts["chatGPTConnectedInPip"] = true; stage = "selecting ChatGPT"
            host.settings()
            chatGPTScript("[...document.querySelectorAll('[data-provider=openai] button')].find(b=>b.textContent==='Use ChatGPT plan').click(); return true") {}
            return
        }
        if stage == "selecting ChatGPT", provider["active"] as? Bool == true {
            // End human sign-in before any automation starts. The separate draft
            // phase never logs in, injects keys or replays an existing request.
            stage = "ChatGPT sign-in complete"
            facts["chatGPTSignInComplete"] = true
            facts["typingMethod"] = "Not exercised; sign-in is completed by the captain"
            snapshot("chatgpt-native-connected") { self.finish() }
            return
        }
        if stage == "waiting for ChatGPT draft", let works = state["works"] as? [[String: Any]], let work = works.last(where: { $0["request"] as? String == Self.chatGPTRequest }) {
            if work["status"] as? String == "Could not finish" { facts["chatGPTFailure"] = work["error"]; fail("ChatGPT did not return the live draft"); return }
            guard work["status"] as? String == "Done" else { return }
            guard let result = work["result"] as? [String: Any], result["kind"] as? String == "draft",
                  let model = result["model"] as? String, model.contains("via ChatGPT plan"),
                  let sources = result["sources"] as? [[String: Any]], sources.contains(where: { ($0["url"] as? String)?.hasPrefix("https://developers.openai.com/siwc/") == true }),
                  let draft = result["text"] as? String, !draft.isEmpty else { fail("ChatGPT completed without the requested editable, sourced draft"); return }
            stage = "checking ChatGPT draft"
            host.web.callAsyncJavaScript("return document.querySelector('#result .draft')?.value === expected", arguments: ["expected": draft], in: nil, in: .page) { [weak self] observed in
                guard let self, case .success(let match) = observed, match as? Bool == true else { self?.fail("ChatGPT draft was not editable in Pip"); return }
                self.facts["chatGPTLiveDraftVisible"] = true; self.facts["chatGPTOpenedSourceCited"] = true
                let proof: [String: Any] = ["model": model, "draft": draft, "sources": sources, "editableDraftMatched": true]
                if let data = try? JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: self.directory + "/chatgpt-live-draft.json")) }
                self.chatGPTScript("""
                    return await new Promise(resolve=>{
                      const surface=document.querySelector('#surface');
                      if(surface.dataset.motion==='still'){resolve(true);return;}
                      const observer=new MutationObserver(()=>{if(surface.dataset.motion==='still'){observer.disconnect();resolve(true);}});
                      observer.observe(surface,{attributes:true,attributeFilter:['data-motion']});
                    });
                    """) { self.captureGeneratedDraft() }
            }
        }
    }
    func chatGPTScript(_ script: String, then completion: @escaping () -> Void) {
        host.web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard self != nil, case .success(let ok) = result, ok as? Bool == true else { self?.fail("The ChatGPT native control was not ready"); return }
            completion()
        }
    }
}
