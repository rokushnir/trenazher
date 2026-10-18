// Аналіз тексту мовлення без ШІ: слова-паразити, повтори, прийоми, розмітка наголосів і пауз.

const norm = w => w.toLowerCase().replace(/[’ʼ`]/g, "'").replace(/[^a-zа-яіїєґ0-9'\-]/gi, '').replace(/^-+|-+$/g, '');
export const words = text => text.split(/\s+/).map(norm).filter(Boolean);
const stem = w => w.slice(0, Math.max(4, Math.min(6, w.length - 2)));

const STOP = new Set(('і й та а але чи що як де коли хто це той та те ті цей ця ці цього цієї цим ним нею них їх його її їм йому їй ' +
  'я ти він вона воно ми ви вони мене тебе себе мені тобі собі нас вас нам вам мною тобою собою ' +
  'в у на з із зі до від по за під над про при для без через між біля після перед коло ' +
  'не ні так же ж би б бо то ще вже теж також тут там все всі усі весь вся був була було були є буде будуть бути ' +
  'мій моя моє мої твій твоя наш наша ваш ваша свій своя який яка яке які якого якої якщо щоб коли тоді ' +
  'дуже більш менш просто можна треба потрібно може можу хочу хоче тому отже ось от ну типу').split(' '));
const isContent = w => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w);

// ---------- слова-паразити ----------
const FILLERS_MULTI = ['так би мовити', 'в принципі', 'як би', 'як його', 'щось типу', 'так от', 'коротше кажучи', 'на самому ділі'];
const FILLERS_ONE = new Set(['ну', 'типу', 'короче', 'коротше', 'значить', 'ніби', 'нібито', 'власне', 'реально', 'блін', 'е', 'ее', 'еее', 'ем', 'мм', 'ммм', 'ааа', 'загалом-то', 'як-би']);
export function findFillers(text) {
  const ws = words(text), out = [];
  const joined = ' ' + ws.join(' ') + ' ';
  for (const f of FILLERS_MULTI) { let i = 0; while ((i = joined.indexOf(' ' + f + ' ', i)) !== -1) { out.push(f); i += f.length; } }
  for (const w of ws) if (FILLERS_ONE.has(w)) out.push(w);
  return out;
}
const fillerIdx = tokens => {
  const s = new Set();
  tokens.forEach((t, i) => {
    if (FILLERS_ONE.has(t.n)) s.add(i);
    for (const f of FILLERS_MULTI) {
      const parts = f.split(' ');
      if (parts.every((p, k) => tokens[i + k]?.n === p)) parts.forEach((_, k) => s.add(i + k));
    }
  });
  return s;
};

// ---------- прийоми ----------
const QWORDS = new Set(['чи', 'чому', 'як', 'що', 'де', 'коли', 'хто', 'навіщо', 'скільки', 'який', 'яка', 'які', 'яке', 'куди', 'звідки', 'хіба', 'невже']);
export const DEVICES = {
  question: { label: 'Риторичні запитання', praise: 'Запитання до аудиторії — клас! +5' },
  example:  { label: 'Приклади', re: /(^| )(наприклад|уяви|уявіть|скажімо|приміром|ось приклад)/, praise: 'Приклад — так переконливіше! +5' },
  numbers:  { label: 'Числа й факти', re: /(\d|відсот|мільйон|тисяч|половин)/, praise: 'Цифри й факти! +5' },
  story:    { label: 'Історія', re: /(одного разу|якось|колись|пам'ятаю|це було|розповім історію)/, praise: 'Історія — найсильніший прийом! +5' },
  action:   { label: 'Заклик до дії', re: /(^| )(спробуйте|спробуй|зробіть|зроби|давайте|приєднуйтесь|почніть|почни|запрошую|не бійтеся)/, praise: 'Заклик до дії! +5' },
};
export const STRUCTURE = {
  intro:      /(по-перше|почну з|почнемо з|сьогодні я|хочу розповісти|хочу поговорити|уявіть|уяви)/,
  transition: /(по-друге|по-третє|далі|крім того|наступн|тепер про|з іншого боку|водночас)/,
  conclusion: /(отже|підсумовуючи|наостанок|на завершення|таким чином|насамкінець|підсумок|тож )/,
};
export function isQuestion(text) {
  const t = text.trim();
  if (t.endsWith('?')) return true;
  const w = words(t);
  return w.length >= 3 && QWORDS.has(w[0]);
}
export function detectDevices(text) {
  const t = ' ' + words(text).join(' ') + ' ', out = [];
  if (isQuestion(text)) out.push('question');
  for (const [k, d] of Object.entries(DEVICES)) if (d.re && d.re.test(t)) out.push(k);
  return out;
}

// ---------- тон ----------
const POS = /(радий|рада|раді|радіст|чудов|супер|щасл|люблю|обожн|дякую|вдячн|класн|прекрасн|неймовірн|захоплю|весел|крут|перемог|успіх|приємн)/;
const NEG = /(сумн|на жаль|шкода|біда|трагед|погано|страшн|боюс|втрат|горе|загин|смерт|біль|жахлив|сумую|розчаруван)/;
export const sentiment = text => { const t = words(text).join(' '); return POS.test(t) ? 1 : NEG.test(t) ? -1 : 0; };

// ---------- розмітка ----------
const FOCUS_NEXT = new Set(['саме', 'лише', 'тільки', 'навіть', 'не']);
const SELF_STRESS = new Set(['головне', 'важливо', 'важливе', 'ключове', 'ключовий', 'ніколи', 'завжди', 'кожен', 'кожна', 'кожне', 'кожного', 'жоден', 'жодна', 'жодного', 'вперше', 'нарешті']);
const CONTRAST = new Set(['але', 'проте', 'однак', 'зате']);
const PAUSE_BEFORE = new Set(['але', 'проте', 'однак', 'тому', 'тож', 'адже', 'бо', 'тобто', 'зате']);
const PAUSE_AFTER = new Set(['по-перше', 'по-друге', 'по-третє', 'отже', 'нарешті', 'зрештою', 'підсумовуючи', 'наостанок', 'отож']);
const SPLIT_AT = new Set(['і', 'й', 'та', 'а', 'що', 'який', 'яка', 'які', 'яке', 'коли', 'якщо', 'щоб', 'бо']);
const NUMWORDS = /^(один|одна|два|дві|три|чотири|п'ять|шість|сім|вісім|дев'ять|десять|сто|тисяч|мільйон|мільярд|половин|відсот)/;
const isNum = n => /^\d/.test(n) || NUMWORDS.test(n);

export function markSentence(text) {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const tokens = raw.map(w => ({ w, n: norm(w), stress: false, pause: false, filler: false, up: false }));
  const fill = fillerIdx(tokens);
  fill.forEach(i => tokens[i].filler = true);
  const content = i => tokens[i] && !tokens[i].filler && isContent(tokens[i].n);
  const nextContent = i => { for (let j = i + 1; j < tokens.length && j < i + 4; j++) if (content(j) || isNum(tokens[j].n)) return j; return -1; };
  let stresses = [];
  tokens.forEach((t, i) => {
    if (t.filler) return;
    if (isNum(t.n) || (t.n.startsWith('най') && t.n.length > 5) || SELF_STRESS.has(t.n)) stresses.push(i);
    if (FOCUS_NEXT.has(t.n) || CONTRAST.has(t.n)) { const j = nextContent(i); if (j >= 0) stresses.push(j); }
    if (i > 0 && PAUSE_BEFORE.has(t.n)) t.pause = true;
    if (i > 0 && PAUSE_AFTER.has(tokens[i - 1].n)) t.pause = true;
    if (i > 0 && isNum(t.n) && !isNum(tokens[i - 1].n) && !tokens[i - 1].w.match(/[,;:—]$/)) t.pause = true;
  });
  stresses = [...new Set(stresses)].slice(0, 2);
  if (!stresses.length) {
    let best = -1;
    tokens.forEach((t, i) => { if (content(i) && (best < 0 || t.n.length >= tokens[best].n.length)) best = i; });
    if (best >= 0 && tokens[best].n.length >= 5) stresses.push(best);
  }
  stresses.forEach(i => tokens[i].stress = true);
  // довге речення без паузи — пауза ближче до середини
  if (tokens.length > 14 && !tokens.some(t => t.pause)) {
    const mid = tokens.length / 2; let best = -1;
    tokens.forEach((t, i) => { if (i > 3 && i < tokens.length - 3 && SPLIT_AT.has(t.n) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; });
    tokens[best >= 0 ? best : Math.round(mid)].pause = true;
  }
  // перелік: ↗ на кожному пункті, ↘ на останньому
  const commas = tokens.filter(t => /,$/.test(t.w)).length;
  const list = commas >= 2 && tokens.some(t => ['і', 'й', 'та', 'або'].includes(t.n));
  if (list) tokens.forEach(t => { if (/,$/.test(t.w) && !PAUSE_AFTER.has(t.n)) t.up = true; });
  return { tokens, tone: isQuestion(text) ? 'up' : 'down', list };
}

export function markText(text) {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…]*/g) || [];
  return parts.map(s => s.trim()).filter(s => words(s).length).map(markSentence);
}

export function stressedWords(sent) { return sent.tokens.filter(t => t.stress).map(t => t.w.replace(/[^\p{L}\p{N}'’-]/gu, '')); }

// ---------- звіряння з текстом (телесуфлер) ----------
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, Math.min(5, a.length, b.length) - 1) === b.slice(0, Math.min(5, a.length, b.length) - 1));
export class ScriptTracker {
  constructor(sentences) {
    this.flat = [];
    sentences.forEach((s, si) => s.tokens.forEach((t, ti) => this.flat.push({ si, ti, n: t.n, pause: t.pause || ti === 0 && si > 0, said: false })));
    this.pos = 0; this.boundaries = new Set(); this.extra = 0;
  }
  feed(text, final) {
    let pos = this.pos;
    for (const w of words(text)) {
      let hit = -1;
      for (let j = pos; j < Math.min(this.flat.length, pos + 8); j++) if (same(this.flat[j].n, w)) { hit = j; break; }
      if (hit >= 0) { if (final) this.flat[hit].said = true; pos = hit + 1; } else if (final) this.extra++;
    }
    if (final) { this.pos = pos; if (pos > 0) this.boundaries.add(pos); }
    return pos;
  }
  result() {
    const total = this.flat.length, said = this.flat.filter(t => t.said).length;
    const pauseIdx = this.flat.map((t, i) => t.pause ? i : -1).filter(i => i > 0);
    const kept = pauseIdx.filter(i => this.boundaries.has(i)).length;
    return { total, said, missed: total - said, extra: this.extra, pauses: pauseIdx.length, pausesKept: kept,
      missedWords: this.flat.filter(t => !t.said) };
  }
}

// ---------- підсумок імпровізації ----------
export function improvSummary(segs, excludeWords = []) {
  const excl = new Set(excludeWords.map(stem));
  const all = segs.flatMap(s => words(s.text));
  const contentW = all.filter(isContent);
  const stems = contentW.map(stem).filter(s => !excl.has(s));
  const fillers = {};
  for (const s of segs) for (const f of findFillers(s.text)) fillers[f] = (fillers[f] || 0) + 1;
  const counts = {}; stems.forEach(s => counts[s] = (counts[s] || 0) + 1);
  const devices = {}; for (const k of Object.keys(DEVICES)) devices[k] = 0;
  const joined = ' ' + segs.map(s => words(s.text).join(' ')).join(' ') + ' ';
  for (const s of segs) for (const d of detectDevices(s.text)) devices[d]++;
  const structure = {}; for (const [k, re] of Object.entries(STRUCTURE)) structure[k] = re.test(joined);
  return {
    words: all.length, contentWords: contentW.length,
    diversity: stems.length ? new Set(stems).size / stems.length : 0,
    fillers, fillerTotal: Object.values(fillers).reduce((a, b) => a + b, 0),
    topRepeats: Object.entries(counts).filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 3),
    devices, structure,
  };
}

// живий детектор повторів: стем → часи
export class RepeatWatch {
  constructor(exclude = []) { this.t = {}; this.excl = new Set(exclude.map(stem)); }
  feed(text, now) {
    let hit = null;
    for (const w of words(text).filter(isContent)) {
      const s = stem(w); if (this.excl.has(s)) continue;
      const a = (this.t[s] = (this.t[s] || []).filter(x => now - x < 30000)); a.push(now);
      if (a.length >= 3) { hit = w; this.t[s] = []; }
    }
    return hit;
  }
}

export const contentWordsOf = text => words(text).filter(isContent);
