import Foundation

/// ELF-8: supported on-device speech only. No permission request or remote fallback.
public enum DictationPolicy {
    public static func refusal(microphone: Bool, speech: Bool, supported: Bool, available: Bool) -> String? {
        guard microphone && speech else { return "Microphone and Speech Recognition access are not both granted. Pip has requested neither. Keep typing; a later consented microphone check is needed." }
        guard supported else { return "On-device dictation is unavailable for this Mac or locale. Keep typing; no cloud speech fallback will run." }
        guard available else { return "On-device dictation is temporarily unavailable. Keep typing or try again later." }
        return nil
    }
}
