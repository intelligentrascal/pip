import AppKit
import AVFoundation
import Speech

/// Constructed lazily on explicit Talk. Never requests OS permissions, writes audio,
/// invokes a server speech route, or forwards speech events to the durable service.
final class OnDeviceDictation {
    var publish: ([String: Any]) -> Void = { _ in }
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var timer: Timer?
    private var session: String?
    private var transcript = ""

    func start(id: String) {
        cancel()
        guard let reason = DictationPolicy.refusal(
            microphone: AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
            speech: SFSpeechRecognizer.authorizationStatus() == .authorized,
            supported: true, available: true) else {
            beginAuthorized(id: id)
            return
        }
        publish(["session": id, "state": "unavailable", "message": reason])
    }

    private func beginAuthorized(id: String) {
        let recognizer = SFSpeechRecognizer(locale: Locale.current)
        if let reason = DictationPolicy.refusal(microphone: true, speech: true,
            supported: recognizer?.supportsOnDeviceRecognition == true,
            available: recognizer?.isAvailable == true) {
            publish(["session": id, "state": "unavailable", "message": reason]); return
        }
        guard let recognizer else { return }
        let audio = AVAudioEngine()
        let recognition = SFSpeechAudioBufferRecognitionRequest()
        recognition.requiresOnDeviceRecognition = true
        recognition.shouldReportPartialResults = true
        recognition.addsPunctuation = true
        let input = audio.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            publish(["session": id, "state": "unavailable", "message": "No usable microphone input. Keep typing."]); return
        }
        session = id; transcript = ""; engine = audio; request = recognition; self.recognizer = recognizer
        var lastLevel = Date.distantPast
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            recognition.append(buffer)
            // Measured input level only (no audio or text leaves this closure), about 15 updates a second.
            let now = Date()
            guard now.timeIntervalSince(lastLevel) > 0.066, let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
            lastLevel = now
            var sum: Float = 0
            for index in 0..<Int(buffer.frameLength) { sum += samples[index] * samples[index] }
            let level = min(1, Double((sum / Float(buffer.frameLength)).squareRoot()) * 8)
            DispatchQueue.main.async { guard let self, self.session == id else { return }; self.publish(["session": id, "state": "level", "level": level]) }
        }
        task = recognizer.recognitionTask(with: recognition) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.session == id else { return }
                if let result { self.transcript = String(result.bestTranscription.formattedString.prefix(12000)) }
                if error != nil {
                    self.finish(message: "Dictation stopped after a speech error. Review any partial text; nothing was sent.")
                } else if result?.isFinal == true {
                    self.finish(message: "Capture ended. Review the transcript; nothing was sent.")
                } else {
                    self.publish(["session": id, "state": "capturing", "text": self.transcript,
                        "message": "Listening on this Mac. Stop to review; Ask remains separate."])
                    if self.transcript.count >= 12000 { self.finish(message: "Text limit reached. Review the transcript; nothing was sent.") }
                }
            }
        }
        do {
            audio.prepare(); try audio.start()
            publish(["session": id, "state": "capturing", "text": "", "message": "Listening on this Mac. Capture ends after 60 seconds or when you stop."])
            timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in
                self?.finish(message: "Capture time limit reached. Review partial text; the last words may be missing.")
            }
        } catch {
            cancel()
            publish(["session": id, "state": "unavailable", "message": "The microphone could not start. Keep typing; nothing was sent."])
        }
    }

    func stop() { finish(message: "Capture stopped. Review partial text; the last words may be missing. Nothing was sent.") }
    private func finish(message: String) {
        guard let id = session else { return }
        let text = transcript
        cancel()
        publish(["session": id, "state": "review", "text": text, "message": message])
    }
    func cancel() {
        // Invalidate before cancelling; queued callbacks cannot restore cancelled text.
        session = nil; timer?.invalidate(); timer = nil
        engine?.stop(); engine?.inputNode.removeTap(onBus: 0); engine = nil
        request?.endAudio(); task?.cancel(); task = nil; request = nil; recognizer = nil; transcript = ""
    }
}
