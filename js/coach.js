// Тренер: збирає стан проблем від аналізаторів, вирішує, коли підказати чи похвалити,
// рахує «поганий» час за напрямами та бали.
import { DIRS, ISSUES, STREAK_PRAISE } from './core.js';

const TIP_GAP = 6000, SAME_TIP_GAP = 20000, QUIET_START = 10000, FIX_HOLD = 5000, STREAK_MS = 15000;

export class Coach {
  constructor({ silent = false, onMessage = () => {}, onPoints = () => {} } = {}) {
    this.silent = silent;
    this.onMessage = onMessage;
    this.onPoints = onPoints;
    this.state = {};          // id → { on, text }
    this.pulseUntil = {};     // id → timestamp
    this.activeSince = {};
    this.lastShown = {};
    this.tipped = {};         // id → час останньої підказки (чекаємо виправлення)
    this.lastMeasured = {};
    this.measuredMs = {}; this.badMs = {}; this.issueMs = {}; this.issueCount = {};
    for (const d of Object.keys(DIRS)) { this.measuredMs[d] = 0; this.badMs[d] = 0; }
    this.events = [];
    this.points = 0;
    this.pointFrac = 0;
    this.praises = 0;
  }

  start(now) { this.t0 = now; this.lastTick = now; this.lastMsg = now - TIP_GAP; this.streakFrom = now; }
  elapsed(now) { return (now - this.t0) / 1000; }

  set(id, on, text) { const s = this.state[id] || (this.state[id] = {}); s.on = !!on; if (text) s.text = text; }
  pulse(id, ms, text) {
    this.pulseUntil[id] = performance.now() + ms;
    if (text) (this.state[id] || (this.state[id] = {})).text = text;
  }
  measure(dir) { this.lastMeasured[dir] = performance.now(); }
  isOn(id, now) { return !!(this.state[id]?.on) || (this.pulseUntil[id] || 0) > now; }

  praise(text, pts = 5, effect = 'bubbles') {
    this.addPoints(pts);
    this.praises++;
    this.events.push({ t: this.elapsed(performance.now()), kind: 'praise', text });
    if (!this.silent) this.onMessage({ kind: 'praise', text, pts, effect });
  }
  addPoints(p) { this.points += p; this.onPoints(this.points); }

  dirStates(now) {
    const out = {};
    for (const d of Object.keys(DIRS)) {
      if (now - (this.lastMeasured[d] || -1e9) > 1500) { out[d] = 'off'; continue; }
      let worst = 'good';
      for (const [id, def] of Object.entries(ISSUES)) {
        if (def.dir !== d || !this.isOn(id, now)) continue;
        worst = now - (this.activeSince[id] || now) > 3000 ? 'bad' : (worst === 'bad' ? 'bad' : 'warn');
      }
      out[d] = worst;
    }
    return out;
  }

  tick(now) {
    const dt = now - this.lastTick; this.lastTick = now;
    const measured = new Set(Object.keys(DIRS).filter(d => now - (this.lastMeasured[d] || -1e9) < 1500));
    const badDirs = new Set();
    const active = [];
    for (const [id, def] of Object.entries(ISSUES)) {
      const on = this.isOn(id, now) && measured.has(def.dir);
      if (on) {
        if (!this.activeSince[id]) {
          this.activeSince[id] = now;
          this.issueCount[id] = (this.issueCount[id] || 0) + 1;
          const text = this.state[id]?.text || def.tip, last = this.lastLogged?.[id];
          if (!last || now - last.at > 10000 || last.text !== text) this.events.push({ t: this.elapsed(now), kind: 'issue', id, text });
          (this.lastLogged = this.lastLogged || {})[id] = { at: now, text };
        }
        this.issueMs[id] = (this.issueMs[id] || 0) + dt;
        badDirs.add(def.dir);
        active.push(id);
      } else if (this.activeSince[id]) {
        this.activeSince[id] = 0;
        this.fixedAt = this.fixedAt || {};
        this.fixedAt[id] = now;
      }
      // похвала за виправлення: проблему підказали, а тепер її немає вже FIX_HOLD
      if (this.tipped[id] && !on && measured.has(def.dir) && this.fixedAt?.[id] && now - this.fixedAt[id] > FIX_HOLD) {
        delete this.tipped[id];
        if (def.praise) this.praise(def.praise + ' +10', 10, 'bubbles');
      }
    }
    for (const d of measured) { this.measuredMs[d] += dt; if (badDirs.has(d)) this.badMs[d] += dt; }

    // бали: секунда в «зеленій зоні» = 1 бал
    if (measured.size && !badDirs.size) {
      this.pointFrac += dt / 1000;
      if (this.pointFrac >= 1) { const p = Math.floor(this.pointFrac); this.pointFrac -= p; this.addPoints(p); }
    }

    // серія без зауважень
    if (badDirs.size || !measured.size) this.streakFrom = now;
    else if (now - this.streakFrom > STREAK_MS) {
      this.streakFrom = now;
      this.praise(STREAK_PRAISE[Math.floor(Math.random() * STREAK_PRAISE.length)] + ' +15', 15, 'confetti');
    }

    // підказка
    if (this.silent || now - this.t0 < QUIET_START || now - this.lastMsg < TIP_GAP) return;
    active.sort((a, b) => ISSUES[a].prio - ISSUES[b].prio);
    for (const id of active) {
      if (now - (this.lastShown[id] || -1e9) < SAME_TIP_GAP) continue;
      this.lastShown[id] = now; this.lastMsg = now; this.tipped[id] = now;
      if (this.fixedAt) delete this.fixedAt[id];
      this.onMessage({ kind: 'tip', text: this.state[id]?.text || ISSUES[id].tip, dir: ISSUES[id].dir });
      break;
    }
  }

  noteMessageShown(now) { this.lastMsg = now; }
}

// ---------- ефекти ----------
let actx;
export function chime(kind = 'praise') {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'praise' ? [660, 880] : kind === 'big' ? [523, 659, 784, 1047] : [440];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = actx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.4);
    });
  } catch {}
}

export function bubbles(container, n = 10) {
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    b.className = 'fx-bubble';
    const s = 10 + Math.random() * 26;
    b.style.cssText = `left:${5 + Math.random() * 90}%;width:${s}px;height:${s}px;animation-delay:${Math.random() * .4}s;animation-duration:${1.6 + Math.random() * 1.2}s`;
    container.appendChild(b);
    setTimeout(() => b.remove(), 3500);
  }
}

export function confetti(container, n = 60) {
  const colors = ['#3fd49f', '#f5b82e', '#4d8dff', '#ff5c9a', '#8b5cf6', '#ef5b5b'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.className = 'fx-confetti';
    c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * .5}s;animation-duration:${1.8 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg)`;
    container.appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}
