import AppKit
import WebKit
import Carbon
import Darwin
import ApplicationServices
import AVFoundation
import UserNotifications

final class SpellPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class Pip: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var panel: SpellPanel!
    var web: WKWebView!
    /// The see-through backdrop under the chat window. It is hidden (the window turns solid) under Reduce Transparency or Increase Contrast.
    var backdrop: NSVisualEffectView!
    var windowSize = CGSize(width: PanelGeometry.defaultWidth, height: PanelGeometry.smallestHeight)
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
    var magic = MagicSetting()
    /// The width and most height the person chose by dragging the window's edges, saved in window.json; mostHeight follows a drag live.
    var windowSetting = WindowSetting()
    var mostHeight: Double?
    var dimPanel: NSPanel?
    var pointerTimer: Timer?
    var lastPointer: CGPoint?
    var pointerSent = false
    var hideAsked = false
    var summonMenuItem: NSMenuItem?
    var attentionPanel: NSPanel?
    var attentionButton: NSButton?
    var attentionText: String?
    var hideAttentionEntirely = false
    var homeURL: URL!
    var updates: UpdateFlow!
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
        magic = MagicSetting.load(from: homeURL)
        windowSetting = WindowSetting.load(from: homeURL); mostHeight = windowSetting.most; windowSize.width = windowSetting.width
        UpdateFiles.recordLaunch(home: homeURL, version: UpdateFlow.version)
        updates = UpdateFlow(home: homeURL) { [weak self] in self?.stop() }
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
        panel = SpellPanel(contentRect: NSRect(x: 0, y: 0, width: windowSize.width + PanelGeometry.gap + PanelGeometry.figure, height: PanelGeometry.smallestHeight + PanelGeometry.feet), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        let container = NSView(frame: .zero)
        backdrop = NSVisualEffectView(frame: .zero)
        backdrop.material = .popover; backdrop.blendingMode = .behindWindow; backdrop.state = .active
        backdrop.maskImage = Pip.roundedMask(radius: 9)
        web.autoresizingMask = [.width, .height]
        container.addSubview(backdrop); container.addSubview(web)
        web.frame = container.bounds
        panel.contentView = container
        placeBackdrop()
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
        menu.addItem(withTitle: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "").target = self
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
        updates.checkWhenTestRequests()
        if ProcessInfo.processInfo.environment["PIP_SHOW_ON_LAUNCH"] == "1" { summon() }
    }
    func startService() {
        let process = Process()
        // A release app carries its own Node next to the Pip executable. A developer build records the exact Node
        // executable it was built with, never an account or shell command.
        if let bundled = Bundle.main.url(forAuxiliaryExecutable: "node") { process.executableURL = bundled }
        else if let path = try? String(contentsOf: resources.appendingPathComponent("node-path.txt"), encoding: .utf8) { process.executableURL = URL(fileURLWithPath: path.trimmingCharacters(in: .whitespacesAndNewlines)) }
        else { deliver(["kind":"disconnected", "payload":["message":"Pip’s local service could not start."]]); return }
        process.arguments = ["--disable-warning=ExperimentalWarning", resources.appendingPathComponent("runtime/service.js").path]
        process.currentDirectoryURL = resources
        var env = ProcessInfo.processInfo.environment
        env["PIP_NATIVE"] = "1"
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
            if let bundle = action["bundleId"] as? String, bundle.count <= 200, bundle.range(of: "^[A-Za-z0-9][A-Za-z0-9-]*(\\.[A-Za-z0-9-]+)+$", options: .regularExpression) != nil, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
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
        let solid = PanelGeometry.solid(reduceTransparency: NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency, increaseContrast: NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast)
        backdrop?.isHidden = solid
        let visibleHeight = Double((panel.screen ?? NSScreen.main)?.visibleFrame.height ?? 0)
        deliver(["kind":"nativeStatus", "payload":["hotkey":hotkeyStatus,"letter":shortcut.letter,"registered":hotkey != nil,"reducedMotion":NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,"solid":solid,"contrast":NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast,"visibleHeight":visibleHeight,"magic":magic.level.rawValue,"windowWidth":windowSize.width,"mostHeight":mostHeight ?? 0]])
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
    func placeBackdrop() { backdrop?.frame = PanelGeometry.backdrop(windowWidth: Double(windowSize.width), windowHeight: Double(windowSize.height)) }
    /// A stretchable rounded rectangle that clips the backdrop to the window's corners.
    static func roundedMask(radius: CGFloat) -> NSImage {
        let side = radius * 2 + 1
        let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in NSColor.black.setFill(); NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill(); return true }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius); image.resizingMode = .stretch
        return image
    }
    /// The desktop under Pip, dimmed while Rich magic calls him. It never takes a click.
    func setDim(_ on: Bool) {
        if !on { guard let dim = dimPanel, dim.isVisible else { return }
            NSAnimationContext.runAnimationGroup({ $0.duration = 0.16; dim.animator().alphaValue = 0 }, completionHandler: { [weak dim] in if dim?.alphaValue == 0 { dim?.orderOut(nil) } })
            return }
        guard panel.isVisible else { return }
        let dim = dimPanel ?? {
            let made = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            made.level = .floating; made.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]; made.ignoresMouseEvents = true
            made.isReleasedWhenClosed = false; made.hidesOnDeactivate = false; made.isOpaque = false; made.hasShadow = false
            made.backgroundColor = NSColor.black.withAlphaComponent(0.42); made.setAccessibilityElement(false)
            dimPanel = made; return made
        }()
        dim.setFrame((panel.screen ?? NSScreen.main!).frame, display: false)
        dim.alphaValue = 0; dim.order(.below, relativeTo: panel.windowNumber)
        NSAnimationContext.runAnimationGroup { $0.duration = 0.12; dim.animator().alphaValue = 1 }
    }
    /// The pointer feed runs only while Pip is on screen and sends a position only when it changes, so a still pointer costs the page nothing.
    func startPointer() {
        guard pointerTimer == nil else { return }
        pointerSent = false; lastPointer = nil
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.feedPointer() }
        RunLoop.main.add(timer, forMode: .common); pointerTimer = timer
    }
    func stopPointer() { pointerTimer?.invalidate(); pointerTimer = nil; lastPointer = nil; pointerSent = false }
    func feedPointer() {
        guard panel.isVisible else { return }
        let screen = (panel.screen ?? NSScreen.main!).frame
        if let at = PointerFeed.position(mouse: NSEvent.mouseLocation, panel: panel.frame, screen: screen) {
            if pointerSent, lastPointer == at { return }
            lastPointer = at; pointerSent = true
            deliver(["kind":"pointer", "payload":["x":Double(at.x), "y":Double(at.y)]])
        } else if lastPointer != nil || !pointerSent {
            lastPointer = nil; pointerSent = true
            deliver(["kind":"pointer", "payload":["off":true]])
        }
    }
    func hidePopup(restorePrevious: Bool) {
        cancelDictation()
        hideAsked = false; stopPointer(); setDim(false)
        let wasVisible = panel.isVisible
        deliver(["kind":"popupHidden","payload":[:]])
        panel.orderOut(nil); updateAttention()
        if restorePrevious && wasVisible { previous?.activate(options:[]) }
    }
    @objc func hideEntirely() { hideAttentionEntirely = true; hidePopup(restorePrevious:true); attentionPanel?.orderOut(nil) }
    @objc func toggle() { if panel.isVisible { requestHide() } else { summon() } }
    /// Hiding is first asked of the page, so the embers can gather into the lantern; the page answers with hide. If it does not answer within a second, Pip hides anyway.
    func requestHide() {
        guard panel.isVisible else { return }
        if hideAsked { hide(); return }
        hideAsked = true
        deliver(["kind":"hideRequest", "payload":[:]])
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in if self?.hideAsked == true { self?.hide() } }
    }
    func summon() {
        if !panel.isVisible { previous = NSWorkspace.shared.frontmostApplication }
        hideAttentionEntirely = false; attentionPanel?.orderOut(nil)
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main!
        let frame = screen.visibleFrame
        panel.setFrame(PanelGeometry.panel(visible: frame, windowWidth: windowSize.width, windowHeight: windowSize.height, most: mostHeight), display: true)
        placeBackdrop()
        nativeStatus()
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        web.callAsyncJavaScript("document.querySelector('#composer').focus()", arguments: [:], in: nil, in: .page, completionHandler: nil)
        deliver(["kind":"summon", "payload":[:]])
        startPointer()
    }
    func hide() { hidePopup(restorePrevious:true) }
    func handleEscape() {
        web.callAsyncJavaScript("return window.pipEscape ? window.pipEscape() : false", arguments:[:], in:nil, in:.page) { [weak self] result in
            if case .success(let value) = result, value as? Bool == true { return }
            self?.requestHide()
        }
    }
    @objc func settings() { summon(); deliver(["kind":"settings", "payload":[:]]) }
    @objc func checkForUpdates() { updates.check() }
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
    /// Setup asks once for all six macOS permissions, in order, so dialogs never stack. Each ask shows its own
    /// system prompt or opens its own System Settings pane; nothing here can grant access, only the captain can.
    func permissionAsks() -> [PermissionsSetup.Ask] {
        return [
            .init(id: "accessibility", prompt: { @Sendable in
                AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary) ? .granted : .notGranted
            }),
            .init(id: "screen-recording", prompt: { @Sendable in
                CGRequestScreenCaptureAccess() ? .granted : .notGranted
            }),
            .init(id: "automation", prompt: { @Sendable in await Pip.askAppleEventsPermission() }),
            .init(id: "full-disk-access", prompt: { @Sendable in
                // No API can prompt for Full Disk Access; the pane opens once and Pip records what it can read.
                if let pane = URL(string: "x-apple.systempreferences:com.apple.settings.privacy?Privacy_AllFiles") { NSWorkspace.shared.open(pane) }
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                return FileManager.default.isReadableFile(atPath: NSHomeDirectory() + "/Library/Application Support/com.apple.TCC/TCC.db") ? .granted : .notGranted
            }),
            .init(id: "microphone", prompt: { @Sendable in await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { granted in continuation.resume(returning: granted ? .granted : .notGranted) }
            } }),
            .init(id: "notifications", prompt: { @Sendable in await withCheckedContinuation { continuation in
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
                    continuation.resume(returning: granted ? .granted : .notGranted)
                }
            } }),
        ]
    }
    /// A harmless Apple event to System Events is what makes macOS show the Automation prompt; its outcome is the answer.
    static func askAppleEventsPermission() async -> MacPermissionState {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "tell application id \"com.apple.systemevents\" to get name of first application process"]
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
        do { try process.run() } catch { return .unknown }
        return await withCheckedContinuation { continuation in
            process.terminationHandler = { process in
                continuation.resume(returning: process.terminationStatus == 0 ? .granted : .notGranted)
            }
        }
    }
    func notificationPermissionState() async -> MacPermissionState {
        await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                let authorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
                continuation.resume(returning: PermissionsSetup.notificationState(authorized: authorized, notDetermined: settings.authorizationStatus == .notDetermined))
            }
        }
    }
    /// The setup panel's answer: live checks where they cannot prompt, recorded answers where only the ask can decide,
    /// saved once, and delivered to the page so the view shows exactly what this Mac now allows.
    func handlePermissions(asking: Bool) async {
        var record = PermissionsSetup.load(from: homeURL) ?? PermissionsSetup.fresh()
        if asking {
            record.askedAt = Date()
            record.state.merge(await PermissionsSetup.run(asks: permissionAsks())) { _, asked in asked }
        }
        var live = PermissionsSetup.checkWithoutPrompting()
        live["notifications"] = await notificationPermissionState()
        let merged = PermissionsSetup.report(record: record, live: live)
        try? PermissionsSetup.save(merged, to: homeURL)
        let rows = PermissionsSetup.rows(record: merged).map { row in
            ["id": row.permission.id, "label": row.permission.label, "why": row.permission.why, "state": row.state.rawValue]
        }
        deliver(["kind": "permissionsState", "payload": [
            "askedAt": merged.askedAt.map { ISO8601DateFormatter().string(from: $0) } ?? "",
            "permissions": rows,
        ]])
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
            // The page says how tall its chat window is, and its width only while the person drags the left edge. The panel is that plus Pip's figure and the room under his feet, and never moves its bottom or its right side.
            // A missing width keeps the current one: a measurement taken before the web view has a size must never narrow the window.
            if let h = payload["windowHeight"] as? Double, h.isFinite {
                let visible = (panel.screen ?? NSScreen.main!).visibleFrame
                if let chosen = payload["mostHeight"] as? Double, chosen.isFinite { mostHeight = chosen > 0 ? chosen : nil }
                let w = PanelGeometry.width(requested: payload["windowWidth"] as? Double, current: windowSize.width, visibleWidth: Double(visible.width))
                let frame = PanelGeometry.panel(visible: visible, windowWidth: w, windowHeight: h, most: mostHeight)
                windowSize = CGSize(width: frame.width - PanelGeometry.gap - PanelGeometry.figure, height: frame.height - PanelGeometry.feet)
                panel.setFrame(frame, display: true); placeBackdrop()
            }
        case "configureWindow":
            // The person let go of an edge: remember the width and the most height on this Mac.
            guard Set(payload.keys) == ["width", "most"], let width = payload["width"] as? Double, width.isFinite, let most = payload["most"] as? Double, most.isFinite else { return }
            let visible = (panel.screen ?? NSScreen.main!).visibleFrame
            let selected = WindowSetting(width: PanelGeometry.width(requested: width, current: windowSize.width, visibleWidth: Double(visible.width)), most: most > 0 ? most : nil)
            do { try selected.save(to: homeURL); windowSetting = selected; mostHeight = selected.most }
            catch { deliver(["kind":"error","payload":["message":"The window size could not be saved. Pip will open at its previous size."]]) }
        case "saveComposer":
            send(kind, payload, id: id)
            if let text = payload["text"] as? String { nativeProbe?.composerChanged(text) }
        case "configureMagic":
            guard Set(payload.keys) == ["level"], let raw = payload["level"] as? String, let level = MagicLevel(rawValue: raw) else { return }
            do { let selected = MagicSetting(level: level); try selected.save(to: homeURL); magic = selected; nativeStatus() }
            catch { deliver(["kind":"error","payload":["message":"The Magic setting could not be saved. The previous setting is unchanged."]]) }
        case "dim":
            guard Set(payload.keys) == ["on"], let on = payload["on"] as? Bool else { return }
            setDim(on)
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
        case "permissions.setup", "permissions.status":
            Task { await self.handlePermissions(asking: kind == "permissions.setup") }
        case "provider.allow", "provider.withdraw", "provider.select", "provider.backup", "provider.signIn", "provider.cancelSignIn", "provider.remove":
            send(kind, payload, id: id)
        case "snapshot", "submit", "steer", "stop", "propose", "approve", "cancel", "saveDraft", "backendQuery", "reconcile", "tracker", "feedback.save", "feedback.correct", "work.backlog", "browser":
            if kind == "stop" || kind == "submit" || kind == "steer" { cancelDictation() }
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
