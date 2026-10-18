// Оцінки, звіт після сесії, значки та історія.
import { DIRS, ISSUES, clamp, mean, quantile, fmtTime, todayKey, level } from './core.js';
import { markSentence, improvSummary, DEVICES, stressedWords } from './text.js';
import { GRIMACE_NAMES } from './vision.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const EXERCISES = {
  crossed: 'Почни виступ із жесту «відкриті долоні» й тримай руки вище пояса, не складаючи їх.',
  clasped: 'Тримай у руці легкий предмет (ручку) лише першу хвилину, потім відклади й говори долонями.',
  hidden: 'Перед дзеркалом проговори 3 речення, супроводжуючи кожне жестом долонями до глядача.',
  fewGest: 'Вправа «Розмір»: описуй предмети — великий, маленький, круглий, довгий — і показуй їх руками.',
  sluggish: 'Вправа «Удар»: на кожному наголошеному слові — чіткий жест, що завершується в точці.',
  chaotic: 'Вправа «Стоп-кадр»: після кожного жесту поверни руки в нейтральну позицію на 2 секунди.',
  lowZone: 'Уяви «рамку» від пояса до плечей — жести лише в ній.',
  faceTouch: 'Тримай руки в нейтральній позиції на рівні пупка — так їм не захочеться до обличчя.',
  shoulders: 'Перед стартом: плечі вгору — назад — вниз. Перевір дзеркалом.',
  headDown: 'Наклей стікер біля камери й «розмовляй» із ним.',
  noContact: 'Вправа «Одне речення — один погляд»: договорюй кожне речення, дивлячись у камеру.',
  shifty: 'Обери точку на камері й тримай погляд на ній, поки не завершиш думку.',
  frozen: 'Читай казку дитині: перебільшуй емоції — здивування, радість, страх.',
  noSmile: 'Почни й заверши виступ усмішкою — навіть якщо тема серйозна.',
  grimace: 'Запиши себе на 30 секунд і перегляни без звуку — помічай «зайві» рухи губ і брів.',
  mismatch: 'Перед важливими словами «увімкни» відповідну емоцію на обличчі на секунду раніше за слово.',
  blinks: 'Перед стартом зроби 3 повільні видихи — це знижує хвилювання.',
  outOfFrame: 'Позначь на підлозі зону, в якій тебе видно в кадрі.',
  tooFar: 'Стань так, щоб у кадрі було видно тебе до пояса.',
  tooClose: 'Відійди так, щоб у кадрі були видні руки.',
  pendulum: 'Вправа «Три точки»: переходь лише між смисловими блоками й стій на кожній точці щонайменше 3 с.',
  quiet: 'Говори так, ніби слухач — у дальньому кутку кімнати.',
  monotone: 'Вправа «Одне речення — три сенси»: скажи «Я сьогодні виступаю» з наголосом на кожному слові по черзі.',
  swallow: 'Договорюй останнє слово фрази так, ніби воно найважливіше, і лише потім роби паузу.',
  noPause: 'Став паузу ‖ після кожного речення — порахуй подумки «раз-два».',
  longPause: 'Готуй «місток»: фразу, яка дає час подумати («Цікаве питання — і ось чому…»).',
  fast: 'Читай текст уголос під метроном 120 ударів — одне слово на удар.',
  slow: 'Перекажи історію за 30 секунд замість хвилини.',
  fillers: 'Щойно помічаєш паразит — заміни його паузою. Тиша звучить упевнено.',
  repeats: 'Склади до ключового слова 3 синоніми перед виступом.',
  hesitate: 'Вправа «Слово-ланцюжок»: говори 1 хвилину, починаючи кожне речення з останнього слова попереднього.',
};

export const BADGES = {
  first:  { icon: '🎤', title: 'Перший виступ' },
  clean:  { icon: '✨', title: 'Хвилина без паразитів' },
  pauses: { icon: '⏸️', title: 'Майстер пауз' },
  eye:    { icon: '👁️', title: 'Залізний контакт очима' },
  open:   { icon: '🙌', title: 'Відкрита поза' },
  improv: { icon: '🎲', title: 'Імпровізатор' },
  script: { icon: '📜', title: 'Слово в слово' },
  days3:  { icon: '🔥', title: '3 дні поспіль' },
  days5:  { icon: '🏆', title: '5 днів поспіль' },
};

export function dayStreak(days) {
  const set = new Set(days); let n = 0; const d = new Date();
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function buildReport(x) {
  const { coach, vision, audio, segments, mode, card, script, k, store, durationS, speechState } = x;
  const v = vision?.summary(), a = audio?.summary();
  const minutes = Math.max(0.25, durationS / 60);
  const K = d => k[d] ?? 0;
  const timeScore = d => {
    const m = coach.measuredMs[d];
    if (m < 5000) return null;
    return clamp(100 - (coach.badMs[d] / m) * 100 * (0.6 + 0.6 * K(d)), 0, 100);
  };
  const dirs = {};
  // поза, дистанція — за часом без проблем
  dirs.posture = timeScore('posture');
  dirs.distance = timeScore('distance');
  // погляд — і за часом, і за часткою контакту
  if (v && v.faceFrames > 30) {
    const cf = v.contactFrames / v.faceFrames;
    dirs.gaze = Math.min(timeScore('gaze') ?? 100, clamp(100 * cf / (0.6 + 0.25 * K('gaze')), 0, 100));
    const grimPerMin = Object.values(v.grimaces).reduce((s, n) => s + n, 0) / minutes;
    const smileF = v.smileFrames / v.faceFrames;
    dirs.face = timeScore('face') == null ? null : clamp((timeScore('face')) - grimPerMin * (3 + 3 * K('face')) + (smileF > 0.1 ? 5 : 0), 0, 100);
  } else { dirs.gaze = null; dirs.face = null; }
  // голос — за фразами
  const ph = (a?.phrases || []).filter(p => p.dur >= 1500);
  if (ph.length >= 3) {
    const fr = key => ph.filter(p => p[key]).length / ph.length;
    const phraseScore = 100 - (fr('monotone') * 45 + fr('swallow') * 20 + fr('quiet') * 25) * (0.7 + 0.5 * K('voice')) - a.longPauses * 3;
    dirs.voice = clamp(0.5 * phraseScore + 0.5 * (timeScore('voice') ?? phraseScore), 0, 100);
  } else dirs.voice = timeScore('voice');
  // мовлення
  const exclude = card ? (card.title + ' ' + card.prompt).split(/\s+/) : [];
  const imp = improvSummary(segments, exclude);
  const hasWords = imp.words >= 20;
  if (hasWords || (a && a.phrases.length >= 3)) {
    let s = 100;
    s -= (imp.fillerTotal / minutes) * (5 + 5 * K('improv'));
    s -= ((a?.ehs || 0) / minutes) * (4 + 4 * K('improv'));
    s -= ((a?.hesitations || 0) / minutes) * 3;
    if (hasWords) {
      s -= imp.topRepeats.length * 3;
      s += Math.min(15, Object.values(imp.devices).filter(n => n > 0).length * 3 + Object.values(imp.structure).filter(Boolean).length * 3);
      if (imp.diversity < 0.5) s -= 10;
    }
    dirs.improv = clamp(s, 0, 100);
  } else dirs.improv = null;
  for (const d in dirs) if (dirs[d] != null) dirs[d] = Math.round(dirs[d]);
  const scored = Object.values(dirs).filter(s => s != null);
  const overall = scored.length ? Math.round(mean(scored)) : null;

  // головна проблема кожного напряму
  const mainIssue = d => Object.entries(ISSUES).filter(([id, def]) => def.dir === d && coach.issueMs[id])
    .sort((p, q) => coach.issueMs[q[0]] - coach.issueMs[p[0]])[0]?.[0];

  const good = [], work = [];
  const goodText = {
    posture: 'Відкрита поза й живі жести',
    gaze: v && v.faceFrames ? `Контакт очима ${Math.round(100 * v.contactFrames / v.faceFrames)}% часу` : 'Впевнений погляд',
    face: 'Жива, виразна міміка',
    distance: v?.moves ? `Осмислені переміщення: ${v.moves}` : 'Стійка позиція в кадрі',
    voice: 'Виразна інтонація й гучність',
    improv: imp.fillerTotal === 0 && hasWords ? 'Мовлення без слів-паразитів' : 'Плавне мовлення',
  };
  Object.entries(dirs).filter(([, s]) => s != null).sort((p, q) => q[1] - p[1]).forEach(([d, s]) => {
    if (s >= 75 && good.length < 3) good.push({ d, text: goodText[d] });
  });
  Object.entries(dirs).filter(([, s]) => s != null && s < 80).sort((p, q) => p[1] - q[1]).slice(0, 3).forEach(([d]) => {
    const id = mainIssue(d);
    if (id) work.push({ d, text: ISSUES[id].tip, ex: EXERCISES[id] });
  });
  if (!good.length && scored.length) good.push({ d: null, text: 'Виступ завершено — це вже половина успіху!' });

  // значки
  const badges = [];
  const has = id => store.badges[id];
  if (!store.sessions.length) badges.push('first');
  if (hasWords && imp.fillerTotal === 0 && (a?.ehs || 0) === 0 && durationS >= 60) badges.push('clean');
  if (a && a.pauses.filter(p => p.ms >= 400 && p.ms < 3000).length >= 5 && !coach.issueCount.noPause) badges.push('pauses');
  if (dirs.gaze >= 85) badges.push('eye');
  if (dirs.posture >= 90 && !coach.issueCount.crossed) badges.push('open');
  if (mode === 'card' && overall >= 80) badges.push('improv');
  const days = [...new Set([...store.days, todayKey()])];
  const streak = dayStreak(days);
  if (streak >= 3) badges.push('days3');
  if (streak >= 5) badges.push('days5');
  const newBadges = badges.filter(b => !has(b));

  // транскрипт із розміткою та нотатками
  const phrases = a?.phrases || [];
  const segHtml = segments.map(sg => {
    const m = markSentence(sg.text);
    const linked = phrases.filter(p => p.end >= sg.start - 600 && p.start <= sg.end + 200 && p.dur >= 1500);
    const notes = [];
    const st = stressedWords(m);
    if (linked.some(p => p.monotone)) notes.push(st.length ? `Фраза прозвучала рівно — виділи голосом «${esc(st[0])}»` : 'Фраза прозвучала рівно — додай інтонації');
    if (linked.some(p => p.swallow)) notes.push('Кінець фрази «проковтнуто»');
    if (linked.some(p => p.quiet)) notes.push('Тихо');
    return `<p class="seg">${renderMarked(m)}${notes.length ? `<span class="seg-notes">${notes.map(n => `<em>${n}</em>`).join('')}</span>` : ''}</p>`;
  }).join('');

  const scriptRes = script?.tracker?.result();
  if (scriptRes?.total && scriptRes.said / scriptRes.total >= 0.9 && !has('script')) newBadges.push('script');

  const prev = store.sessions[store.sessions.length - 1];
  return { overall, dirs, good, work, imp, hasWords, newBadges, streak, segHtml, prev, mode, card, durationS,
    v, a, scriptRes, speechState, events: coach.events, points: coach.points, praises: coach.praises,
    kLevel: Math.round(mean(Object.keys(DIRS).map(K)) * 10), t0: coach.t0 };
}

export function renderMarked(m, editable = false, si = 0) {
  const parts = m.tokens.map((t, ti) => {
    const gap = ti > 0 ? (editable ? `<button class="gap${t.pause ? ' on' : ''}" data-s="${si}" data-t="${ti}" aria-label="пауза">${t.pause ? '‖' : ''}</button>` : (t.pause ? '<span class="pz">‖</span> ' : ' ')) : '';
    let w = esc(t.w);
    if (t.filler) w = `<mark>${w}</mark>`;
    else if (t.stress) w = `<b>${w}</b>`;
    if (t.up) w += '<span class="tn">↗</span>';
    if (editable) w = `<span class="tok${t.stress ? ' st' : ''}" data-s="${si}" data-t="${ti}">${w}</span>`;
    return gap + w;
  });
  return parts.join('') + `<span class="tn">${m.tone === 'up' ? ' ↗' : ' ↘'}</span>`;
}

export function saveSession(store, r) {
  store.sessions.push({ date: new Date().toISOString(), mode: r.mode, dur: Math.round(r.durationS), overall: r.overall, dirs: r.dirs });
  if (store.sessions.length > 100) store.sessions.shift();
  for (const [d, s] of Object.entries(r.dirs)) if (s != null) store.dirCounts[d] = (store.dirCounts[d] || 0) + 1;
  store.points += r.points + r.newBadges.length * 50;
  store.days = [...new Set([...store.days, todayKey()])].slice(-60);
  for (const b of r.newBadges) store.badges[b] = todayKey();
}

const dirRow = (d, s, prevS) => {
  const delta = s != null && prevS != null ? s - prevS : null;
  return `<div class="dir-row"><span class="dir-ic">${DIRS[d].icon}</span><span class="dir-name">${DIRS[d].label}</span>
    <span class="dir-bar"><i style="width:${s ?? 0}%" class="${s == null ? '' : s >= 75 ? 'g' : s >= 50 ? 'y' : 'r'}"></i></span>
    <b class="dir-val">${s == null ? '—' : s}</b>${delta ? `<small class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</small>` : '<small></small>'}</div>`;
};

export function renderReport(el, r, store) {
  const lv = level(store.points);
  const grim = r.v ? Object.entries(r.v.grimaces).map(([k, n]) => `${GRIMACE_NAMES[k]} ×${n}`).join(', ') : '';
  const facts = [];
  if (r.v?.faceFrames) facts.push(['Контакт очима', Math.round(100 * r.v.contactFrames / r.v.faceFrames) + '%']);
  if (r.v?.faceFrames) facts.push(['Усмішка', Math.round(100 * r.v.smileFrames / r.v.faceFrames) + '% часу']);
  if (r.v?.poseFrames && r.v.handsFrames) facts.push(['Жестикуляція', Math.round(100 * r.v.movingFrames / Math.max(1, r.v.handsFrames)) + '% часу']);
  if (r.v?.poseFrames && !r.v.handsEver) facts.push(['Руки', 'не потрапили в кадр — відійди далі']);
  if (grim) facts.push(['Гримаси', grim]);
  if (r.a?.phrases.length) {
    const rs = r.a.phrases.filter(p => p.rangeSt != null).map(p => p.rangeSt);
    if (rs.length) facts.push(['Діапазон інтонації', `${quantile(rs, 0.5).toFixed(1)} півтона (норма ≥ 3)`]);
    facts.push(['Паузи', `${r.a.pauses.filter(p => p.ms >= 400).length}`]);
  }
  if (r.hasWords) {
    const speakMin = Math.max(0.25, r.durationS / 60);
    facts.push(['Темп', `${Math.round(r.imp.words / speakMin)} слів/хв (норма 110–160)`]);
    facts.push(['Слова-паразити', r.imp.fillerTotal ? Object.entries(r.imp.fillers).map(([w, n]) => `«${esc(w)}» ×${n}`).join(', ') : 'немає 🎉']);
    facts.push(['Багатство мови', Math.round(r.imp.diversity * 100) + '% унікальних слів']);
    const dev = Object.entries(r.imp.devices).filter(([, n]) => n).map(([kk, n]) => `${DEVICES[kk].label.toLowerCase()} ×${n}`);
    facts.push(['Прийоми', dev.length ? dev.join(', ') : 'ще не використано — спробуй запитання чи приклад']);
    const sct = r.imp.structure;
    facts.push(['Структура', `${sct.intro ? '✓' : '✗'} вступ · ${sct.transition ? '✓' : '✗'} переходи · ${sct.conclusion ? '✓' : '✗'} висновок`]);
  }
  if (r.a?.ehs) facts.push(['«е-е» у голосі', '×' + r.a.ehs]);
  if (r.scriptRes?.total) {
    facts.push(['Текст', `сказано ${Math.round(100 * r.scriptRes.said / r.scriptRes.total)}% слів, пропущено ${r.scriptRes.missed}`]);
    if (r.scriptRes.pauses) facts.push(['Паузи за розміткою', `${r.scriptRes.pausesKept} з ${r.scriptRes.pauses}`]);
  }

  const evs = r.events.filter(e => e.kind === 'issue').slice(0, 25);
  const headline = r.overall == null ? 'Замало даних для оцінки' : r.overall >= 85 ? 'Блискуче! 🔥' : r.overall >= 70 ? 'Дуже добре! 💪' : r.overall >= 50 ? 'Гарний старт! 🙂' : 'Початок покладено! 🌱';
  el.innerHTML = `
  <section class="rep-hero card">
    <div class="score-ring" style="--p:${r.overall ?? 0}"><b>${r.overall ?? '—'}</b><small>зі 100</small></div>
    <div>
      <h2>${headline}</h2>
      <p class="muted">${fmtTime(r.durationS)} · ${r.mode === 'card' ? 'картка «' + esc(r.card.title) + '»' : r.mode === 'script' ? 'промова за текстом' : 'вільна тема'} · +${r.points} балів</p>
      ${r.prev?.overall != null && r.overall != null ? `<p class="cmp ${r.overall >= r.prev.overall ? 'up' : 'down'}">${r.overall >= r.prev.overall ? '▲' : '▼'} ${Math.abs(r.overall - r.prev.overall)} порівняно з минулою сесією</p>` : ''}
      <p class="muted small">Рівень вимогливості: ${Math.max(1, r.kLevel)}/10 — далі буде складніше 😉 · Рівень ${lv.n}</p>
    </div>
  </section>
  ${r.newBadges.length ? `<section class="card badges-new"><h3>Нові значки!</h3><div class="badges">${r.newBadges.map(b => `<span class="badge pop">${BADGES[b].icon} ${BADGES[b].title}</span>`).join('')}</div></section>` : ''}
  <section class="card"><h3>Шість напрямів</h3>${Object.keys(DIRS).map(d => dirRow(d, r.dirs[d], r.prev?.dirs?.[d])).join('')}
    ${r.speechState && r.speechState !== 'ok' ? `<p class="muted small">ℹ️ ${esc(r.speechState)}</p>` : ''}</section>
  <div class="two">
    <section class="card good"><h3>Що вийшло добре</h3><ul>${r.good.map(g => `<li>${g.d ? DIRS[g.d].icon : '⭐'} ${g.text}</li>`).join('') || '<li>Продовжуй — усе попереду!</li>'}</ul></section>
    <section class="card work"><h3>Над чим попрацювати</h3><ul>${r.work.map(w => `<li><b>${DIRS[w.d].icon} ${w.text}</b><span>Вправа: ${w.ex}</span></li>`).join('') || '<li>Зауважень майже немає — спробуй довшу сесію чи складнішу картку!</li>'}</ul></section>
  </div>
  <section class="card"><h3>Цифри</h3><dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl></section>
  ${r.a?.phrases.length ? `<section class="card"><h3>Голос у часі</h3><canvas id="voiceChart" height="160"></canvas><p class="legend"><span class="lg p"></span>висота тону <span class="lg d"></span>гучність</p></section>` : ''}
  ${r.segHtml ? `<section class="card"><h3>Транскрипт із розміткою</h3><p class="muted small"><b>жирним</b> — логічний наголос · ‖ — пауза · ↗ ↘ — інтонація · <mark>паразити</mark></p><div class="transcript">${r.segHtml}</div></section>` : ''}
  ${evs.length ? `<section class="card"><h3>Хронологія зауважень</h3><ul class="timeline">${evs.map(e => `<li><time>${fmtTime(e.t)}</time>${esc(e.text)}</li>`).join('')}</ul></section>` : ''}
  `;
  const cv = el.querySelector('#voiceChart');
  if (cv) drawVoice(cv, r.a, r.t0);
}

function drawVoice(cv, a, t0) {
  const tl = a.timelineRef || [];
  const W = cv.clientWidth || 600, H = 160, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  if (!tl.length) return;
  const tMin = tl[0].t, tMax = tl[tl.length - 1].t || tMin + 1;
  const ps = tl.filter(f => f.p > 0).map(f => f.p);
  const med = quantile(ps, 0.5) || 150;
  const X = t => ((t - tMin) / (tMax - tMin || 1)) * (W - 8) + 4;
  const css = getComputedStyle(document.documentElement);
  x.strokeStyle = css.getPropertyValue('--line'); x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
  x.strokeStyle = css.getPropertyValue('--blue'); x.globalAlpha = 0.5; x.beginPath();
  tl.forEach((f, i) => { const y = H - clamp((f.db + 70) / 60, 0, 1) * H; i ? x.lineTo(X(f.t), y) : x.moveTo(X(f.t), y); });
  x.stroke(); x.globalAlpha = 1;
  x.fillStyle = css.getPropertyValue('--green-deep');
  for (const f of tl) if (f.p > 0) { const st = 12 * Math.log2(f.p / med); x.fillRect(X(f.t) - 1, H / 2 - clamp(st, -8, 8) * (H / 18) - 1, 2.5, 2.5); }
}
