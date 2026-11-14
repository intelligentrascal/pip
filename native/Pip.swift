import AppKit
import WebKit
import Carbon
import Darwin

final class SpellPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class Pip: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var panel: SpellPanel!
    var web: WKWebView!
    var item: NSStatusItem!
    var child: Process?
    var input: FileHandle?
    var hotkey: EventHotKeyRef?
    var previous: NSRunningApplication?
    var buffer = Data()
    var loaded = false
    var pending: [[String: Any]] = []
    var hotkeyStatus = "⌘⇧E"
    var shortcut = try! SummonShortcut()
    var summonMenuItem: NSMenuItem?
    var attentionPanel: NSPanel?
    var attentionButton: NSButton?
    var attentionText: String?
    var hideAttentionEntirely = false
    var homeURL: URL!
    var nativeProbe: PipNativeProbe?
    var isolatedBackend: IsolatedBackendBridge?
    var backendWireProbe: BackendWireProbe?
    var dictationSession: String?
    lazy var dictation: OnDeviceDictation = {
        let controller = OnDeviceDictation()
        controller.publish = { [weak self] payload in self?.deliver(["kind":"dictation", "payload":payload]) }
        return controller
    }()
    func cancelDictation() {
        dictation.cancel()
        if let session = dictationSession {
            dictationSession = nil
            deliver(["kind":"dictationCancelled", "payload":["session":session]])
        }
    }
    var probeDirectory: String? {
        let env = ProcessInfo.processInfo.environment
        guard env["PIP_TEST"] == "1", let home = env["PIP_HOME"],
              (try? String(contentsOfFile: home + "/.pip-test-home", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)) == "pip-test-only" else { return nil }
        return env["PIP_PROBE_OUTPUT"]
    }
    var instanceFD: Int32 = -1
    let resources = Bundle.main.resourceURL!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let home = ProcessInfo.processInfo.environment["PIP_HOME"] ?? NSHomeDirectory() + "/Library/Application Support/Pip"
        do { try FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { NSApp.terminate(nil); return }
        homeURL = URL(fileURLWithPath: home, isDirectory: true)
        if let data = try? Data(contentsOf: homeURL.appendingPathComponent("shortcut.json")), let saved = try? JSONDecoder().decode(SummonShortcut.self, from: data) { shortcut = saved }
        instanceFD = Darwin.open(home + "/native.lock", O_CREAT | O_RDWR, 0o600)
        guard instanceFD >= 0, flock(instanceFD, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }
        NSApp.setActivationPolicy(.accessory)
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "pip")
        if probeDirectory != nil {
            let diagnostic = "window.__pipLoadErrors=[];addEventListener('error',e=>{if(window.__pipLoadErrors.length<12)window.__pipLoadErrors.push(String(e.message||'Bundled resource failed').slice(0,500));},true);"
            config.userContentController.addUserScript(WKUserScript(source:diagnostic,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        }
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        panel = SpellPanel(contentRect: NSRect(x: 0, y: 0, width: 660, height: 430), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.contentView = web
        panel.setAccessibilityLabel("Pip personal assistant")
        let ui = resources.appendingPathComponent("web/index.html")
        web.loadFileURL(ui, allowingReadAccessTo: resources.appendingPathComponent("web"))
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let image = NSImage(contentsOf: resources.appendingPathComponent("web/pip-mark.png")) { image.size = NSSize(width: 22, height: 22); image.isTemplate = true; item.button?.image = image }
        else { item.button?.title = "Pip" }
        let menu = NSMenu()
        summonMenuItem = menu.addItem(withTitle: "Summon Pip  " + shortcut.label, action: #selector(toggle), keyEquivalent: "")
        summonMenuItem?.target = self
        menu.addItem(withTitle: "Hide Pip entirely (keep work running)", action: #selector(hideEntirely), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Settings", action: #selector(settings), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Pause / stop work", action: #selector(stop), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Pip", action: #selector(quit), keyEquivalent: "q").target = self
        item.menu = menu
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, pointer in
            guard let pointer else { return OSStatus(eventNotHandledErr) }
            let host = Unmanaged<Pip>.fromOpaque(pointer).takeUnretainedValue()
            DispatchQueue.main.async { host.toggle() }
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), nil)
        registerShortcut()
        setupAttentionPanel()
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(forName:name, object:nil, queue:.main) { [weak self] _ in self?.cancelDictation() }
        }
        DistributedNotificationCenter.default().addObserver(forName:Notification.Name("com.apple.screenIsLocked"), object:nil, queue:.main) { [weak self] _ in self?.cancelDictation() }
        NSWorkspace.shared.notificationCenter.addObserver(forName:NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,object:nil,queue:.main) { [weak self] _ in self?.nativeStatus() }
        NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            self?.nativeProbe?.keyWillDispatch(event)
            if event.keyCode == 53 { self?.handleEscape(); return nil }; return event
        }
        NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification, object: panel, queue: .main) { [weak self] _ in self?.hidePopup(restorePrevious: false) }
        let testEnvironment = ProcessInfo.processInfo.environment
        if testEnvironment["PIP_TEST"] == "1", testEnvironment["PIP_ISOLATED_BACKENDS"] == "1", let directory = testEnvironment["PIP_BACKEND_PROBE_OUTPUT"],
           (try? String(contentsOfFile: home + "/.pip-test-home", encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)) == "pip-test-only" {
            backendWireProbe = BackendWireProbe(host: self, output: URL(fileURLWithPath: directory))
        }
        startService()
        if ProcessInfo.processInfo.environment["PIP_SHOW_ON_LAUNCH"] == "1" { summon() }
    }
    func startService() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: resources.appendingPathComponent("node-path.txt").path)
        // The build records the exact Node executable, never an account or shell command.
        if let path = try? String(contentsOf: resources.appendingPathComponent("node-path.txt"), encoding: .utf8) { process.executableURL = URL(fileURLWithPath: path.trimmingCharacters(in: .whitespacesAndNewlines)) }
        process.arguments = ["--disable-warning=ExperimentalWarning", resources.appendingPathComponent("runtime/service.js").path]
        process.currentDirectoryURL = resources
        var env = ProcessInfo.processInfo.environment
        env["PIP_NATIVE"] = "1"
        if let path = try? String(contentsOf: resources.appendingPathComponent("claude-path.txt"), encoding: .utf8) { env["PIP_CLAUDE_PATH"] = path.trimmingCharacters(in: .whitespacesAndNewlines) }
        process.environment = env
        let stdin = Pipe(); let stdout = Pipe(); let stderr = Pipe()
        process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
        input = stdin.fileHandleForWriting
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            guard !bytes.isEmpty else { return }
            DispatchQueue.main.async { self?.consume(bytes) }
        }
        // Diagnostics never display raw provider data or account information.
        stderr.fileHandleForReading.readabilityHandler = { handle in _ = handle.availableData }
        process.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.deliver(["kind":"disconnected", "payload":["message":"Pip’s local service disconnected. Your saved work is retained. Quit and reopen Pip."]]) } }
        do { try process.run(); child = process } catch { deliver(["kind":"disconnected", "payload":["message":"Pip’s local service could not start."]]) }
    }
    func consume(_ data: Data) {
        buffer.append(data)
        if buffer.count > 2_000_000 { child?.terminate(); buffer.removeAll(); return }
        while let range = buffer.range(of: Data([10])) {
            let line = buffer.subdata(in: 0..<range.lowerBound); buffer.removeSubrange(0..<range.upperBound)
            if let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any], object["version"] as? Int == 1 { deliver(object) }
        }
    }
    func deliver(_ object: [String: Any]) {
        if object["kind"] as? String == "state", let payload = object["payload"] as? [String: Any], let records = payload["workViews"] as? [[String: Any]] {
            let statuses = records.compactMap { $0["status"] as? String }
            attentionText = ["Waiting on you", "Held/Unknown", "Blocked", "Working", "Queued"].first(where: { statuses.contains($0) })
            updateAttention()
        }
        if object["kind"] as? String == "backend.request" {
            Task { @MainActor in
                let response: Data
                do {
                    let env = ProcessInfo.processInfo.environment
                    guard env["PIP_TEST"] == "1", env["PIP_ISOLATED_BACKENDS"] == "1", let home = env["PIP_HOME"], let sandbox = env["PIP_TEST_ROOT"] else { throw BackendError.unsafeFixture }
                    if self.isolatedBackend == nil { self.isolatedBackend = try IsolatedBackendBridge(home: URL(fileURLWithPath: home), sandbox: URL(fileURLWithPath: sandbox)) }
                    response = await self.isolatedBackend!.handle(try JSONSerialization.data(withJSONObject: object))
                } catch {
                    response = (try? JSONSerialization.data(withJSONObject: ["version":1,"id":object["id"] as? String ?? "invalid","kind":"backend.response","payload":["ok":false,"message":"Isolated backend is disabled or invalid."]])) ?? Data()
                }
                if var data = response.isEmpty ? nil : response { data.append(10); try? self.input?.write(contentsOf: data) }
            }; return
        }
        // A provider sign-in page opens in the person's browser; only https pages on the provider's own host.
        if object["kind"] as? String == "openAuth" {
            if let raw = (object["payload"] as? [String: Any])?["url"] as? String, let url = ProviderSignInURL.parse(raw) { NSWorkspace.shared.open(url) }
            return
        }
        if object["kind"] as? String == "effect", let proposal = object["payload"] as? [String: Any] { execute(proposal); return }
        // The backend-only app probe exercises private pipes, not the unaccepted
        // legacy renderer for new action types. Normal app delivery is unchanged.
        if let backendWireProbe { backendWireProbe.receive(object); return }
        if object["kind"] as? String == "backendResult" { return }
        guard loaded else { pending.append(object); return }
        web.callAsyncJavaScript("window.pipReceive(message)", arguments: ["message":object], in: nil, in: .page) { [weak self] result in
            if case .success = result { self?.nativeProbe?.receive(object) }
            else if let scenario = self?.nativeProbe?.scenario, ["chatgpt", "chatgpt-draft"].contains(scenario) { self?.nativeProbe?.fail("Pip’s bundled page could not render the ChatGPT check") }
        }
    }
    func execute(_ proposal: [String: Any]) {
        guard proposal["status"] as? String == "intent-recorded", let id = proposal["id"] as? String,
              let action = proposal["action"] as? [String: Any], let type = action["type"] as? String else { return }
        var status = "failed-known"; var receipt = "That action is not available."
        switch type {
        case "clipboard.copy":
            if let text = action["text"] as? String, text.count <= 30000 {
                NSPasteboard.general.clearContents()
                if NSPasteboard.general.setString(text, forType: .string) { status = "succeeded"; receipt = "Copied the approved draft." }
                else { status = "unknown"; receipt = "I can’t confirm the clipboard contents. I won’t copy again automatically." }
            }
        case "url.open":
            if let raw = action["url"] as? String, let url = URL(string: raw), url.scheme == "https", url.user == nil, url.password == nil, url.port == nil || url.port == 443 {
                let opened = NSWorkspace.shared.open(url); status = opened ? "succeeded" : "failed-known"; receipt = opened ? "Opened the approved link." : "The link could not open."
            }
        case "app.open":
            if let bundle = action["bundleId"] as? String, ["com.apple.iCal", "com.apple.reminders", "com.apple.TextEdit", "com.apple.finder"].contains(bundle), let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
                NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { [weak self] app, _ in
                    DispatchQueue.main.async { self?.send("receipt", ["id":id,"status":app == nil ? "failed-known" : "succeeded", "receipt":app == nil ? "The application could not open." : "Opened the approved application."]) }
                }; return
            }
        case "note.save":
            if let text = action["text"] as? String {
                let save = NSSavePanel(); save.nameFieldStringValue = "Pip note.txt"; save.title = "Save the approved Pip note"; save.canCreateDirectories = false
                let result = save.runModal()
                if result == .OK, let url = save.url {
                    do { try Data(text.utf8).write(to: url, options: .withoutOverwriting); status = "succeeded"; receipt = "Saved the approved note at your chosen destination." }
                    catch { status = FileManager.default.fileExists(atPath: url.path) ? "failed-known" : "unknown"; receipt = "The note was not confirmed saved. Pip never overwrites an existing file." }
                } else { receipt = "Save cancelled. No note was written." }
            }
        default: break
        }
        send("receipt", ["id":id,"status":status,"receipt":receipt])
    }
    func send(_ kind: String, _ payload: [String: Any] = [:], id: String = UUID().uuidString) {
        guard let input else { return }
        let object: [String: Any] = ["version":1,"id":id,"kind":kind,"payload":payload]
        if var data = try? JSONSerialization.data(withJSONObject: object) { data.append(10); try? input.write(contentsOf: data) }
    }
    func registerShortcut() {
        if let hotkey { UnregisterEventHotKey(hotkey) }; hotkey = nil
        let codes: [String: Int] = ["a":kVK_ANSI_A,"b":kVK_ANSI_B,"c":kVK_ANSI_C,"d":kVK_ANSI_D,"e":kVK_ANSI_E,"f":kVK_ANSI_F,"g":kVK_ANSI_G,"h":kVK_ANSI_H,"i":kVK_ANSI_I,"j":kVK_ANSI_J,"k":kVK_ANSI_K,"l":kVK_ANSI_L,"m":kVK_ANSI_M,"n":kVK_ANSI_N,"o":kVK_ANSI_O,"p":kVK_ANSI_P,"q":kVK_ANSI_Q,"r":kVK_ANSI_R,"s":kVK_ANSI_S,"t":kVK_ANSI_T,"u":kVK_ANSI_U,"v":kVK_ANSI_V,"w":kVK_ANSI_W,"x":kVK_ANSI_X,"y":kVK_ANSI_Y,"z":kVK_ANSI_Z]
        let key = EventHotKeyID(signature: OSType(0x50697031), id: 1)
        let result = codes[shortcut.letter].map { RegisterEventHotKey(UInt32($0), UInt32(cmdKey | shiftKey), key, GetApplicationEventTarget(), 0, &hotkey) }
        hotkeyStatus = result == noErr ? shortcut.label : shortcut.label + " is unavailable. Summon Pip from the menu bar."
        summonMenuItem?.title = "Summon Pip  " + shortcut.label
    }
    func nativeStatus() {
        deliver(["kind":"nativeStatus", "payload":["hotkey":hotkeyStatus,"letter":shortcut.letter,"registered":hotkey != nil,"reducedMotion":NSWorkspace.shared.accessibilityDisplayShouldReduceMotion]])
    }
    func setupAttentionPanel() {
        let badge = NSPanel(contentRect: NSRect(x:0,y:0,width:176,height:164), styleMask:[.borderless,.nonactivatingPanel], backing:.buffered, defer:false)
        badge.level = .floating; badge.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]
        badge.isReleasedWhenClosed = false; badge.hidesOnDeactivate = false; badge.isOpaque = false; badge.backgroundColor = .clear
        let content = NSView(frame:NSRect(x:0,y:0,width:176,height:164))
        let art = NSImageView(frame:NSRect(x:32,y:48,width:112,height:112))
        art.image = NSImage(contentsOf:resources.appendingPathComponent("web/curious-hearth/assembled-rest.png")); art.imageScaling = .scaleProportionallyUpOrDown
         art.wantsLayer = true
         let outline = NSShadow(); outline.shadowColor = NSColor(calibratedRed:20/255,green:41/255,blue:35/255,alpha:0.85); outline.shadowBlurRadius = 1; outline.shadowOffset = .zero; art.shadow = outline
        art.setAccessibilityElement(false); content.addSubview(art)
        let button = NSButton(title:"Open Pip", target:self, action:#selector(toggle)); button.frame = NSRect(x:0,y:0,width:176,height:44)
        button.bezelStyle = .rounded; button.setAccessibilityLabel("Open Pip task")
        content.addSubview(button); badge.contentView = content
        attentionPanel = badge; attentionButton = button
    }
    func updateAttention() {
        guard let badge = attentionPanel, let text = attentionText, !panel.isVisible, !hideAttentionEntirely else { attentionPanel?.orderOut(nil); return }
        let screen = panel.screen ?? NSScreen.main!
        let frame = screen.visibleFrame
        badge.setFrameOrigin(NSPoint(x:frame.maxX-192,y:frame.minY+24))
        attentionButton?.title = text; attentionButton?.setAccessibilityLabel("Open Pip: " + text)
        badge.orderFrontRegardless() // Non-key attention only: never activate or open the popup.
    }
    func hidePopup(restorePrevious: Bool) {
        cancelDictation()
        let wasVisible = panel.isVisible
        deliver(["kind":"popupHidden","payload":[:]])
        panel.orderOut(nil); updateAttention()
        if restorePrevious && wasVisible { previous?.activate(options:[]) }
    }
    @objc func hideEntirely() { hideAttentionEntirely = true; hidePopup(restorePrevious:true); attentionPanel?.orderOut(nil) }
    @objc func toggle() { if panel.isVisible { hide() } else { summon() } }
    func summon() {
        if !panel.isVisible { previous = NSWorkspace.shared.frontmostApplication }
        hideAttentionEntirely = false; attentionPanel?.orderOut(nil)
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main!
        let frame = screen.visibleFrame
        let width = min(660, frame.width - 32); let height = min(panel.frame.height, frame.height - 48)
        panel.setFrame(NSRect(x: frame.maxX - width - 16, y: frame.minY + 24, width: width, height: height), display: true)
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        web.callAsyncJavaScript("document.querySelector('#composer').focus()", arguments: [:], in: nil, in: .page, completionHandler: nil)
        deliver(["kind":"summon", "payload":[:]])
    }
    func hide() { hidePopup(restorePrevious:true) }
    func handleEscape() {
        web.callAsyncJavaScript("return window.pipEscape ? window.pipEscape() : false", arguments:[:], in:nil, in:.page) { [weak self] result in
            if case .success(let value) = result, value as? Bool == true { return }
            self?.hide()
        }
    }
    @objc func settings() { summon(); deliver(["kind":"settings", "payload":[:]]) }
    @objc func stop() { cancelDictation(); send("stop") }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { dictation.cancel(); if let hotkey { UnregisterEventHotKey(hotkey) }; try? input?.close(); child?.terminate(); if instanceFD >= 0 { close(instanceFD) } }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let directory = probeDirectory { nativeProbe = PipNativeProbe(host: self, directory: directory) }
        nativeStatus()
        for object in pending { deliver(object) }; pending.removeAll()
        send("snapshot")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = navigationAction.request.url?.standardizedFileURL == resources.appendingPathComponent("web/index.html").standardizedFileURL
        decisionHandler(allowed ? .allow : .cancel)
    }
    /// The key is typed into a native secure field and goes straight to the service over the private pipe.
    /// It never passes through WKWebView JavaScript, a log, or the saved state.
    func enterProviderKey(_ provider: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Enter your DeepSeek key"
        alert.informativeText = "Pip stores it in a private file on this Mac. Pip does not send anything to DeepSeek until you choose Allow in Settings."
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        alert.accessoryView = field
        alert.addButton(withTitle: "Save key"); alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let key = field.stringValue; field.stringValue = ""
        if !key.isEmpty { send("provider.setKey", ["id": provider, "key": key]) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body, isMainFrame: message.frameInfo.isMainFrame, source: message.frameInfo.request.url, bundledPage: resources.appendingPathComponent("web/index.html")) else { return }
        let kind = parsed.kind; let payload = parsed.payload; let id = parsed.id
        switch kind {
        case "dictation.start":
            guard panel.isVisible, panel.isKeyWindow, Set(payload.keys) == ["session"],
                  let session = payload["session"] as? String, UUID(uuidString:session) != nil else { return }
            dictationSession = session
            dictation.start(id:session)
        case "dictation.stop":
            if payload["session"] as? String == dictationSession { dictation.stop() }
        case "dictation.cancel":
            if payload["session"] as? String == dictationSession { cancelDictation() }
        case "hide": hide()
        case "resize":
            if let h = payload["height"] as? Double, h.isFinite { var f = panel.frame; let visible = (panel.screen ?? NSScreen.main!).visibleFrame; let height = min(max(h, 315), visible.height - 48); f.origin.y = min(max(f.origin.y,visible.minY+16),visible.maxY-height-16); f.size.height = height; panel.setFrame(f, display:true) }
        case "saveComposer":
            send(kind, payload, id: id)
            if let text = payload["text"] as? String { nativeProbe?.composerChanged(text) }
        case "configureShortcut":
            do {
                guard let letter = payload["letter"] as? String else { return }
                let selected = try SummonShortcut(letter:letter)
                try JSONEncoder().encode(selected).write(to:homeURL.appendingPathComponent("shortcut.json"),options:.atomic)
                shortcut = selected; registerShortcut(); nativeStatus()
            } catch { deliver(["kind":"error","payload":["message":"The shortcut could not be saved. The previous setting is unchanged."]]) }
        case "provider.enterKey":
            guard let provider = payload["id"] as? String, provider == "deepseek" else { return }
            enterProviderKey(provider)
        case "provider.allow", "provider.withdraw", "provider.select", "provider.backup", "provider.signIn", "provider.cancelSignIn", "provider.remove":
            send(kind, payload, id: id)
        case "snapshot", "submit", "stop", "propose", "approve", "cancel", "saveDraft", "backendQuery", "reconcile", "tracker", "feedback.save", "feedback.correct", "work.backlog", "browser":
            if kind == "stop" || kind == "submit" { cancelDictation() }
            send(kind, payload, id: id)
        default: break
        }
    }
}
@main
struct PipMain {
    static func main() {
        let env = ProcessInfo.processInfo.environment
        let observeDispatch = env["PIP_TEST"] == "1" && env["PIP_PROBE_OBSERVE_DISPATCH"] == "1"
        let app = observeDispatch ? PipOriginApplication.shared : NSApplication.shared
        let delegate = Pip()
        app.delegate = delegate
        app.run()
    }
}
