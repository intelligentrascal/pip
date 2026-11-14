import Foundation
import PipCore

// This executable never instantiates a speech recognizer or audio engine.
@main
struct DictationChecks {
    static func require(_ condition: Bool) { precondition(condition, "Dictation boundary failed") }
    static func main() {
        let page = URL(fileURLWithPath: "/Pip.app/Contents/Resources/web/index.html")
        let submit: [String: Any] = ["version":1, "id":"dictation-review", "kind":"submit", "payload":["request":"Summarise the meeting notes"]]
        // Intent: ELF-8 on-device-only dictation, no permissions requested by checks.
        for microphone in [false,true] {
            for speech in [false,true] {
                for supported in [false,true] {
                    for available in [false,true] {
                        let refusal = DictationPolicy.refusal(microphone:microphone,speech:speech,supported:supported,available:available)
                        require((refusal == nil) == (microphone && speech && supported && available))
                    }
                }
            }
        }
        for kind in ["dictation.start", "dictation.stop", "dictation.cancel"] {
            var message = submit; message["kind"] = kind; message["payload"] = ["session": UUID().uuidString]
            require(BridgeMessage.parse(message,isMainFrame:true,source:page,bundledPage:page)?.kind == kind)
            require(BridgeMessage.parse(message,isMainFrame:false,source:page,bundledPage:page) == nil)
        }
        var fakeTranscript = submit; fakeTranscript["kind"] = "dictation"
        require(BridgeMessage.parse(fakeTranscript,isMainFrame:true,source:page,bundledPage:page) == nil)
        print("Dictation permission, local availability and bridge checks passed; no audio access.")
    }
}
