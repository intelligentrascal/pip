// Dictation, inline: the words appear in the message box while Pip listens, in secondary text, with the Talk button lit and five level bars beside it.
// Native events are session-bound; no browser microphone or speech service exists. Nothing sends until the person presses Return: the first Return
// only stops listening, the words stay editable, and Esc puts back exactly what was typed before. A late partial never replaces edited words.
window.PipDictation = class {
 constructor({ emit, reveal, changed, level, notice }) {
  this.level = level; this.emit = emit; this.reveal = reveal; this.changed = changed; this.notice = notice; this.session = null; this.state = 'idle'; this.base = '';
  this.composer = document.getElementById('composer'); this.talk = document.getElementById('talk');
  this.talk.onclick = () => this.toggle();
 }
 get pending() { return this.session !== null; }
 // The Talk button: start, or stop listening and keep the words; while the Mac is still starting it cancels.
 toggle() {
  if (this.state === 'idle') this.start();
  else if (this.state === 'capturing') this.stopListening();
  else if (this.state === 'starting') this.cancel();
 }
 // Return while listening stops the capture; it never sends.
 stopListening() {
  if (this.state === 'capturing') { this.state = 'stopping'; this.emit('dictation.stop', { session: this.session }); this.changed(); }
  else if (this.state === 'starting') this.cancel();
 }
 words(text) { const base = this.base; return base + (base && !/\s$/.test(base) && text ? ' ' : '') + text; }
 show(value) { this.composer.value = value.slice(0, this.composer.maxLength); this.composer.scrollTop = this.composer.scrollHeight; }
 start() {
  if (this.pending) return;
  this.reveal(); this.session = crypto.randomUUID(); this.state = 'starting'; this.base = this.composer.value;
  this.composer.readOnly = true; this.composer.classList.add('hear');
  if (!window.webkit?.messageHandlers?.pip && !window.pipTestBridge) {
   this.receive({ session: this.session, state: 'unavailable', message: 'On-device dictation needs the native Pip app. Keep typing; no microphone was started.' }); return;
  }
  const id = this.session;
  this.timer = setTimeout(() => {
   if (this.session !== id || this.state !== 'starting') return;
   this.emit('dictation.cancel', { session: id });
   this.receive({ session: id, state: 'unavailable', message: 'The native dictation connection did not respond. Pip requested a stop but could not confirm capture status. Keep typing.' });
  }, 5000);
  this.emit('dictation.start', { session: this.session }); this.changed();
 }
 receive(payload) {
  // Measured input level from native capture; it carries no text and changes no state.
  if (payload?.state === 'level') { if (this.session && payload.session === this.session && this.state === 'capturing' && Number.isFinite(payload.level)) this.level?.(payload.level); return; }
  if (!this.session || payload?.session !== this.session || !['capturing', 'review', 'unavailable'].includes(payload.state)) return;
  if (this.state === 'stopping' && payload.state === 'capturing') return;
  clearTimeout(this.timer);
  const message = String(payload.message ?? '').slice(0, 600), text = typeof payload.text === 'string' ? payload.text.slice(0, 12000) : '';
  if (payload.state === 'capturing') { this.state = 'capturing'; this.show(this.words(text)); this.changed(); return; }
  this.level?.(0);
  if (payload.state === 'unavailable') { this.finish(this.base); this.notice(message); return; }
  // Review: the words are the person's to edit now, after whatever they had typed. Nothing was sent.
  const joined = this.words(text.trim()), fits = joined.length <= this.composer.maxLength;
  this.finish(fits ? joined : joined.slice(0, this.composer.maxLength));
  this.notice(!text.trim() ? 'No speech was recognised. Nothing was sent.' : fits ? 'Review the words, then press Return to send. Nothing was sent.' : 'Only the first part of the words fit in the message box. Nothing was sent.');
  this.composer.focus(); this.composer.setSelectionRange(this.composer.value.length, this.composer.value.length);
 }
 // Back to an ordinary message box holding `value`; the words are saved with the draft only when the person edits or sends them.
 finish(value) {
  clearTimeout(this.timer);
  this.session = null; this.state = 'idle'; this.base = ''; this.composer.readOnly = false; this.composer.classList.remove('hear'); this.show(value);
  this.changed();
 }
 // Esc, focus loss, a hidden window or the Mac's own cancel: the words are forgotten and the typed message is put back as it was.
 cancel({ notify = true } = {}) {
  if (!this.pending) return;
  if (notify) this.emit('dictation.cancel', { session: this.session });
  this.level?.(0); this.finish(this.base);
  this.notice('Dictation closed. Your typed message is unchanged. Nothing was sent.');
 }
};
