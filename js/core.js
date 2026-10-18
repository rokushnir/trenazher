// Спільні визначення: напрями, проблеми (підказки/похвала), сховище, суворість.

export const DIRS = {
  face:     { label: 'Міміка',        icon: '🙂' },
  gaze:     { label: 'Погляд',        icon: '👀' },
  posture:  { label: 'Поза і жести',  icon: '🙌' },
  distance: { label: 'Дистанція',     icon: '↔️' },
  voice:    { label: 'Голос',         icon: '🎙️' },
  improv:   { label: 'Мовлення',      icon: '💬' },
};

// prio: менше = важливіше. tip — підказка, praise — похвала після виправлення.
export const ISSUES = {
  crossed:    { dir: 'posture',  prio: 1, tip: 'Розкрий руки — схрещені виглядають як захист', praise: 'Відкрита поза, клас!' },
  clasped:    { dir: 'posture',  prio: 3, tip: 'Розчепи руки — дай їм говорити', praise: 'Руки вільні — так значно краще!' },
  hidden:     { dir: 'posture',  prio: 3, tip: 'Покажи руки — це викликає довіру', praise: 'Руки на виду — довіра +1!' },
  fewGest:    { dir: 'posture',  prio: 4, tip: 'Додай жестів — ілюструй слова руками', praise: 'Живі жести!' },
  sluggish:   { dir: 'posture',  prio: 5, tip: 'Жести ширше й чіткіше', praise: 'Ось це виразні жести!' },
  chaotic:    { dir: 'posture',  prio: 5, tip: 'Дай рукам паузу — забагато рухів', praise: 'Спокійніше — так переконливіше' },
  lowZone:    { dir: 'posture',  prio: 6, tip: 'Жести на рівні пояса й грудей, не нижче', praise: 'Жести в правильній зоні!' },
  faceTouch:  { dir: 'posture',  prio: 2, tip: 'Не торкайся обличчя', praise: null },
  shoulders:  { dir: 'posture',  prio: 6, tip: 'Вирівняй плечі', praise: 'Рівна постава!' },
  headDown:   { dir: 'posture',  prio: 4, tip: 'Підніми голову', praise: 'Голова піднята — впевнено!' },

  noContact:  { dir: 'gaze',     prio: 2, tip: 'Дивись у камеру — це твій глядач', praise: 'Тримаєш контакт очима!' },
  shifty:     { dir: 'gaze',     prio: 4, tip: 'Зафіксуй погляд — він бігає', praise: 'Погляд спокійний і впевнений' },

  frozen:     { dir: 'face',     prio: 4, tip: 'Більше емоцій: брови, усмішка', praise: 'Виразна міміка!' },
  noSmile:    { dir: 'face',     prio: 6, tip: 'Усміхнись — особливо на початку й наприкінці', praise: 'Чудова усмішка!' },
  grimace:    { dir: 'face',     prio: 5, tip: 'Стеж за мімікою', praise: null },
  mismatch:   { dir: 'face',     prio: 5, tip: 'Міміка не відповідає словам', praise: null },
  blinks:     { dir: 'face',     prio: 7, tip: 'Видихни — часто кліпаєш, ти хвилюєшся', praise: null },

  outOfFrame: { dir: 'distance', prio: 1, tip: 'Повернись у кадр', praise: 'Ти знову в кадрі!' },
  tooFar:     { dir: 'distance', prio: 3, tip: 'Підійди ближче до камери', praise: null },
  tooClose:   { dir: 'distance', prio: 3, tip: 'Відійди трохи — тебе не видно', praise: null },
  pendulum:   { dir: 'distance', prio: 3, tip: 'Не ходи маятником — зупинись', praise: 'Стійко — так краще!' },

  quiet:      { dir: 'voice',    prio: 2, tip: 'Говори голосніше', praise: 'Гучність — те, що треба!' },
  monotone:   { dir: 'voice',    prio: 4, tip: 'Голос рівний — підніми інтонацію на ключових словах', praise: 'Жива інтонація!' },
  swallow:    { dir: 'voice',    prio: 6, tip: 'Не ковтай кінці фраз', praise: null },
  noPause:    { dir: 'voice',    prio: 4, tip: 'Зроби паузу — дай слухачам осмислити', praise: 'Гарна пауза!' },
  longPause:  { dir: 'voice',    prio: 5, tip: 'Пауза затягнулася — продовжуй думку', praise: null },
  fast:       { dir: 'voice',    prio: 4, tip: 'Повільніше — тебе не встигають почути', praise: 'Темп — супер!' },
  slow:       { dir: 'voice',    prio: 6, tip: 'Трохи жвавіше', praise: 'Темп — супер!' },

  fillers:    { dir: 'improv',   prio: 4, tip: 'Менше слів-паразитів', praise: 'Чисте мовлення!' },
  repeats:    { dir: 'improv',   prio: 6, tip: 'Повтор — пошукай синонім', praise: null },
  hesitate:   { dir: 'improv',   prio: 6, tip: 'Не зависай — продовжуй думку', praise: null },
};

export const STREAK_PRAISE = [
  'Ти молодець! Тобі вдалося!', 'Так тримати!', 'Звучиш як профі!', 'Неймовірно впевнено!',
  'Оце виступ!', 'Ти в ударі!', 'Глядачі вже твої!',
];

// ---------- сховище ----------
const KEY = 'trenazher.v1';
export function loadStore() {
  const blank = { sessions: [], dirCounts: {}, points: 0, days: [], badges: {} };
  try { return Object.assign(blank, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { return blank; }
}
export function saveStore(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export function clearStore() { try { localStorage.removeItem(KEY); } catch {} }

const PREFS = 'trenazher.prefs';
export function loadPrefs() {
  const d = { mode: 'free', duration: 120, silent: false, sound: true, skeleton: false, speech: true,
              camera: true, mic: true, prep: 10, prompter: 'prompter', category: 'any' };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(PREFS)) || {}); } catch { return d; }
}
export function savePrefs(p) { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch {} }

// Прогресивна суворість: k = 0 у першій сесії → 1 приблизно за 10 сесій у напрямі.
export function strictness(store) {
  const k = {};
  for (const d of Object.keys(DIRS)) k[d] = Math.min(1, (store.dirCounts[d] || 0) / 10);
  return k;
}
// Поріг між «м'яким» (k=0) і «суворим» (k=1).
export const soft = (k, strict, loose) => loose + (strict - loose) * k;

export function level(points) {
  // рівень n потребує 150·n·(n−1)/2 балів
  let n = 1; while (150 * n * (n + 1) / 2 <= points) n++;
  const from = 150 * n * (n - 1) / 2, to = 150 * n * (n + 1) / 2;
  return { n, progress: (points - from) / (to - from), toNext: to - points };
}

export const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
export function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); }
export function quantile(a, q) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
export const todayKey = () => new Date().toISOString().slice(0, 10);
