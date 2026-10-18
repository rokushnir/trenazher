// Головний модуль: екрани, налаштування, керування сесією.
import { DIRS, loadPrefs, savePrefs, loadStore, saveStore, clearStore, strictness, soft, level, fmtTime } from './core.js';
import { Coach, chime, bubbles, confetti } from './coach.js';
import { loadVision, VisionAnalyzer } from './vision.js';
import { AudioAnalyzer } from './audio.js';
import { Speech, speechSupported } from './speech.js';
import { markText, findFillers, detectDevices, DEVICES, sentiment, ScriptTracker, RepeatWatch, words } from './text.js';
import { buildReport, renderReport, renderMarked, saveSession, BADGES, dayStreak } from './report.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let prefs = loadPrefs(), store = loadStore();
let cards = [], cardCats = {}, currentCard = null, scriptDoc = null;
let S = null;

const DUR = [[60, '1 хв'], [120, '2 хв'], [180, '3 хв'], [300, '5 хв'], [0, '∞']];
const PREP = [[0, '0 с'], [10, '10 с'], [30, '30 с'], [60, '60 с']];
const PROMPTER = [['prompter', 'Телесуфлер'], ['memory', 'Напам\'ять']];
const TOGGLES = [
  ['camera', 'Камера', 'поза, жести, міміка, погляд'],
  ['mic', 'Мікрофон', 'голос, паузи, темп'],
  ['speech', 'Розпізнавати слова', 'паразити, наголоси, прийоми'],
  ['silent', 'Тихий режим', 'без підказок, лише звіт'],
  ['sound', 'Звуки', 'сигнал на похвалу'],
  ['skeleton', 'Показувати скелет', 'лінії тіла поверх відео'],
];

// ================= ГОЛОВНА =================
function chips(el, opts, cur, pick) {
  el.innerHTML = opts.map(([v, l]) => `<button class="chip${v === cur ? ' on' : ''}" data-v="${v}">${l}</button>`).join('');
  el.onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const v = opts.find(o => String(o[0]) === b.dataset.v)[0];
    pick(v); savePrefs(prefs); chips(el, opts, v, pick);
  };
}

function renderHud() {
  const lv = level(store.points);
  $('#lvlNum').textContent = lv.n; $('#lvlNum2').textContent = lv.n;
  $('#lvlRing .fg').style.strokeDashoffset = 132 * (1 - lv.progress);
  $('#xpBar').style.width = (lv.progress * 100) + '%';
  $('#hudSub').textContent = `${store.points} балів · до рівня ${lv.n + 1}: ${lv.toNext}`;
  $('#streakDays').textContent = dayStreak(store.days);
}

function renderHome() {
  renderHud();
  document.querySelectorAll('.mode').forEach(b => {
    const on = b.dataset.mode === prefs.mode;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  });
  document.querySelectorAll('.mode-panel').forEach(p => p.hidden = p.dataset.for !== prefs.mode);
  $('#durRow').hidden = prefs.mode === 'card';
  chips($('#durChips'), DUR, prefs.duration, v => prefs.duration = v);
  chips($('#prepChips'), PREP, prefs.prep, v => prefs.prep = v);
  chips($('#prompterChips'), PROMPTER, prefs.prompter, v => prefs.prompter = v);
  const canSpeech = speechSupported();
  $('#toggles').innerHTML = TOGGLES.map(([k, l, d]) => {
    const dis = k === 'speech' && !canSpeech;
    return `<label class="tgl"><input type="checkbox" data-k="${k}" ${prefs[k] && !dis ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${l}<small>${dis ? 'недоступно в цьому браузері' : d}</small></span></label>`;
  }).join('');
  if (prefs.mode === 'card') renderCard();
  renderHistory();
}

function renderCard() {
  const cats = [['any', 'Будь-яка'], ...Object.entries(cardCats)];
  chips($('#catChips'), cats, prefs.category, v => { prefs.category = v; currentCard = null; drawCard(); });
  if (!currentCard) drawCard();
  const c = currentCard;
  $('#taskCard').innerHTML = c ? `<div class="cat">${esc(cardCats[c.category] || '')} · ${'★'.repeat(c.level)}${'☆'.repeat(3 - c.level)}</div>
    <h3>${esc(c.title)}</h3><p>${esc(c.prompt)}</p><div class="meta">⏱ ${fmtTime(c.duration)}</div>` : '<p>Завантажую картки…</p>';
}
function drawCard() {
  const pool = cards.filter(c => prefs.category === 'any' || c.category === prefs.category).filter(c => c !== currentCard);
  if (pool.length) currentCard = pool[Math.floor(Math.random() * pool.length)];
  if ($('#taskCard')) renderCardOnly();
}
function renderCardOnly() {
  const c = currentCard; if (!c) return;
  $('#taskCard').innerHTML = `<div class="cat">${esc(cardCats[c.category] || '')} · ${'★'.repeat(c.level)}${'☆'.repeat(3 - c.level)}</div>
    <h3>${esc(c.title)}</h3><p>${esc(c.prompt)}</p><div class="meta">⏱ ${fmtTime(c.duration)}</div>`;
}

function renderMarkupEditor() {
  const el = $('#markup');
  if (!scriptDoc) { el.hidden = true; $('#markHelp').hidden = true; return; }
  el.hidden = false; $('#markHelp').hidden = false;
  el.innerHTML = scriptDoc.map((s, si) => `<p>${renderMarked(s, true, si)}</p>`).join('');
}

function renderHistory() {
  const ss = store.sessions.slice(-12);
  $('#historyBlock').hidden = !store.sessions.length;
  $('#history').innerHTML = ss.map(s => `<div class="hb" style="height:${Math.max(4, s.overall ?? 0)}%" title="${new Date(s.date).toLocaleDateString('uk-UA')}"><span>${s.overall ?? '—'}</span></div>`).join('');
  $('#badgeShelf').innerHTML = Object.entries(BADGES).map(([id, b]) => `<span class="badge${store.badges[id] ? '' : ' off'}" title="${b.title}">${b.icon} ${b.title}</span>`).join('');
}

function bindHome() {
  document.querySelector('.modes').onclick = e => {
    const b = e.target.closest('.mode'); if (!b) return;
    prefs.mode = b.dataset.mode; savePrefs(prefs); renderHome();
  };
  $('#toggles').onchange = e => { const k = e.target.dataset.k; if (k) { prefs[k] = e.target.checked; savePrefs(prefs); } };
  $('#drawCard').onclick = () => drawCard();
  $('#markBtn').onclick = () => {
    const t = $('#scriptText').value.trim();
    if (!t) { $('#scriptText').focus(); return; }
    scriptDoc = markText(t); renderMarkupEditor();
  };
  $('#scriptText').oninput = () => { scriptDoc = null; renderMarkupEditor(); try { localStorage.setItem('trenazher.script', $('#scriptText').value); } catch {} };
  $('#markup').onclick = e => {
    const tok = e.target.closest('.tok'), gap = e.target.closest('.gap');
    const el = tok || gap; if (!el) return;
    const t = scriptDoc[+el.dataset.s].tokens[+el.dataset.t];
    if (tok) t.stress = !t.stress; else t.pause = !t.pause;
    renderMarkupEditor();
  };
  $('#clearHist').onclick = () => {
    if (!confirm('Стерти всю історію, бали й значки?')) return;
    clearStore(); store = loadStore(); renderHome();
  };
  $('#startBtn').onclick = () => startSession();
  $('#stopBtn').onclick = () => endSession();
  $('#againBtn').onclick = () => startSession();
  $('#newCardBtn').onclick = () => { drawCard(); startSession(); };
  $('#homeBtn').onclick = () => show('home');
  document.addEventListener('visibilitychange', () => { if (document.hidden && S?.active) endSession(); });
}

function show(id) {
  for (const s of ['home', 'stage', 'report']) $('#' + s).hidden = s !== id;
  if (id === 'home') renderHome();
  window.scrollTo(0, 0);
}

// ================= ОВЕРЛЕЙ НА СЦЕНІ =================
function overlay(html, actions = []) {
  $('#ovl').hidden = !html;
  $('#ovlBody').innerHTML = html || '';
  const box = $('#ovlActions'); box.innerHTML = '';
  for (const [label, cls, fn] of actions) {
    const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; box.appendChild(b);
  }
}

// ================= СЕСІЯ =================
async function startSession() {
  const p = { ...prefs };
  if (p.mode === 'script') {
    const t = $('#scriptText').value.trim();
    if (!t) { show('home'); $('#scriptText').focus(); return; }
    if (!scriptDoc) { scriptDoc = markText(t); renderMarkupEditor(); }
  }
  if (p.mode === 'card' && !currentCard) drawCard();
  if (!p.camera && !p.mic) { alert('Увімкни хоча б камеру або мікрофон.'); return; }

  show('stage');
  $('#prompter').hidden = true; $('#coach').hidden = true; $('#live').textContent = '';
  S = { p, mode: p.mode, card: p.mode === 'card' ? currentCard : null, k: strictness(store), segments: [], active: false, ended: false,
        fillerTimes: [], wordTimes: [], praisedDevices: new Set(), speechState: 'ok', lastProc: 0, procInt: 60 };
  S.duration = p.mode === 'card' ? S.card.duration : p.duration;
  overlay('<div class="spinner"></div><h2>Доступ до камери й мікрофона</h2><p class="muted">Дозволь доступ у вікні браузера. Відео не записується.</p>',
    [['Скасувати', 'ghost', () => endSession(true)]]);

  // медіа
  const vC = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
  const aC = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
  let stream = null, err = null;
  const tries = [p.camera && p.mic ? { video: vC, audio: aC } : null, p.camera ? { video: vC } : null, p.mic ? { audio: aC } : null].filter(Boolean);
  for (const c of tries) { try { stream = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e; if (e.name === 'NotAllowedError') break; } }
  if (S.ended) { stream?.getTracks().forEach(t => t.stop()); return; }
  if (!stream) {
    const denied = err?.name === 'NotAllowedError';
    overlay(`<h2>${denied ? 'Немає доступу' : 'Камеру чи мікрофон не знайдено'}</h2><p>${denied
      ? 'Дозволь доступ до камери й мікрофона в налаштуваннях браузера (значок 🔒 біля адреси сайту) і спробуй ще раз.'
      : 'Перевір, чи камера й мікрофон підключені та не зайняті іншим застосунком.'}</p>`, [['На головну', 'primary', () => endSession(true)]]);
    return;
  }
  S.stream = stream;
  const hasVideo = stream.getVideoTracks().length > 0, hasAudio = stream.getAudioTracks().length > 0;
  try { S.wake = await navigator.wakeLock?.request('screen'); } catch {}

  const coach = S.coach = new Coach({ silent: p.silent, onMessage: showMessage, onPoints: pts => $('#pts').textContent = '⭐ ' + pts });
  $('#pts').textContent = '⭐ 0'; $('#timer').textContent = '0:00';

  if (hasAudio) {
    S.audio = new AudioAnalyzer({ stream: new MediaStream(stream.getAudioTracks()), coach, k: S.k });
    try { await S.audio.start(); } catch (e) { console.warn(e); S.audio = null; }
  }
  if (hasVideo) {
    const v = $('#video'); v.srcObject = new MediaStream(stream.getVideoTracks());
    try { await v.play(); } catch {}
    overlay('<div class="spinner"></div><h2>Завантажую аналіз</h2><p class="muted">Уперше це може зайняти до хвилини (~15 МБ). Далі — миттєво.</p>',
      [['Скасувати', 'ghost', () => endSession(true)]]);
    try {
      const models = await loadVision();
      if (S.ended) return;
      S.vision = new VisionAnalyzer({ models, coach, k: S.k, video: v, canvas: $('#overlay'), skeleton: p.skeleton,
        speaking: () => S.audio ? S.audio.isSpeaking(4000) : true });
    } catch (e) { console.warn(e); S.visionError = true; }
  }
  if (S.ended) return;
  buildIndicators(hasVideo && S.vision, !!S.audio);
  requestAnimationFrame(loop);
  calibrate();
}

function loop(now) {
  if (!S || S.ended) return;
  if (S.vision && now - S.lastProc >= S.procInt) {
    const t = performance.now();
    S.vision.frame(now, S.active);
    const took = performance.now() - t;
    S.procInt = Math.min(200, Math.max(50, took * 1.6));   // слабкий пристрій → рідше
    S.lastProc = now;
  }
  requestAnimationFrame(loop);
}

function calibrate() {
  const cam = !!S.vision;
  let goodSince = 0;
  const render = () => {
    if (!S || S.ended || S.calibStep !== 1) return;
    const f = cam ? S.vision.framing() : {};
    const lv = S.audio ? Math.max(0, Math.min(100, (S.audio.level() + 70) * 1.6)) : 0;
    const item = (ok, warn, text) => `<li class="${ok ? 'ok' : warn ? 'warn' : ''}"><i>${ok ? '✓' : warn ? '!' : '…'}</i>${text}</li>`;
    $('#ovlBody').innerHTML = `<h2>Встанови телефон</h2><p class="muted">Стань на 1,5–2 м від камери так, щоб тебе було видно хоча б до пояса.</p>
      <ul class="checks">${cam ? item(f.face, false, 'Обличчя в кадрі') + item(f.shoulders, false, 'Плечі в кадрі') +
        item(f.hands, f.face && !f.hands, f.hands ? 'Руки в кадрі' : 'Руки в кадрі — відійди трохи далі') : '<li class="warn"><i>!</i>Камера вимкнена — аналізуємо лише голос</li>'}
      ${S.audio ? `<li class="${lv > 5 ? 'ok' : ''}"><i>🎙️</i><div style="flex:1"><div class="meter"><i style="width:${lv}%"></i></div></div></li>` : ''}</ul>
      ${S.visionError ? '<p class="small muted">Не вдалося завантажити аналіз відео — працюємо з голосом.</p>' : ''}`;
    const all = !cam || (f.face && f.shoulders && f.hands);
    if (all) { goodSince = goodSince || performance.now(); if (performance.now() - goodSince > 1500) return silenceStep(); } else goodSince = 0;
    setTimeout(render, 200);
  };
  S.calibStep = 1;
  overlay(' ', [['Далі', 'primary', () => silenceStep()], ['Скасувати', 'ghost', () => endSession(true)]]);
  render();
}

function silenceStep() {
  if (S.calibStep !== 1) return;
  S.calibStep = 2;
  S.vision?.calibrateStart(); S.audio?.calibrateStart();
  overlay('<h2>Дивись у камеру й помовч</h2><p class="muted">Налаштовую погляд і рівень фонового шуму…</p><p class="countdown" id="cd">2</p>');
  setTimeout(() => { const c = $('#cd'); if (c) c.textContent = '1'; }, 1000);
  setTimeout(() => {
    if (!S || S.ended) return;
    S.vision?.calibrateEnd(); S.audio?.calibrateEnd();
    if (S.mode === 'card' && S.p.prep > 0) prepStep(); else begin();
  }, 2000);
}

function prepStep() {
  S.calibStep = 3;
  let left = S.p.prep;
  const c = S.card;
  const draw = () => overlay(`<div class="task-card"><div class="cat">${esc(cardCats[c.category] || '')}</div><h3>${esc(c.title)}</h3><p>${esc(c.prompt)}</p><div class="meta">⏱ ${fmtTime(c.duration)}</div></div>
    <p class="muted" style="text-align:center">Підготуйся — старт через</p><p class="countdown">${left}</p>`, [['Почати зараз', 'primary', () => go()]]);
  const go = () => { if (S.calibStep !== 3) return; clearInterval(S.prepTimer); begin(); };
  draw();
  S.prepTimer = setInterval(() => { left--; if (left <= 0) go(); else draw(); }, 1000);
}

function begin() {
  if (!S || S.ended || S.active) return;
  S.calibStep = 4;
  overlay(null);
  const now = performance.now();
  S.coach.start(now); S.t0 = now; S.active = true;
  if (S.audio) S.audio.active = true;
  if (S.mode === 'card') S.repeat = new RepeatWatch((S.card.title + ' ' + S.card.prompt).split(/\s+/));
  else S.repeat = new RepeatWatch();
  if (S.mode === 'script') {
    S.tracker = new ScriptTracker(scriptDoc);
    if (S.p.prompter === 'prompter') renderPrompter();
  }
  if (S.p.speech && S.audio && speechSupported()) {
    S.speech = new Speech({ onFinal, onInterim, onError: e => {
      S.speechState = { 'not-allowed': 'Розпізнавання слів заборонене в браузері.', 'service-not-allowed': 'Розпізнавання слів недоступне в цьому браузері.',
        'language-not-supported': 'Браузер не розпізнає українську — аналізуємо голос без слів.', 'restart-limit': 'Розпізнавання слів часто переривалося.' }[e] || 'Розпізнавання слів недоступне.';
    } });
    if (!S.speech.start()) S.speechState = 'Розпізнавання слів не запустилося на цьому пристрої.';
  } else if (S.p.speech && S.audio) S.speechState = 'Цей браузер не вміє розпізнавати слова — аналізуємо голос без слів.';
  else S.speechState = 'ok';
  showMessage({ kind: 'praise', text: 'Поїхали! Ти зможеш 💪', effect: 'bubbles' });
  S.tickTimer = setInterval(tick, 200);
}

function tick() {
  if (!S?.active) return;
  const now = performance.now(), c = S.coach, el = (now - S.t0) / 1000;
  // мовлення «вимірюється», поки людина говорить
  if (S.audio?.isSpeaking(3000)) c.measure('improv');
  // темп за останні 30 с
  S.wordTimes = S.wordTimes.filter(w => now - w.t < 30000);
  const n = S.wordTimes.reduce((s, w) => s + w.n, 0);
  if (el > 30 && n >= 15) {
    const wpm = n * 2;
    c.set('fast', wpm > soft(S.k.voice, 160, 180));
    c.set('slow', wpm < soft(S.k.voice, 110, 95) && S.audio?.isSpeaking(2000));
  }
  c.tick(now);
  const st = c.dirStates(now);
  for (const d of Object.keys(DIRS)) { const e = $('#ind-' + d); if (e) e.className = 'ind ' + st[d]; }
  $('#timer').textContent = S.duration ? fmtTime(Math.max(0, S.duration - el)) : fmtTime(el);
  if (S.duration && el >= S.duration) endSession();
  if (S.tracker && S.tracker.pos >= S.tracker.flat.length) { S.doneAt = S.doneAt || now; if (now - S.doneAt > 2500) endSession(); }
}

function onFinal({ text, start, end }) {
  if (!S?.active) return;
  const now = performance.now(), c = S.coach, k = S.k.improv;
  S.segments.push({ text, start, end });
  $('#live').textContent = text;
  S.wordTimes.push({ t: now, n: words(text).length });
  // паразити
  const f = findFillers(text);
  f.forEach(() => S.fillerTimes.push(now));
  S.fillerTimes = S.fillerTimes.filter(t => now - t < 60000);
  if (f.length && S.fillerTimes.length >= soft(k, 3, 5)) c.pulse('fillers', 3000, `Слово-паразит «${f[0]}» — заміни його паузою`);
  // повтори
  const rep = S.repeat.feed(text, now);
  if (rep) c.pulse('repeats', 3000, `Повторюєш «${rep}» — пошукай синонім`);
  // прийоми — похвала за перше використання кожного
  for (const d of detectDevices(text)) if (!S.praisedDevices.has(d)) { S.praisedDevices.add(d); c.praise(DEVICES[d].praise, 5); }
  // міміка vs слова
  const s = sentiment(text), mood = S.vision?.moodAround(now, 2500 + (end - start));
  if (mood && s > 0 && mood.smileMax < 0.2) c.pulse('mismatch', 3500, 'Говориш про приємне, а обличчя серйозне — усміхнись');
  if (mood && s < 0 && mood.smileMax > 0.6) c.pulse('mismatch', 3500, 'Сумна тема, а на обличчі широка усмішка');
  // телесуфлер
  if (S.tracker) { S.tracker.feed(text, true); updatePrompter(S.tracker.pos); }
}

function onInterim(text) {
  if (!S?.active) return;
  $('#live').textContent = text;
  if (S.tracker) updatePrompter(S.tracker.feed(text, false));
}

function renderPrompter() {
  let i = 0;
  $('#prompterText').innerHTML = scriptDoc.map(s => s.tokens.map((t, ti) => {
    const w = esc(t.w), inner = t.stress ? `<b>${w}</b>` : w;
    return `${ti > 0 && t.pause ? '<span class="pz">‖</span> ' : ''}<span class="w" data-i="${i++}">${inner}${t.up ? '↗' : ''}</span> `;
  }).join('') + (s.tone === 'up' ? '↗ ' : '') + '<span class="pz">‖</span> ').join('');
  $('#prompter').hidden = false;
  updatePrompter(0);
}
function updatePrompter(pos) {
  if (!S?.tracker || S.p.prompter !== 'prompter') return;
  const box = $('#prompterText');
  box.querySelectorAll('.w').forEach(w => { const i = +w.dataset.i; w.classList.toggle('done', i < pos); w.classList.toggle('cur', i === pos); });
  const cur = box.querySelector(`.w[data-i="${pos}"]`) || box.querySelector('.w:last-child');
  if (cur) box.style.transform = `translateY(${-Math.max(0, cur.offsetTop - 8)}px)`;
}

function buildIndicators(cam, mic) {
  const avail = { face: cam, gaze: cam, posture: cam, distance: cam, voice: mic, improv: mic };
  $('#inds').innerHTML = Object.entries(DIRS).map(([d, v]) =>
    `<div class="ind off" id="ind-${d}" ${avail[d] ? '' : 'style="visibility:hidden"'}><span>${v.icon}</span>${v.label.split(' ')[0]}</div>`).join('');
}

let msgTimer;
function showMessage({ kind, text, effect }) {
  if (!S || S.ended) return;
  const el = $('#coach');
  el.hidden = false; el.className = 'coach ' + kind; el.textContent = text;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => el.hidden = true, kind === 'tip' ? 4500 : 3000);
  if (kind === 'praise') {
    if (effect === 'confetti') confetti($('#fx'), 50); else bubbles($('#fx'), 10);
    if (S.p.sound) chime(effect === 'confetti' ? 'big' : 'praise');
  } else if (S.p.sound) chime('tip');
}

async function endSession(cancel = false) {
  if (!S || S.ended) { if (cancel) show('home'); return; }
  const was = S; was.ended = true;
  const began = was.active; was.active = false;
  clearInterval(was.tickTimer); clearInterval(was.prepTimer);
  was.speech?.stop();
  was.audio?.stop();
  was.stream?.getTracks().forEach(t => t.stop());
  $('#video').srcObject = null;
  try { await was.wake?.release(); } catch {}
  overlay(null);
  if (cancel || !began) { S = null; show('home'); return; }
  const durationS = (performance.now() - was.t0) / 1000;
  if (was.audio && !was.segments.length && was.speech && was.audio.phrases.length >= 5 && was.speechState === 'ok')
    was.speechState = 'Розпізнавання слів не дало результату на цьому пристрої — оцінено голос без слів.';
  const r = buildReport({ coach: was.coach, vision: was.vision, audio: was.audio, segments: was.segments, mode: was.mode, card: was.card,
    script: was.tracker ? { tracker: was.tracker } : null, k: was.k, store, durationS, speechState: was.speechState });
  saveSession(store, r); saveStore(store);
  S = null;
  show('report');
  $('#newCardBtn').hidden = was.mode !== 'card';
  renderReport($('#reportBody'), r, store);
  if ((r.overall ?? 0) >= 70 || r.newBadges.length) { confetti($('#fxReport'), 80); if (was.p.sound) chime('big'); }
}

// ================= СТАРТ =================
async function init() {
  try { $('#scriptText').value = localStorage.getItem('trenazher.script') || ''; } catch {}
  bindHome();
  renderHome();
  try {
    const data = await (await fetch('cards.json')).json();
    cards = data.cards; cardCats = data.categories;
    if (prefs.mode === 'card') renderCard();
  } catch (e) { console.warn('cards', e); }
  if (!navigator.mediaDevices?.getUserMedia) {
    $('#startBtn').disabled = true;
    $('#startBtn').textContent = 'Потрібен HTTPS і сучасний браузер';
  }
}
init();
