import AppKit
import WebKit
import Darwin

/// Observation-only application boundary for the second bounded origin experiment.
/// It neither changes event contents nor suppresses, redirects or repeats an event.
final class PipOriginApplication: NSApplication {
    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown || event.type == .keyUp,
           let host = delegate as? Pip, let probe = host.nativeProbe, probe.metadataOnly {
            probe.recordOrigin(event, at: "application-dispatch")
        }
        super.sendEvent(event)
    }
}

/// An isolated, event-driven acceptance journey, never enabled in a normal profile.
/// Uses native key events through this app's own event queue, not DOM value writes,
/// global event injection, Accessibility access or another app's contents.
final class PipNativeProbe {
    unowned let host: Pip
    let directory: String
    let startedAt = ProcessInfo.processInfo.systemUptime
    var facts: [String: Any] = [:]
    var trace: [[String: Any]] = []
    var eventOrigins: [[String: Any]] = []
    let metadataOnly = ProcessInfo.processInfo.environment["PIP_PROBE_METADATA_ONLY"] == "1"
    var stage = "ready"
    var observers: [(NotificationCenter, NSObjectProtocol)] = []
    var deadline: DispatchWorkItem?
    var overallDeadline: DispatchWorkItem?
    var waitingInput: String?
    var inputContinuation: (() -> Void)?
    var inputEvents = 0
    let fixtureEventMarker: Int64 = 0x50697031
    var deliveredFixtureKeys = 0
    let scenario = ProcessInfo.processInfo.environment["PIP_PROBE_SCENARIO"] ?? "focus"
    var firstText: String { scenario == "live-writing" ? "write a warmer version of can you send the notes" : scenario == "live-followup" ? "make it" : "pip focus check" }
    var suffix: String { scenario == "live-writing" ? " today in one sentence" : scenario == "live-followup" ? " shorter" : " again" }
    var isLiveWriting: Bool { scenario == "live-writing" || scenario == "live-followup" }
    var fullScreenFixture: NSWindow?
    var exitingFixture = false
    var trackerFeedbackID: String?
    var trackerBaselineWorkCount = 0
    var artObservationComplete = false
    var artJourneyComplete = false
    var artObservers: [NSObjectProtocol] = []
    var isArtRun: Bool { scenario == "art" || scenario == "art-diagnostic" }

    init(host: Pip, directory: String) {
        self.host = host; self.directory = directory
        facts = ["hotkeyRegistered": host.hotkey != nil, "panelCanBecomeKey": host.panel.canBecomeKey,
                 "panelIsKey": false, "allSpaces": host.panel.collectionBehavior.contains(.canJoinAllSpaces),
                 "fullScreenAuxiliary": host.panel.collectionBehavior.contains(.fullScreenAuxiliary),
                 "physicalHotkeyTested": false, "typingMethod": "AppKit keyDown/keyUp events through Pip's own event queue"]
        let pid = ["pid": ProcessInfo.processInfo.processIdentifier]
        if let data = try? JSONSerialization.data(withJSONObject: pid) { try? data.write(to: URL(fileURLWithPath: directory + "/native-probe-process.json")) }
        // ELF-8 native integration: observation only, never a substitute for key/input checks.
        host.web.callAsyncJavaScript("return {receiver:typeof window.pipReceive,tracker:!!customElements.get('pip-tracker'),errors:window.__pipLoadErrors||[]}",arguments:[:],in:nil,in:.page) { [weak self] result in
            guard let self, case .success(let value) = result, let observed = value as? [String:Any] else { return }
            if let data = try? JSONSerialization.data(withJSONObject:observed,options:[.prettyPrinted,.sortedKeys]) { try? data.write(to:URL(fileURLWithPath:self.directory + "/native-readiness.json")) }
            if observed["receiver"] as? String != "function" { self.fail("The bundled renderer did not initialize") }
        }
    }
    func record(_ event: String) {
        trace.append(["event": event, "seconds": ProcessInfo.processInfo.systemUptime - startedAt,
                      "panelIsKey": host.panel.isKeyWindow, "visible": host.panel.isVisible,
                      "appActive": NSApp.isActive])
    }
    /// Intentionally excludes characters, keycodes, Unicode and modifier flags.
    func recordOrigin(_ event: NSEvent, at boundary: String) {
        let backing = event.cgEvent
        eventOrigins.append([
            "boundary": boundary, "stage": stage,
            "eventType": event.type == .keyDown ? "keyDown" : event.type == .keyUp ? "keyUp" : "other",
            "sourceProcessID": backing?.getIntegerValueField(.eventSourceUnixProcessID) ?? -1,
            "sourceStateID": backing?.getIntegerValueField(.eventSourceStateID) ?? -999,
            "probeProcessID": ProcessInfo.processInfo.processIdentifier,
            "windowNumber": event.windowNumber, "probeWindowNumber": host.panel.windowNumber,
            "timestamp": event.timestamp,
            "tagPresent": backing?.getIntegerValueField(.eventSourceUserData) == fixtureEventMarker
        ])
    }
    func clearWait() {
        deadline?.cancel(); deadline = nil
        for (center, observer) in observers { center.removeObserver(observer) }
        observers.removeAll()
    }
    func fail(_ reason: String) {
        guard stage != "finished" else { return }
        facts["failure"] = reason; record("failed: " + reason); finish()
    }
    /// Register before the action so a synchronous key event is not missed. The only
    /// timer is a failure deadline; no timer, polling, retry or page callback grants focus.
    func awaitNative(_ label: String, names: [Notification.Name], window: NSWindow? = nil,
                     requiredEvent: Notification.Name? = nil, condition: @escaping () -> Bool,
                     action: () -> Void, then completion: @escaping () -> Void) {
        clearWait(); stage = label
        var observedRequiredEvent = requiredEvent == nil
        let check: () -> Void = { [weak self] in
            guard let self, self.stage == label, observedRequiredEvent, condition() else { return }
            self.clearWait(); self.stage = label + " complete"; self.record(label + " satisfied")
            DispatchQueue.main.async { completion() }
        }
        for name in names {
            let workspaceEvent = name == NSWorkspace.activeSpaceDidChangeNotification
            let applicationEvent = name == NSApplication.didResignActiveNotification || name == NSApplication.didBecomeActiveNotification
            let center = workspaceEvent ? NSWorkspace.shared.notificationCenter : NotificationCenter.default
            let object: AnyObject? = workspaceEvent ? nil : applicationEvent ? NSApp : (window ?? host.panel)
            let observer = center.addObserver(forName: name, object: object, queue: .main) { [weak self] notification in
                self?.record(notification.name.rawValue)
                if notification.name == requiredEvent { observedRequiredEvent = true }
                // AppKit can post the notification before its getters reflect the new
                // key/activation state. Sample once after that native delivery unwinds.
                DispatchQueue.main.async { check() }
            }
            observers.append((center, observer))
        }
        let timeout = DispatchWorkItem { [weak self] in self?.recordOwnedContext(); self?.fail(label + " timed out waiting for native window state") }
        deadline = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)
        record(label + " armed"); action(); check()
    }
    func receive(_ object: [String: Any]) {
        guard let kind = object["kind"] as? String else { return }
        if scenario == "chatgpt" || scenario == "chatgpt-draft" { receiveChatGPT(object); return }
        if kind == "disconnected" || kind == "error" { fail("Local service failed during native journey"); return }
        if scenario == "tracker", kind == "feedbackSaved", stage == "waiting for feedback receipt", let payload = object["payload"] as? [String:Any], payload["status"] as? String == "Backlog", let id = payload["id"] as? String {
            trackerFeedbackID = id; stage = "waiting for feedback state"; return
        }
        if scenario == "tracker", kind == "nativeStatus", stage == "waiting for shortcut setting", let payload = object["payload"] as? [String:Any], payload["letter"] as? String == "j" {
            facts["shortcutSettingApplied"] = true
            facts["shortcutConflictReported"] = payload["registered"] as? Bool == false
            facts["shortcutStatus"] = payload["hotkey"]
            clearWait(); snapshot("native-tracker") { self.finish() }; return
        }
        guard kind == "state", let payload = object["payload"] as? [String: Any],
              let state = payload["state"] as? [String: Any] else { return }
        if stage == "ready" { begin(); return }
        if scenario == "tracker", stage == "waiting for feedback state", let records = state["feedback"] as? [[String:Any]], let record = records.first(where: { $0["id"] as? String == trackerFeedbackID }) {
            guard record["originalWords"] as? String == "pip opens on the wrong display", record["status"] as? String == "Backlog", record["kind"] as? String == "bug", (state["works"] as? [[String:Any]])?.count == trackerBaselineWorkCount else { fail("Feedback lost its words or started unrequested work"); return }
            facts["feedbackSavedToBacklog"] = true; facts["feedbackDidNotStartWork"] = true
            clearWait(); stage = "waiting for tracker records"; armTrackerDeadline("Tracker records were not returned")
            host.web.callAsyncJavaScript("""
                document.querySelector('#more').click();document.querySelector('#menu [data-item=tracker]').click();
                const tracker=document.querySelector('pip-tracker');
                const rendered=new Promise(resolve=>{
                  const accept=event=>{if(event.detail.view==='about'&&event.detail.ids.includes(recordID)){tracker.removeEventListener('tracker-rendered',accept);resolve(true);}};
                  tracker.addEventListener('tracker-rendered',accept);
                });
                tracker.shadowRoot.querySelector('#about').click();
                return await rendered;
                """,arguments:["recordID":trackerFeedbackID ?? ""],in:nil,in:.page) { [weak self] result in
                guard let self,self.stage == "waiting for tracker records" else { return }
                guard case .success(let ready) = result,ready as? Bool == true else { self.fail("Could not observe the accepted tracker render");return }
                self.inspectTrackerRecord()
            }; return
        }
        if stage == "waiting for saved request", let works = state["works"] as? [[String: Any]],
           let work = works.last(where: { $0["request"] as? String == firstText + suffix }),
           ["Done", "Could not finish"].contains(work["status"] as? String ?? "") {
            stage = "capturing saved request"
            facts["nativeReturnSubmitted"] = true
            facts["nativeInputEventCount"] = inputEvents
            record("native Return request committed")
            if isLiveWriting { inspectLiveDraft(work) }
            else {
                // ELF-30: a fresh profile stops at the provider's Allow boundary,
                // before any model is asked. Observe the
                // actual rendered refusal as well as the persisted service error.
                let refusal = work["error"] as? String ?? ""
                host.web.callAsyncJavaScript("return document.querySelector('#cv').textContent.includes(refusal)", arguments: ["refusal": refusal], in: nil, in: .page) { [weak self] result in
                    guard let self else { return }
                    self.facts["providerNotAllowedVisible"] = refusal.contains("not allowed yet") && refusal.contains("Nothing was sent.") && (try? result.get() as? Bool) == true
                    self.snapshot("native-after-submit") {
                        if self.scenario == "tracker" { self.beginTrackerCheck(workCount:(state["works"] as? [[String:Any]])?.count ?? 0) }
                        else { self.finish() }
                    }
                }
            }
        }
    }
    func begin() {
        let timeout = DispatchWorkItem { [weak self] in self?.fail("Native journey exceeded its overall deadline") }
        overallDeadline = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: timeout)
        if scenario == "owned-fullscreen" { enterOwnedFullScreen { self.beginFocusJourney() } }
        else { beginFocusJourney() }
    }
    func enterOwnedFullScreen(_ completion: @escaping () -> Void) {
        let fixture = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 420), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        fixture.title = "Pip owned full-screen fixture"; fixture.isReleasedWhenClosed = false
        fixture.collectionBehavior = [.fullScreenPrimary]
        let label = NSTextField(labelWithString: "Isolated Pip check. No real document is open.")
        label.frame = NSRect(x: 30, y: 160, width: 560, height: 50); fixture.contentView?.addSubview(label)
        fullScreenFixture = fixture
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main!
        let frame = screen.visibleFrame
        fixture.setFrameOrigin(NSPoint(x: frame.midX - fixture.frame.width / 2, y: frame.midY - fixture.frame.height / 2))
        NSApp.activate(ignoringOtherApps: true); fixture.makeKeyAndOrderFront(nil)
        // ELF-13 / A1: the fullScreen style flag and active Space can change during
        // entry, before AppKit finishes the transition and accepts keyboard input.
        // Require did-enter, not just those early getters, before summoning Pip.
        awaitNative("owned fixture full-screen entry", names: [NSWindow.didEnterFullScreenNotification, NSWorkspace.activeSpaceDidChangeNotification, NSWindow.didChangeScreenNotification], window: fixture,
                    requiredEvent: NSWindow.didEnterFullScreenNotification,
                    condition: { fixture.styleMask.contains(.fullScreen) && fixture.isOnActiveSpace }, action: { fixture.toggleFullScreen(nil) }) {
            self.facts["ownedFullScreenEntered"] = true; completion()
        }
    }
    var focusEvents: [Notification.Name] {
        var names = [NSWindow.didBecomeKeyNotification, NSApplication.didBecomeActiveNotification]
        if fullScreenFixture != nil { names += [NSWorkspace.activeSpaceDidChangeNotification, NSWindow.didChangeScreenNotification] }
        return names
    }
    func sameOwnedDisplay() -> Bool {
        guard let fixture = fullScreenFixture,
              let first = fixture.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              let second = host.panel.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return false }
        return first.uint32Value == second.uint32Value
    }
    func recordOwnedContext() {
        guard let fixture = fullScreenFixture else { return }
        facts["ownedFixtureStillFullScreen"] = fixture.styleMask.contains(.fullScreen)
        facts["ownedFixtureOnActiveSpace"] = fixture.isOnActiveSpace
        facts["panelObservedOnActiveSpace"] = host.panel.isOnActiveSpace
        facts["ownedFixtureSameDisplay"] = sameOwnedDisplay()
        facts["observedPanelKey"] = host.panel.isKeyWindow
    }
    func nativePanelReady() -> Bool {
        guard host.panel.isKeyWindow && host.panel.isVisible else { return false }
        guard let fixture = fullScreenFixture else { return true }
        return fixture.styleMask.contains(.fullScreen) && fixture.isOnActiveSpace && host.panel.isOnActiveSpace && sameOwnedDisplay()
    }
    func beginFocusJourney() {
        awaitNative("initial summon", names: focusEvents,
                    condition: { self.nativePanelReady() }, action: { self.host.summon() }) {
            // Keep the actual native assertion; DOM focus is an additional, separate fact.
            self.facts["panelIsKey"] = self.host.panel.isKeyWindow
            if let fixture = self.fullScreenFixture {
                self.recordOwnedContext()
                self.facts["panelOnOwnedFullScreenSpace"] = fixture.styleMask.contains(.fullScreen) && fixture.isOnActiveSpace && self.host.panel.isOnActiveSpace && self.sameOwnedDisplay()
                guard self.facts["panelOnOwnedFullScreenSpace"] as? Bool == true else { self.fail("Pip is not on the owned fixture's full-screen Space"); return }
            }
            self.inspectComposer { value, focused in
                self.facts["composerFocused"] = focused
                guard value.isEmpty, focused, self.host.panel.isKeyWindow else { self.fail("Initial native keyboard target is not ready"); return }
                self.type(self.firstText, expecting: self.firstText) {
                    self.facts["typedInitially"] = true
                    self.snapshot("native-typed") { self.hideAndResummon() }
                }
            }
        }
    }
    func inspectComposer(_ completion: @escaping (String, Bool) -> Void) {
        host.web.callAsyncJavaScript("const c=document.querySelector('#composer'); return {value:c.value, focused:document.activeElement===c}", arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            guard case .success(let value) = result, let fields = value as? [String: Any], let text = fields["value"] as? String, let focused = fields["focused"] as? Bool else { self.fail("Could not inspect native keyboard result"); return }
            completion(text, focused)
        }
    }
    func type(_ text: String, expecting: String, then completion: @escaping () -> Void) {
        guard host.panel.isKeyWindow, NSApp.keyWindow === host.panel else { fail("Typing attempted without a native key window"); return }
        if let responder = host.panel.firstResponder {
            facts["nativeResponderClass"] = String(describing: Swift.type(of: responder))
            if let view = responder as? NSView { facts["nativeResponderInWebKit"] = view === host.web || view.isDescendant(of: host.web) }
            else { facts["nativeResponderInWebKit"] = false }
        }
        stage = "waiting for native input"; waitingInput = expecting; inputContinuation = completion
        let timeout = DispatchWorkItem { [weak self] in self?.fail("Native typing did not reach the composer") }
        deadline = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)
        record("posting native text keys")
        for character in text { postKey(String(character)) }
    }
    func composerChanged(_ value: String) {
        guard stage == "waiting for native input" else { return }
        inputEvents += 1
        guard value == waitingInput else { return }
        guard host.panel.isKeyWindow else { fail("Composer changed without the required native key state"); return }
        clearWait(); waitingInput = nil
        let completion = inputContinuation; inputContinuation = nil; stage = "native input received"
        record("native text reached input handler")
        completion?()
    }
    func keyWillDispatch(_ event: NSEvent) {
        guard stage != "finished" else { return }
        recordOrigin(event, at: "local-dispatch")
        // AppKit may copy NSEvent objects while dequeuing; use event metadata,
        // not object identity, to recognize this probe's own native fixture events.
        if event.cgEvent?.getIntegerValueField(.eventSourceUserData) == fixtureEventMarker {
            deliveredFixtureKeys += 1
        } else {
            // Do not record the person's key or allow their input into fixture state.
            facts["nonFixtureKeyObserved"] = true
            fail("Non-fixture keyboard input interrupted the isolated native journey")
        }
    }
    func postKey(_ characters: String) {
        let codes: [String: UInt16] = ["a":0,"b":11,"c":8,"d":2,"e":14,"f":3,"g":5,"h":4,"i":34,"j":38,"k":40,"l":37,"m":46,"n":45,"o":31,"p":35,"q":12,"r":15,"s":1,"t":17,"u":32,"v":9,"w":13,"x":7,"y":16,"z":6," ":49,"\r":36,"\u{1b}":53]
        guard let code = codes[characters] else { fail("Unsupported fixture key"); return }
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                              windowNumber: host.panel.windowNumber, context: nil, characters: characters,
                                              charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) else { fail("Could not construct native fixture key"); return }
            guard let backing = event.cgEvent else { fail("Native fixture event metadata is unavailable"); return }
            backing.setIntegerValueField(.eventSourceUserData, value: fixtureEventMarker)
            guard let tagged = NSEvent(cgEvent: backing) else { fail("Native fixture event could not be tagged"); return }
            recordOrigin(tagged, at: "queued-fixture")
            NSApp.postEvent(tagged, atStart: false)
        }
    }
    func hideAndResummon() {
        let returnsToOtherApp = host.previous?.processIdentifier != ProcessInfo.processInfo.processIdentifier
        awaitNative("Escape hide", names: [NSWindow.didResignKeyNotification, NSApplication.didResignActiveNotification], condition: {
            !self.host.panel.isVisible && !self.host.panel.isKeyWindow && (!returnsToOtherApp || !NSApp.isActive)
        }, action: { self.postKey("\u{1b}") }) {
            self.facts["hideWorked"] = !self.host.panel.isVisible
            self.facts["nativeEscapeHide"] = true
            self.awaitNative("resummon", names: self.focusEvents,
                             condition: { self.nativePanelReady() }, action: { self.host.toggle() }) {
                self.facts["resummonPanelIsKey"] = self.host.panel.isKeyWindow
                if let fixture = self.fullScreenFixture {
                    self.recordOwnedContext()
                    self.facts["resummonOnOwnedFullScreenSpace"] = fixture.styleMask.contains(.fullScreen) && fixture.isOnActiveSpace && self.host.panel.isOnActiveSpace && self.sameOwnedDisplay()
                    guard self.facts["resummonOnOwnedFullScreenSpace"] as? Bool == true else { self.fail("Resummon left the owned full-screen Space"); return }
                }
                self.inspectComposer { value, focused in
                    self.facts["draftSurvivedHide"] = value == self.firstText
                    self.facts["resummonComposerFocused"] = focused
                    self.facts["retainedDraftCharacterCount"] = value.count
                    guard value == self.firstText, focused else { self.fail("Draft or typing focus did not survive hide/resummon"); return }
                    self.type(self.suffix, expecting: self.firstText + self.suffix) {
                        self.facts["typedAfterResummon"] = true
                        self.snapshot("native-resummoned") {
                            self.stage = "waiting for saved request"; self.record("posting native Return")
                            self.postKey("\r")
                        }
                    }
                }
            }
        }
    }
    func armTrackerDeadline(_ reason:String) {
        let timeout = DispatchWorkItem { [weak self] in self?.fail(reason) }
        deadline = timeout; DispatchQueue.main.asyncAfter(deadline:.now()+5,execute:timeout)
    }
    /// ELF-8: use real tagged AppKit keys for Feedback text; never assign a DOM value.
    func typeFeedbackField(_ selector:String,text:String,then completion:@escaping ()->Void) {
        guard host.panel.isKeyWindow else { fail("Feedback typing lost the native key window"); return }
        host.web.callAsyncJavaScript("""
            const field=document.querySelector('pip-feedback').shadowRoot.querySelector(selector);
            field.focus();window.__pipFixtureInput=new Promise(resolve=>{const observe=()=>{if(field.value===expected){field.removeEventListener('input',observe);resolve(true);}};field.addEventListener('input',observe);});return true;
            """,arguments:["selector":selector,"expected":text],in:nil,in:.page) { [weak self] result in
            guard let self else { return }
            guard case .success = result else { self.fail("Could not focus the Feedback field"); return }
            self.armTrackerDeadline("Native keys did not reach Feedback")
            self.host.web.callAsyncJavaScript("return await window.__pipFixtureInput",arguments:[:],in:nil,in:.page) { [weak self] result in
                guard let self else { return };self.clearWait()
                guard case .success(let value) = result,value as? Bool == true else { self.fail("Feedback input was not observed");return }
                completion()
            }
            for character in text { self.postKey(String(character)) }
        }
    }
    func beginTrackerCheck(workCount:Int) {
        trackerBaselineWorkCount = workCount;stage = "opening feedback"
        host.web.callAsyncJavaScript("document.querySelector('#more').click();document.querySelector('#menu [data-item=feedback]').click();document.querySelector('pip-feedback').shadowRoot.querySelector('[name=kind]').value='bug';return true",arguments:[:],in:nil,in:.page) { [weak self] result in
            guard let self else { return };guard case .success = result else { self.fail("Could not open Feedback");return }
            self.typeFeedbackField("[name=originalWords]",text:"pip opens on the wrong display") {
                self.typeFeedbackField("[name=title]",text:"wrong display") {
                    self.stage = "waiting for feedback receipt";self.armTrackerDeadline("Local Feedback receipt was not returned")
                    self.host.web.callAsyncJavaScript("document.querySelector('pip-feedback').shadowRoot.querySelector('[type=submit]').click();return true",arguments:[:],in:nil,in:.page) { [weak self] result in
                        if case .failure = result { self?.fail("Feedback Save failed") }
                    }
                }
            }
        }
    }
    func inspectTrackerRecord() {
        stage = "inspecting tracker record";clearWait()
        host.web.callAsyncJavaScript("""
            const tracker=document.querySelector('pip-tracker');const button=[...tracker.shadowRoot.querySelectorAll('#records button')].find(b=>b.textContent==='Backlog · wrong display');if(!button)return false;button.click();const detail=tracker.shadowRoot.querySelector('#detail');detail.scrollIntoView({block:'end'});return detail.innerText.includes('pip opens on the wrong display')&&detail.innerText.includes('Backlog');
            """,arguments:[:],in:nil,in:.page) { [weak self] result in
            guard let self else { return }
            guard case .success(let value) = result,value as? Bool == true else { self.fail("The actual tracker did not show the saved Feedback");return }
            self.facts["trackerFoundSavedFeedback"] = true
            self.snapshot("native-feedback-detail") {
                self.stage = "waiting for shortcut setting";self.armTrackerDeadline("Native shortcut setting was not acknowledged")
                self.host.web.callAsyncJavaScript("document.querySelector('#more').click();document.querySelector('#menu [data-item=settings]').click();document.querySelector('#shortcutKey').value='j';[...document.querySelectorAll('#result button')].find(b=>b.textContent==='Set shortcut').click();return true",arguments:[:],in:nil,in:.page) { [weak self] result in
                    if case .failure = result { self?.fail("The shortcut control did not dispatch") }
                }
            }
        }
    }
    func inspectLiveDraft(_ work: [String: Any]) {
        guard let result = work["result"] as? [String: Any], result["kind"] as? String == "draft",
              let draft = result["text"] as? String, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let model = result["model"] as? String, !model.isEmpty,
              let session = result["sessionId"] as? String, session == work["sessionId"] as? String else {
            fail("The live model did not return an identified editable draft"); return
        }
        if scenario == "live-followup" {
            guard let context = work["context"] as? [String: Any], let parent = context["workId"] as? String else { fail("Live follow-up lost the selected-result context"); return }
            facts["selectedContextWorkId"] = parent; facts["selectedContextPreserved"] = true
        }
        host.web.callAsyncJavaScript("const d=document.querySelector('.draft'); return {text:d?.value, notSent:document.querySelector('.pt-draft .ph').innerText.includes('Not sent')}", arguments: [:], in: nil, in: .page) { [weak self] response in
            guard let self else { return }
            guard case .success(let value) = response, let fields = value as? [String: Any], fields["text"] as? String == draft, fields["notSent"] as? Bool == true else { self.fail("The live draft was not rendered with its not-sent status"); return }
            self.facts["liveDraftVisible"] = true; self.facts["preCallIdentityMatched"] = true
            let proof: [String: Any] = ["workId": work["id"] ?? "", "sessionId": session, "model": model, "draft": draft, "threadId": work["threadId"] ?? "", "contextWorkId": self.facts["selectedContextWorkId"] ?? NSNull(), "renderedDraftMatches": true, "notSent": true]
            if let data = try? JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: self.directory + "/native-live-draft.json")) }
            self.captureGeneratedDraft()
        }
    }
    func captureGeneratedDraft() {
        // Only generated output is pictured, not the composer or event/key contents.
        host.web.callAsyncJavaScript("const d=document.querySelector('.draft'); d.scrollIntoView({block:'center'}); const r=d.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}", arguments: [:], in: nil, in: .page) { [weak self] response in
            guard let self else { return }
            guard case .success(let value) = response, let fields = value as? [String: Double], let x = fields["x"], let y = fields["y"], let width = fields["width"], let height = fields["height"] else { self.fail("Could not measure the generated draft view"); return }
            let rect = NSRect(x: x, y: y, width: width, height: height)
            guard self.host.web.bounds.contains(rect) else { self.fail("The generated draft view is not fully visible for evidence"); return }
            let config = WKSnapshotConfiguration(); config.rect = rect
            self.host.web.takeSnapshot(with: config) { image, _ in
                guard let data = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: data), let png = rep.representation(using: .png, properties: [:]) else { self.fail("Generated draft picture failed"); return }
                do { try png.write(to: URL(fileURLWithPath: self.directory + "/native-generated-draft.png")); self.facts["generatedDraftPictureSaved"] = true }
                catch { self.fail("Generated draft picture could not be saved"); return }
                self.finish()
            }
        }
    }
    func snapshot(_ name: String, then completion: @escaping () -> Void) {
        host.web.takeSnapshot(with: nil) { [weak self] image, _ in
            guard let self else { return }
            if self.metadataOnly {
                guard image != nil else { self.fail("Native snapshot failed"); return }
                completion(); return
            }
            guard let data = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: data), let png = rep.representation(using: .png, properties: [:]) else { self.fail("Native snapshot failed"); return }
            do { try png.write(to: URL(fileURLWithPath: self.directory + "/" + name + ".png")) }
            catch { self.fail("Native snapshot could not be saved"); return }
            completion()
        }
    }
    // ELF-14: observe the real app after its unchanged native-input journey.
    // Frame sampling is bounded probe work, not an idle animation or a focus grant.
    func observeNativeArt() {
        record("native art observer started");facts["nativeArtPhase"]="observer-started"
        for name in [NSWindow.didBecomeKeyNotification,NSWindow.didResignKeyNotification,NSApplication.didBecomeActiveNotification,NSApplication.didResignActiveNotification] {
            artObservers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main) { [weak self] event in
                guard let self else { return };self.record("art: " + event.name.rawValue)
                if self.facts["nativeArtPhase"] as? String == "sampling-requested",
                   event.name == NSApplication.didResignActiveNotification || (event.name == NSWindow.didResignKeyNotification && event.object as? NSWindow === self.host.panel) {
                    self.fail("Native artwork observation lost its visible key window; stopped without retry")
                }
            })
        }
        if scenario == "art-diagnostic" {
            let script = "const c=document.getElementById('character');return {assetsReady:c?.assetsReady,artStatus:c?.dataset.artStatus,hidden:document.hidden,visibility:document.visibilityState,concealed:c?.concealed,owned:c?.animations?.size,readyType:typeof c?.ready,images:c?.svg?.querySelectorAll('image').length,slot:c?{x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y,width:c.getBoundingClientRect().width,height:c.getBoundingClientRect().height}:null}"
            host.web.callAsyncJavaScript(script,arguments:[:],in:nil,in:.page) { [weak self] result in
                guard let self,self.stage != "finished" else { return }
                self.record("native art diagnostic callback")
                if case .success(let value) = result,let data=value as? [String:Any] {
                    self.facts["nativeArtDiagnostic"] = data
                    if let encoded=try? JSONSerialization.data(withJSONObject:data,options:[.prettyPrinted,.sortedKeys]) { try? encoded.write(to:URL(fileURLWithPath:self.directory+"/native-art-diagnostic.json")) }
                } else { self.facts["nativeArtDiagnosticError"] = "The synchronous diagnostic did not return metadata" }
                self.facts["artDiagnosticOnly"] = true;self.artObservationComplete=true;self.finish()
            }
            return
        }
        let manifestURL = host.resources.appendingPathComponent("web/curious-hearth/manifest.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
              let assetSet = manifest["assetSet"] as? String,
              let parts = manifest["parts"] as? [String:[String:Any]]
        else { fail("The native art manifest is unavailable"); return }
        var expectedImages = 0, expectedBytes = 0
        for part in parts.values {
            guard let file = part["file"] as? String, let size = part["size"] as? [Int], size.count == 2 else { fail("Native artwork registration is incomplete"); return }
            if FileManager.default.fileExists(atPath:host.resources.appendingPathComponent("web/curious-hearth/" + file).path) {
                expectedImages += 1; expectedBytes += size[0] * size[1] * 4
            }
        }
        var before = rusage(); guard getrusage(RUSAGE_SELF, &before) == 0 else { fail("Native process resource observation is unavailable"); return }
        let began = ProcessInfo.processInfo.systemUptime
        // ELF-62: the heaviest arrival (Rich magic, full length) while the pointer sweeps the four screen corners, sampled frame by frame in the
        // real web view. The page draws at most one frame per display refresh, so a frame time is the gap between two frame callbacks.
        let script = """
        const c=document.getElementById('character');
        if(!c || !await c.ready) throw Error('Native character images did not decode');
        const gaps=[],poses=new Set(),states=new Set();let prior;
        const started=performance.now();
        await new Promise(resolve=>{
          function frame(now){
            if(!document.hidden){
              if(prior!==undefined)gaps.push(now-prior);
              poses.add(getComputedStyle(c.headDriver).transform);states.add(c.dataset.state);
              prior=now;
            }else prior=undefined;
            if(now-started>=2600){resolve();return;}
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        const sorted=[...gaps].sort((a,b)=>a-b),box=c.getBoundingClientRect();
        return {assetSet:c.svg.dataset.assetSet,resources:c.resourceStats,
          slot:{x:box.x,y:box.y,width:box.width,height:box.height,right:box.right,bottom:box.bottom},
          viewport:{width:innerWidth,height:innerHeight},visibleFrames:gaps.length,
          meanFrameIntervalMs:gaps.reduce((a,b)=>a+b,0)/gaps.length,
          p95FrameIntervalMs:sorted[Math.floor((sorted.length-1)*.95)],maxFrameIntervalMs:sorted[sorted.length-1],
          state:c.dataset.state,statesObserved:[...states],headPosesObserved:poses.size,
          reducedMotion:c.reduced,
          ownedAnimations:[...c.shadowRoot.getAnimations()].filter(a=>a instanceof CSSAnimation&&a.playState==='running').length,
          documentHidden:document.hidden,actorConcealed:c.concealed};
        """
        let reaction = """
        const c=document.getElementById('character'),box=document.getElementById('composer');
        window.__reaction={key:null,gap:null};
        box.addEventListener('keydown',e=>{window.__reaction.key=performance.now();window.__reaction.native=performance.now()-e.timeStamp;},{capture:true,once:true});
        new MutationObserver((list,observer)=>{if(window.__reaction.key!==null&&window.__reaction.gap===null){window.__reaction.gap=performance.now()-window.__reaction.key;observer.disconnect();}}).observe(c,{attributes:true,attributeFilter:['style']});
        return true;
        """
        let idle = """
        const c=document.getElementById('character'),before=c.frames;
        await new Promise(resolve=>setTimeout(resolve,600));
        return {keyToReactionMs:window.__reaction.gap,keyNativeToPageMs:window.__reaction.native,idleScriptFrames:c.frames-before,pointerAtRest:true};
        """
        // Start playback observation only after the unchanged keyboard journey.
        // Readiness is a real event, then use the native summon path again; never
        // manufacture a renderer state or delay initial keyboard acceptance.
        record("native art readiness requested");facts["nativeArtPhase"]="readiness-requested"
        host.web.callAsyncJavaScript("const c=document.getElementById('character');return c ? await c.ready : false",arguments:[:],in:nil,in:.page) { [weak self] readiness in
            guard let self, self.stage != "finished" else { return }
            self.record("native art readiness callback");self.facts["nativeArtPhase"]="readiness-returned"
            guard case .success(let ready) = readiness, ready as? Bool == true else { self.fail("Native character images did not decode"); return }
            self.host.magic = MagicSetting(level: MagicLevel(rawValue: ProcessInfo.processInfo.environment["PIP_PROBE_MAGIC"] ?? "rich") ?? .rich); self.host.nativeStatus()
            self.host.summon();self.record("native art resummoned for sampling");self.facts["nativeArtPhase"]="sampling-requested"
            // The same call again, saying it is not the short repeat, so the full arrival plays under the sampler.
            self.host.deliver(["kind":"summon","payload":["short":false]])
            let corners: [(Double, Double)] = [(0, 0), (755, 0), (0, 170), (755, 170)]
            var swept = 0
            let sweep = Timer(timeInterval: 0.4, repeats: true) { [weak self] timer in
                guard let self, swept < corners.count else { timer.invalidate(); return }
                self.host.deliver(["kind":"pointer","payload":["x":corners[swept].0 - (swept % 2 == 0 ? 400 : 0),"y":corners[swept].1 - 300]]); swept += 1
            }
            RunLoop.main.add(sweep, forMode: .common)
            self.host.web.callAsyncJavaScript(script,arguments:[:],in:nil,in:.page) { [weak self] result in
            guard let self, self.stage != "finished" else { return }
            sweep.invalidate()
            if case .success(let raw) = result { self.facts["nativeArtRaw"] = raw } else if case .failure(let error) = result { self.facts["nativeArtError"] = String(describing: error) }
            guard case .success(let value) = result, var observed = value as? [String:Any],
                  observed["assetSet"] as? String == assetSet,
                  let resources = observed["resources"] as? [String:Any],
                  (resources["images"] as? NSNumber)?.intValue == expectedImages,
                  (resources["decodedRgbaBytes"] as? NSNumber)?.intValue == expectedBytes,
                  let slot = observed["slot"] as? [String:Any], let viewport = observed["viewport"] as? [String:Any],
                  let width = slot["width"] as? Double, let height = slot["height"] as? Double,
                  let x = slot["x"] as? Double, let y = slot["y"] as? Double,
                  let right = slot["right"] as? Double, let bottom = slot["bottom"] as? Double,
                  let viewportWidth = viewport["width"] as? Double, let viewportHeight = viewport["height"] as? Double,
                  abs(width-150) < 0.5, abs(height-150) < 0.5, // Pip's slot in the Lantern window is 150 points
                  
                  x >= -0.5, y >= -0.5, right <= viewportWidth+0.5, bottom <= viewportHeight+0.5
            else { self.fail("Native artwork readiness, registered rasters or visible layout did not match"); return }
            guard let p95 = observed["p95FrameIntervalMs"] as? Double, let worst = observed["maxFrameIntervalMs"] as? Double,
                  ((observed["visibleFrames"] as? NSNumber)?.intValue ?? 0) >= 60 else { self.fail("Native frame times were not sampled"); return }
            self.facts["nativeFrameP95Ms"] = p95; self.facts["nativeFrameMaxMs"] = worst
            guard p95 <= 20, worst <= 50 else { self.fail("Native frame times missed the budget: p95 \(p95) ms, worst \(worst) ms"); return }
            let reduced = observed["reducedMotion"] as? Bool == true
            guard reduced || ((observed["headPosesObserved"] as? NSNumber)?.intValue ?? 0) > 1 else { self.fail("Native pointer following was not observed"); return }
            // A key pressed in the message box, then the pointer leaves the screen and Pip settles; with nothing moving he asks for no script frames.
            self.host.web.callAsyncJavaScript(reaction,arguments:[:],in:nil,in:.page) { [weak self] armed in
            guard let self, self.stage != "finished" else { return }
            guard case .success = armed else { self.fail("Native key reaction could not be armed"); return }
            self.postKey("a")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                guard let self, self.stage != "finished" else { return }
                self.host.deliver(["kind":"pointer","payload":["off":true]])
                DispatchQueue.main.asyncAfter(deadline: .now() + 4.5) { [weak self] in
                guard let self, self.stage != "finished" else { return }
                self.host.web.callAsyncJavaScript(idle,arguments:[:],in:nil,in:.page) { [weak self] measured in
                guard let self, self.stage != "finished" else { return }
                guard case .success(let measuredValue) = measured, let rest = measuredValue as? [String:Any],
                      let reaction = rest["keyToReactionMs"] as? Double, let frames = (rest["idleScriptFrames"] as? NSNumber)?.intValue
                else { self.fail("Native key reaction was not observed"); return }
                self.facts["nativeKeyToReactionMs"] = reaction; self.facts["nativeKeyNativeToPageMs"] = rest["keyNativeToPageMs"] ?? NSNull(); self.facts["nativeIdleScriptFrames"] = frames
                guard reaction < 50 else { self.fail("Native key-to-reaction was \(reaction) ms"); return }
                guard frames == 0 || reduced else { self.fail("Pip waiting with the pointer still asked for \(frames) script frames"); return }
            var after = rusage(); guard getrusage(RUSAGE_SELF, &after) == 0 else { self.fail("Native process resource observation failed"); return }
            func cpu(_ usage:rusage)->Double { Double(usage.ru_utime.tv_sec)+Double(usage.ru_utime.tv_usec)/1_000_000+Double(usage.ru_stime.tv_sec)+Double(usage.ru_stime.tv_usec)/1_000_000 }
            observed["nativeProcessCpuSeconds"] = cpu(after)-cpu(before)
            observed["nativeProcessPeakResidentBytes"] = after.ru_maxrss
            observed["observedElapsedSeconds"] = ProcessInfo.processInfo.systemUptime-began
            observed["resourceLimits"] = "Native process CPU/peak resident only; excludes WebKit/Node/GPU totals. Frame sampler adds temporary probe work."
            if let screen = self.host.panel.screen { observed["nativeRightInsetPoints"] = screen.visibleFrame.maxX-self.host.panel.frame.maxX }
            self.facts["nativeArt"] = observed; self.facts["nativeArtObserved"] = true; self.artObservationComplete = true
            if let data = try? JSONSerialization.data(withJSONObject:observed,options:[.prettyPrinted,.sortedKeys]) { try? data.write(to:URL(fileURLWithPath:self.directory+"/native-art.json")) }
            if self.artJourneyComplete { self.snapshot("native-hearth") { self.finish() } }
            }}}}}
        }
    }
    func finish() {
        guard stage != "finished" else { return }
        if isArtRun, facts["failure"] == nil, !artObservationComplete {
            if !artJourneyComplete { artJourneyComplete = true; observeNativeArt() }
            return
        }
        clearWait(); overallDeadline?.cancel(); overallDeadline = nil
        for observer in artObservers { NotificationCenter.default.removeObserver(observer) };artObservers.removeAll()
        if let fixture = fullScreenFixture, fixture.styleMask.contains(.fullScreen), !exitingFixture, facts["failure"] == nil {
            exitingFixture = true
            awaitNative("owned fixture full-screen exit", names: [NSWindow.didExitFullScreenNotification], window: fixture,
                        requiredEvent: NSWindow.didExitFullScreenNotification,
                        condition: { !fixture.styleMask.contains(.fullScreen) }, action: { fixture.toggleFullScreen(nil) }) {
                self.facts["ownedFullScreenExited"] = true; self.finish()
            }; return
        }
        fullScreenFixture?.close(); stage = "finished"
        facts["deliveredFixtureKeyDowns"] = deliveredFixtureKeys
        facts["nativeInputEventCount"] = inputEvents
        record("journey finished")
        for (name, value) in [("native-probe.json", facts as Any), ("native-focus-events.json", trace as Any), ("native-event-origins.json", eventOrigins as Any)] {
            if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: directory + "/" + name)) }
        }
        NSApp.terminate(nil)
    }
}
