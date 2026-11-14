import Foundation
import PipCore

@main
struct BridgeChecks {
    static func require(_ condition: Bool) { precondition(condition, "Native bridge boundary failed") }
    // Intent: V1-SPEC WebKit boundary; A4/A19 must reject arbitrary execution and foreign frames.
    static func main() async throws {
        let page = URL(fileURLWithPath: "/Pip.app/Contents/Resources/web/index.html")
        let submit: [String: Any] = ["version": 1, "id": "rewrite-notes", "kind": "submit", "payload": ["request": "Can you send the notes today?"]]
        require(BridgeMessage.parse(submit, isMainFrame: true, source: page, bundledPage: page)?.kind == "submit")
        require(BridgeMessage.parse(submit, isMainFrame: false, source: page, bundledPage: page) == nil)
        require(BridgeMessage.parse(submit, isMainFrame: true, source: URL(string: "https://example.com"), bundledPage: page) == nil)
        require(BridgeMessage.parse(submit, isMainFrame: true, source: URL(fileURLWithPath: "/tmp/index.html"), bundledPage: page) == nil)
        for forbidden in ["receipt", "execute", "shell", "openURL", "backend.request", "backend.response", "notification.enqueue", "nativeContext", "nativeClearContext", "provider.setKey"] {
            var attack = submit; attack["kind"] = forbidden
            require(BridgeMessage.parse(attack, isMainFrame: true, source: page, bundledPage: page) == nil)
        }
        // Intent: ELF-8 actual Tracker/Feedback and configurable Command+Shift+E.
        for (kind,payload) in [("tracker",["view":"about"]), ("feedback.save",["originalWords":"Pip opens on the wrong display"]), ("feedback.correct",["id":"wrong-display"]), ("work.backlog",["request":"Summarise this document later"]), ("configureShortcut",["letter":"e"])] {
            var message = submit; message["kind"] = kind; message["payload"] = payload
            require(BridgeMessage.parse(message,isMainFrame:true,source:page,bundledPage:page)?.kind == kind)
        }
        // Intent: ELF-24 provider settings reach the service, but a key only travels from the native secure field.
        for kind in ["provider.allow", "provider.signIn", "provider.enterKey"] {
            var message = submit; message["kind"] = kind; message["payload"] = ["id": "deepseek"]
            require(BridgeMessage.parse(message,isMainFrame:true,source:page,bundledPage:page)?.kind == kind)
        }
        // Intent: ELF-26 opens only OpenAI’s authorization page, never a foreign sign-in host.
        require(ProviderSignInURL.parse("https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client") != nil)
        require(ProviderSignInURL.parse("https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1") != nil)
        for raw in ["http://auth.openai.com/api/accounts/authorize", "https://auth.openai.com.evil.example/api/accounts/authorize", "https://auth.openai.com/other", "https://evil.example/", "https://user:pass@auth.openai.com/api/accounts/authorize", "https://auth.openai.com:444/api/accounts/authorize"] { require(ProviderSignInURL.parse(raw) == nil) }
        var cancelSignIn = submit; cancelSignIn["kind"] = "provider.cancelSignIn"; cancelSignIn["payload"] = ["id":"openai"]
        require(BridgeMessage.parse(cancelSignIn,isMainFrame:true,source:page,bundledPage:page)?.kind == "provider.cancelSignIn")
        // Intent: ELF-15's isolated browser uses only the existing closed native envelope.
        var browser = submit; browser["kind"] = "browser"
        var submittedPages = submit;submittedPages["payload"] = ["request":"Read the public reference","browserPages":["https://example.com/"]]
        require((BridgeMessage.parse(submittedPages,isMainFrame:true,source:page,bundledPage:page)?.payload["browserPages"] as? [String]) == ["https://example.com/"])
        let browserMessage = BridgeMessage.parse(browser,isMainFrame:true,source:page,bundledPage:page)
        require(browserMessage?.kind == "browser")
        require(browserMessage?.payload["request"] as? String == "Can you send the notes today?")
        require(BridgeMessage.parse(browser,isMainFrame:false,source:page,bundledPage:page) == nil)
        require(BridgeMessage.parse(browser,isMainFrame:true,source:URL(string:"https://example.com"),bundledPage:page) == nil)
        for response in ["browserState","browserResult"] { var forged = browser;forged["kind"] = response;require(BridgeMessage.parse(forged,isMainFrame:true,source:page,bundledPage:page) == nil) }
        require(try SummonShortcut().label == "⌘⇧E")
        require(try SummonShortcut(letter:"J").letter == "j")
        for invalid in ["", "space", "⌘e", "é", "1"] {
            do { _ = try SummonShortcut(letter:invalid); preconditionFailure("Invalid chord accepted") } catch { }
        }
        do { _ = try JSONDecoder().decode(SummonShortcut.self,from:Data("{\"letter\":\"space\"}".utf8)); preconditionFailure("Invalid saved chord accepted") } catch { }
        print("Native bridge interface checks passed")
        var unexpected = submit; unexpected["execute"] = true
        require(BridgeMessage.parse(unexpected, isMainFrame: true, source: page, bundledPage: page) == nil)
        try await ScheduleChecks.run()
    }
}
