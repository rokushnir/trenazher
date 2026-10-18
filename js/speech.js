// Розпізнавання мовлення через Web Speech API (uk-UA). Сервіс розпізнавання надає браузер.
export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export class Speech {
  constructor({ onFinal = () => {}, onInterim = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { onFinal, onInterim, onError });
    this.running = false; this.segStart = 0; this.finals = 0; this.fails = 0;
  }
  start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    this.running = true;
    const r = this.rec = new SR();
    r.lang = 'uk-UA'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = e => {
      const now = performance.now();
      this.fails = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], text = res[0].transcript.trim();
        if (!this.segStart) this.segStart = now;
        if (res.isFinal) {
          if (text) { this.finals++; this.onFinal({ text, start: this.segStart, end: now }); }
          this.segStart = 0;
        } else this.onInterim(text);
      }
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
        this.running = false; this.onError(e.error);
      }
    };
    r.onend = () => {
      if (!this.running) return;
      // браузер завершує розпізнавання після тиші — перезапускаємо
      if (++this.fails > 50) { this.running = false; this.onError('restart-limit'); return; }
      setTimeout(() => { try { this.running && r.start(); } catch {} }, 250);
    };
    try { r.start(); } catch { return false; }
    return true;
  }
  stop() { this.running = false; try { this.rec?.stop(); } catch {} }
}
