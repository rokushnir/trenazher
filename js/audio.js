// Аналіз голосу на пристрої: гучність, висота тону, фрази, паузи. Звук не записується.
import { soft, mean, std, quantile } from './core.js';

const TICK = 50, GAP = 400;

export class AudioAnalyzer {
  constructor({ stream, coach, k, onPhrase = () => {} }) {
    Object.assign(this, { stream, coach, k, onPhrase });
    this.noise = -60; this.noiseS = [];
    this.inPhrase = false; this.phrase = null; this.lastSound = 0; this.firstSpeechAt = 0;
    this.phrases = []; this.pauses = []; this.timeline = []; this.pitchHist = [];
    this.st = { ehs: 0, hesitations: 0, longPauses: 0 };
    this.active = false; this.calibrating = false; this.lastTl = 0;
  }
  s(strict, loose) { return soft(this.k.voice ?? 0, strict, loose); }

  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 2048;
    src.connect(this.an);
    this.buf = new Float32Array(this.an.fftSize);
    this.sr = this.ctx.sampleRate;
    this.timer = setInterval(() => this.tick(performance.now()), TICK);
  }
  stop() { clearInterval(this.timer); if (this.inPhrase) this.endPhrase(); try { this.ctx?.close(); } catch {} }

  calibrateStart() { this.calibrating = true; this.noiseS = []; }
  calibrateEnd() {
    this.calibrating = false;
    if (this.noiseS.length > 5) this.noise = Math.min(-25, quantile(this.noiseS, 0.6));
  }
  level() { return this.lastDb ?? -100; }
  isSpeaking(ms = 4000) { return performance.now() - this.lastSound < ms; }

  pitch(buf) {
    // нормована автокореляція на сигналі, зменшеному вдвічі
    const n = buf.length >> 1, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (buf[2 * i] + buf[2 * i + 1]) / 2;
    const sr = this.sr / 2, minL = Math.floor(sr / 400), maxL = Math.min(n - 64, Math.ceil(sr / 70));
    let e0 = 0; for (let i = 0; i < n; i++) e0 += x[i] * x[i];
    if (e0 < 1e-6) return 0;
    let best = 0, bestL = 0; const r = new Float32Array(maxL + 2);
    for (let l = minL; l <= maxL + 1; l++) {
      let s = 0, e1 = 0;
      for (let i = 0; i < n - l; i++) { s += x[i] * x[i + l]; e1 += x[i + l] * x[i + l]; }
      r[l] = s / Math.sqrt(e0 * e1 + 1e-12);
    }
    for (let l = minL + 1; l <= maxL; l++) if (r[l] > best && r[l] >= r[l - 1] && r[l] >= r[l + 1]) { best = r[l]; bestL = l; }
    if (best < 0.6 || !bestL) return 0;
    // найкоротший лаг із майже максимальною кореляцією — захист від помилки октави
    for (let l = minL + 1; l < bestL; l++) if (r[l] > best * 0.92 && r[l] >= r[l - 1] && r[l] >= r[l + 1]) { bestL = l; break; }
    const a = r[bestL - 1], b = r[bestL], c = r[bestL + 1], d = a - 2 * b + c;
    const shift = d ? (a - c) / (2 * d) : 0;
    return sr / (bestL + shift);
  }

  tick(now) {
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0; for (const v of this.buf) s += v * v;
    const db = 20 * Math.log10(Math.sqrt(s / this.buf.length) + 1e-9);
    this.lastDb = db;
    if (this.calibrating) { this.noiseS.push(db); return; }
    if (!this.active) return;
    const c = this.coach;
    const sound = db > this.noise + 8;
    let p = 0;
    if (sound) {
      p = this.pitch(this.buf);
      if (p) { this.pitchHist.push(p); if (this.pitchHist.length > 3) this.pitchHist.shift(); p = quantile(this.pitchHist, 0.5); }
    } else this.pitchHist = [];
    if (now - this.lastTl >= 100 && this.timeline.length < 36000) { this.lastTl = now; this.timeline.push({ t: now, p, db }); }

    if (sound) {
      if (!this.firstSpeechAt) this.firstSpeechAt = now;
      if (!this.inPhrase) {
        const gap = now - this.lastSound;
        if (this.lastSound && gap >= GAP) {
          this.pauses.push({ t: this.lastSound, ms: gap });
          if (gap > 1500 && gap < 3000) this.st.hesitations++;
        }
        this.inPhrase = true; this.phrase = { start: now, frames: [] };
      }
      this.lastSound = now;
    }
    if (this.inPhrase) {
      this.phrase.frames.push({ t: now, db, p, sound });
      if (!sound && now - this.lastSound > GAP) this.endPhrase();
    }

    // голос «вимірюється», поки людина говорить або щойно говорила
    const live = this.firstSpeechAt && now - this.lastSound < 15000;
    if (live) c.measure('voice');
    c.set('noPause', this.inPhrase && now - this.phrase.start > this.s(15000, 20000));
    const longP = !this.inPhrase && this.firstSpeechAt && now - this.lastSound > this.s(3000, 4000) && now - this.lastSound < 15000;
    if (longP && !this.wasLong) this.st.longPauses++;
    this.wasLong = longP;
    c.set('longPause', longP);
  }

  endPhrase() {
    const ph = this.phrase; this.inPhrase = false; this.phrase = null;
    const fr = ph.frames.filter(f => f.t <= this.lastSound + TICK);
    ph.end = this.lastSound;
    const dur = ph.end - ph.start;
    const snd = fr.filter(f => f.sound), voiced = fr.filter(f => f.p > 0);
    const ps = voiced.map(f => f.p);
    ph.dur = dur;
    ph.rangeSt = ps.length >= 6 ? 12 * Math.log2(quantile(ps, 0.9) / Math.max(1, quantile(ps, 0.1))) : null;
    ph.meanPitch = ps.length ? quantile(ps, 0.5) : null;
    ph.snr = mean(snd.map(f => f.db)) - this.noise;
    const last = snd.slice(-6);
    ph.drop = snd.length > 12 ? mean(snd.map(f => f.db)) - mean(last.map(f => f.db)) : 0;
    ph.monotone = dur >= 1500 && ps.length >= 10 && ph.rangeSt < this.s(3, 1.8);
    ph.swallow = dur >= 1500 && ph.drop > this.s(8, 11);
    ph.quiet = dur >= 600 && ph.snr < this.s(15, 10);
    // «е-е»: протяжний звук зі сталою висотою і гучністю
    ph.eh = dur >= 500 && dur <= 1500 && voiced.length >= fr.length * 0.7 && ps.length >= 8 &&
      12 * Math.log2(quantile(ps, 0.9) / Math.max(1, quantile(ps, 0.1))) < 0.8 && std(snd.map(f => f.db)) < 3;
    delete ph.frames;
    this.phrases.push(ph);

    const c = this.coach, recent = this.phrases.filter(x => x.dur >= 1500).slice(-3);
    if (ph.eh) { this.st.ehs++; c.pulse('fillers', 3000, 'Замість «е-е» — просто помовч секунду'); }
    if (recent.filter(x => x.monotone).length >= 2 && ph.monotone) c.pulse('monotone', 4000);
    if (recent.filter(x => x.swallow).length >= 2 && ph.swallow) c.pulse('swallow', 3000);
    const lastTwo = this.phrases.filter(x => x.dur >= 600).slice(-2);
    c.set('quiet', lastTwo.length === 2 && lastTwo.every(x => x.quiet));
    this.onPhrase(ph);
  }

  summary() { return { ...this.st, phrases: this.phrases, timelineRef: this.timeline, pauses: this.pauses, noise: this.noise, firstSpeechAt: this.firstSpeechAt }; }
}
