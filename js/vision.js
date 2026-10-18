// Аналіз камери: поза, жести, дистанція (PoseLandmarker) та міміка, погляд (FaceLandmarker).
// Кадри обробляються в пам'яті й одразу відкидаються — нічого не записується.
import { soft, mean, std, quantile } from './core.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let cached;
export async function loadVision() {
  if (cached) return cached;
  const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await import(`${MP}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const make = async (Cls, model, extra) => {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        return await Cls.createFromOptions(files, { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', ...extra });
      } catch (e) { if (delegate === 'CPU') throw e; }
    }
  };
  const [pose, face] = await Promise.all([
    make(PoseLandmarker, POSE_MODEL, { numPoses: 1 }),
    make(FaceLandmarker, FACE_MODEL, { numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true }),
  ]);
  cached = { pose, face };
  return cached;
}

const POSE_LINES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28]];
const GRIMACES = {
  asym:   { text: 'Однобічна усмішка виглядає як іронія — усміхайся симетрично', hold: 600 },
  press:  { text: 'Стиснуті губи видають напругу — розслаб рот', hold: 1000 },
  bite:   { text: 'Не закушуй губу', hold: 1000 },
  sneer:  { text: 'Кривишся носом — стеж за мімікою', hold: 500 },
  side:   { text: 'Губи йдуть убік — тримай обличчя рівно', hold: 800 },
  frown:  { text: 'Брови насуплені — розслаб їх', hold: 3000 },
};
export const GRIMACE_NAMES = { asym: 'однобічна усмішка', press: 'стиснуті губи', bite: 'закушена губа', sneer: 'кривлення носом', side: 'губи вбік', frown: 'насуплені брови' };

export class VisionAnalyzer {
  constructor({ models, coach, k, video, canvas, skeleton, speaking = () => true }) {
    Object.assign(this, { models, coach, k, video, canvas, skeleton, speaking });
    this.ctx = canvas.getContext('2d');
    this.turn = 0; this.lastTs = 0;
    this.since = {};
    this.gest = []; this.move = []; this.expr = []; this.mood = [];
    this.blinkTimes = []; this.awayTimes = []; this.grimaceAt = {};
    this.frame0 = { face: false, shoulders: false, hands: false, faceH: 0 };
    this.calib = null; this.base = { yaw: 0, pitch: 0, nose: 0.5, sw: 0, cx: 0 };
    this.st = { faceFrames: 0, contactFrames: 0, smileFrames: 0, poseFrames: 0, handsFrames: 0, movingFrames: 0,
                grimaces: {}, blinks: 0, moves: 0, faceSeenAt: 0, poseSeenAt: 0, handsEver: false };
    this.prevW = {}; this.wasContact = true; this.awayFrom = 0; this.wasBlink = false;
    this.ref = null; this.lastMovePraise = 0; this.smilePraised = false; this.nextSmileCheck = 30000;
    this.lastPose = null; this.lastFace = null;
  }

  // --- утиліти утримання умови ---
  hold(key, cond, ms, now) {
    if (!cond) { this.since[key] = 0; return false; }
    if (!this.since[key]) this.since[key] = now;
    return now - this.since[key] >= ms;
  }
  s(dir, strict, loose) { return soft(this.k[dir] ?? 0, strict, loose); }

  calibrateStart() { this.calib = { yaw: [], pitch: [], nose: [], sw: [], cx: [] }; }
  calibrateEnd() {
    const c = this.calib; this.calib = null;
    if (!c) return;
    if (c.yaw.length) { this.base.yaw = mean(c.yaw); this.base.pitch = mean(c.pitch); this.base.nose = mean(c.nose); }
    if (c.sw.length) { this.base.sw = quantile(c.sw, 0.5); this.base.cx = mean(c.cx); }
  }

  framing() { return this.frame0; }

  frame(now, active) {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const ts = Math.max(this.lastTs + 1, Math.round(now));
    this.lastTs = ts;
    const W = v.videoWidth, H = v.videoHeight;
    if (this.canvas.width !== W) { this.canvas.width = W; this.canvas.height = H; }
    this.turn ^= 1;
    try {
      if (this.turn) this.lastPose = this.models.pose.detectForVideo(v, ts).landmarks?.[0] || null;
      else this.lastFace = this.models.face.detectForVideo(v, ts);
    } catch (e) { console.warn(e); return; }
    if (this.turn) this.onPose(this.lastPose, W, H, now, active);
    else this.onFace(this.lastFace, W, H, now, active);
    this.draw(W, H);
  }

  // ---------------- тіло ----------------
  onPose(L, W, H, now, active) {
    const c = this.coach, f = this.frame0;
    const P = i => ({ x: L[i].x * W, y: L[i].y * H, v: L[i].visibility ?? 1 });
    const inside = p => p.x > 0 && p.x < W && p.y > 0 && p.y < H;
    const vis = (i, th = 0.5) => { const p = P(i); return p.v > th && inside(p); };
    f.shoulders = !!L && vis(11) && vis(12);
    f.hands = !!L && (vis(15) || vis(16));
    if (!active && !this.calib) return;
    if (L) this.st.poseSeenAt = now;

    if (active) {
      c.measure('distance');
      const lost = !f.shoulders && !this.frame0.face;
      c.set('outOfFrame', this.hold('out', lost, 1500, now));
      c.set('tooClose', this.hold('close', !f.shoulders && this.frame0.face && this.frame0.faceH > 0.3, 3000, now));
    }
    if (!f.shoulders) { this.lastBody = null; this.clearPosture(); return; }

    const LS = P(11), RS = P(12), sw = Math.hypot(LS.x - RS.x, LS.y - RS.y);
    const cx = (LS.x + RS.x) / 2, cy = (LS.y + RS.y) / 2;
    if (this.calib) { this.calib.sw.push(sw); this.calib.cx.push(cx); }
    if (!active) return;
    c.measure('posture');
    this.st.poseFrames++;

    const hipsVis = vis(23, 0.4) && vis(24, 0.4);
    const hipY = hipsVis ? (P(23).y + P(24).y) / 2 : cy + 1.5 * sw;
    const rel = p => ({ x: (p.x - cx) / sw, y: (p.y - cy) / sw });
    const wr = { l: vis(15) ? P(15) : null, r: vis(16) ? P(16) : null };
    const anyHand = wr.l || wr.r;
    if (anyHand) { this.st.handsFrames++; this.st.handsEver = true; }

    // схрещені руки: кожне зап'ястя на протилежному боці середньої лінії, на рівні торсу
    const sideL = Math.sign(LS.x - cx) || 1;
    const torso = p => p && p.y > cy && p.y < hipY + 0.3 * sw;
    const crossed = wr.l && wr.r && torso(wr.l) && torso(wr.r) &&
      (wr.l.x - cx) * sideL < -0.1 * sw && (wr.r.x - cx) * -sideL < -0.1 * sw;
    c.set('crossed', this.hold('crossed', crossed, 1500, now));

    // руки зчеплені «замком»
    const speedNow = this.wristSpeed(wr, rel, now);
    const clasped = wr.l && wr.r && !crossed && Math.hypot(wr.l.x - wr.r.x, wr.l.y - wr.r.y) < 0.35 * sw && wr.l.y > cy + 0.3 * sw && speedNow < 0.7;
    c.set('clasped', this.hold('clasped', clasped, 4000, now));

    // руки сховані (якщо раніше були видні)
    const hiddenHands = this.st.handsEver && P(15).v < 0.3 && P(16).v < 0.3;
    c.set('hidden', this.hold('hidden', hiddenHands, 5000, now));

    // торкання обличчя
    const nose = P(0);
    const touch = [wr.l, wr.r].some(w => w && Math.hypot(w.x - nose.x, w.y - nose.y) < 0.6 * sw);
    if (this.hold('touch', touch, 700, now)) c.pulse('faceTouch', 2500);

    // перекіс плечей
    const tilt = Math.abs(Math.atan2(LS.y - RS.y, Math.abs(LS.x - RS.x))) * 180 / Math.PI;
    c.set('shoulders', this.hold('tilt', tilt > this.s('posture', 8, 12), 3000, now));

    // жести: вікно 10 с
    const moving = speedNow > 0.7;
    if (moving) this.st.movingFrames++;
    this.gest.push({ t: now, vis: !!anyHand, moving, speed: speedNow,
      pts: [wr.l && { k: 'l', ...rel(wr.l) }, wr.r && { k: 'r', ...rel(wr.r) }].filter(Boolean),
      low: [wr.l, wr.r].some(w => w && w.y > hipY) });
    while (this.gest.length && now - this.gest[0].t > 10000) this.gest.shift();
    this.evalGestures(now);

    // дистанція і переміщення (у ширинах плечей базової дистанції)
    if (this.base.sw) this.evalMovement(now, sw / this.base.sw, (cx - this.base.cx) / this.base.sw);
  }

  wristSpeed(wr, rel, now) {
    let best = 0;
    for (const key of ['l', 'r']) {
      const w = wr[key];
      if (!w) { delete this.prevW[key]; continue; }
      const p = rel(w), prev = this.prevW[key];
      if (prev && now - prev.t < 400) {
        const sp = Math.hypot(p.x - prev.x, p.y - prev.y) / ((now - prev.t) / 1000);
        prev.ema = prev.ema == null ? sp : prev.ema * 0.5 + sp * 0.5;
        best = Math.max(best, prev.ema);
        Object.assign(prev, p, { t: now });
      } else this.prevW[key] = { ...p, t: now, ema: null };
    }
    return best;
  }

  evalGestures(now) {
    const c = this.coach, g = this.gest;
    const span = g.length ? now - g[0].t : 0;
    const visS = g.filter(s => s.vis);
    if (span < 6000 || visS.length < g.length * 0.5) {
      for (const id of ['fewGest', 'sluggish', 'chaotic', 'lowZone']) c.set(id, false);
      return;
    }
    const mov = visS.filter(s => s.moving);
    const frac = mov.length / visS.length;
    let amp = 0;
    for (const k of ['l', 'r']) {
      const pts = mov.flatMap(s => s.pts.filter(p => p.k === k));
      if (pts.length < 3) continue;
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      amp = Math.max(amp, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
    const peak = quantile(mov.map(s => s.speed), 0.9);
    const few = frac < this.s('posture', 0.10, 0.06);
    c.set('fewGest', few && this.speaking());
    c.set('sluggish', !few && amp < this.s('posture', 0.4, 0.28) && peak < 1.6);
    c.set('chaotic', frac > this.s('posture', 0.7, 0.82));
    c.set('lowZone', !few && mov.filter(s => s.low).length > mov.length * 0.6);
  }

  evalMovement(now, r, x) {
    const c = this.coach, m = this.move;
    m.push({ t: now, r, x });
    while (m.length && now - m[0].t > 10000) m.shift();
    if (!this.ref) this.ref = { r, x };
    // маятник: ≥ 3 зміни напрямку значного руху за 10 с
    let rev = 0;
    for (const key of ['x', 'r']) {
      const th = key === 'x' ? 0.15 : 0.06;
      let ext = m[0]?.[key], dir = 0;
      for (const s of m) {
        const d = s[key] - ext;
        if (dir >= 0 && d < -th) { if (dir > 0) rev++; dir = -1; ext = s[key]; }
        else if (dir <= 0 && d > th) { if (dir < 0) rev++; dir = 1; ext = s[key]; }
        else if ((dir > 0 && s[key] > ext) || (dir < 0 && s[key] < ext)) ext = s[key];
      }
    }
    const recent = m.filter(s => now - s.t < 3000);
    const sway = recent.length > 10 && std(recent.map(s => s.x)) > this.s('distance', 0.12, 0.18);
    c.set('pendulum', rev >= 3 || this.hold('sway', sway, 1500, now));

    // осмислене переміщення: зрушив і стоїть ≥ 3 с
    const moved = Math.abs(r / this.ref.r - 1) > 0.15 || Math.abs(x - this.ref.x) > 0.6;
    const still = recent.length > 10 && std(recent.map(s => s.x)) < 0.05 && std(recent.map(s => s.r)) < 0.03;
    if (moved && still && rev < 2) {
      this.ref = { r, x };
      this.st.moves++;
      if (now - this.lastMovePraise > 20000) {
        this.lastMovePraise = now;
        c.praise(r > 1 ? 'Осмислене наближення — сильний хід! +5' : 'Осмислене переміщення! +5', 5);
      }
    }
  }

  clearPosture() {
    for (const id of ['crossed', 'clasped', 'hidden', 'shoulders', 'fewGest', 'sluggish', 'chaotic', 'lowZone', 'pendulum']) this.coach.set(id, false);
  }

  // ---------------- обличчя ----------------
  onFace(res, W, H, now, active) {
    const c = this.coach, f = this.frame0;
    const lm = res?.faceLandmarks?.[0];
    f.face = !!lm;
    if (!lm) {
      if (active) { c.set('noContact', false); c.set('frozen', false); }
      return;
    }
    let minY = 1, maxY = 0;
    for (const p of lm) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    f.faceH = maxY - minY;
    const b = {};
    for (const cat of res.faceBlendshapes?.[0]?.categories || []) b[cat.categoryName] = cat.score;
    const m = res.facialTransformationMatrixes?.[0]?.data;
    const deg = 180 / Math.PI;
    const yaw = m ? Math.asin(Math.max(-1, Math.min(1, -m[2]))) * deg : 0;
    const pitch = m ? Math.atan2(m[6], m[10]) * deg : 0;
    const eyeMid = (lm[33].y + lm[263].y) / 2;
    const noseR = (lm[1].y - eyeMid) / Math.max(1e-3, lm[152].y - eyeMid);
    if (this.calib) { this.calib.yaw.push(yaw); this.calib.pitch.push(pitch); this.calib.nose.push(noseR); }
    if (!active) return;
    this.st.faceSeenAt = now;
    this.st.faceFrames++;
    c.measure('face'); c.measure('gaze');

    c.set('tooFar', this.hold('far', f.faceH < 0.06, 2000, now));
    c.set('headDown', this.hold('down', noseR - this.base.nose > 0.08, 3000, now));

    // контакт очима
    const lim = this.s('gaze', 15, 20);
    const eyeAway = Math.max(...['eyeLookOutLeft', 'eyeLookInLeft', 'eyeLookOutRight', 'eyeLookInRight',
      'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight'].map(n => b[n] || 0));
    const contact = Math.abs(yaw - this.base.yaw) < lim && Math.abs(pitch - this.base.pitch) < lim && eyeAway < 0.55;
    if (contact) this.st.contactFrames++;
    c.set('noContact', this.hold('away', !contact, this.s('gaze', 3000, 4000), now));
    if (!contact && this.wasContact) this.awayFrom = now;
    if (contact && !this.wasContact && now - this.awayFrom > 300) this.awayTimes.push(now);
    this.wasContact = contact;
    while (this.awayTimes.length && now - this.awayTimes[0] > 60000) this.awayTimes.shift();
    c.set('shifty', this.awayTimes.length > this.s('gaze', 20, 26));

    // виразність: варіативність за 8 с
    const smile = ((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2;
    const browDown = ((b.browDownLeft || 0) + (b.browDownRight || 0)) / 2;
    this.expr.push({ t: now, v: [b.browInnerUp || 0, ((b.browOuterUpLeft || 0) + (b.browOuterUpRight || 0)) / 2, smile,
      ((b.eyeWideLeft || 0) + (b.eyeWideRight || 0)) / 2, browDown, ((b.cheekSquintLeft || 0) + (b.cheekSquintRight || 0)) / 2] });
    while (this.expr.length && now - this.expr[0].t > 8000) this.expr.shift();
    if (this.expr.length > 20 && now - this.expr[0].t > 6000) {
      let total = 0;
      for (let i = 0; i < 6; i++) total += std(this.expr.map(e => e.v[i]));
      c.set('frozen', total < this.s('face', 0.09, 0.06) && this.speaking());
    }

    // усмішка
    const smiling = smile > 0.4;
    if (smiling) {
      this.st.smileFrames++;
      if (!this.smilePraised && this.coach.elapsed(now) > 8) { this.smilePraised = true; c.praise('Чудова усмішка! +5', 5); }
    }
    const el = this.coach.elapsed(now) * 1000;
    if (el > this.nextSmileCheck) {
      this.nextSmileCheck = el + 45000;
      if (this.st.smileFrames / this.st.faceFrames < this.s('face', 0.05, 0.03)) c.pulse('noSmile', 4000);
    }
    this.mood.push({ t: now, smile, browDown });
    while (this.mood.length && now - this.mood[0].t > 5000) this.mood.shift();

    // гримаси
    const g = {
      asym: Math.max(b.mouthSmileLeft || 0, b.mouthSmileRight || 0) > 0.35 && Math.abs((b.mouthSmileLeft || 0) - (b.mouthSmileRight || 0)) > 0.3,
      press: ((b.mouthPressLeft || 0) + (b.mouthPressRight || 0)) / 2 > 0.5,
      bite: (b.mouthRollLower || 0) > 0.5,
      sneer: ((b.noseSneerLeft || 0) + (b.noseSneerRight || 0)) / 2 > 0.4,
      side: Math.max(b.mouthLeft || 0, b.mouthRight || 0) > 0.5,
      frown: browDown > 0.55,
    };
    for (const [k, on] of Object.entries(g)) {
      if (this.hold('g_' + k, on, GRIMACES[k].hold, now) && now - (this.grimaceAt[k] || 0) > 8000) {
        this.grimaceAt[k] = now;
        this.st.grimaces[k] = (this.st.grimaces[k] || 0) + 1;
        c.pulse('grimace', 3000, GRIMACES[k].text);
      }
    }

    // кліпання
    const blink = ((b.eyeBlinkLeft || 0) + (b.eyeBlinkRight || 0)) / 2 > 0.5;
    if (blink && !this.wasBlink) { this.blinkTimes.push(now); this.st.blinks++; }
    this.wasBlink = blink;
    while (this.blinkTimes.length && now - this.blinkTimes[0] > 60000) this.blinkTimes.shift();
    if (this.coach.elapsed(now) > 30 && this.blinkTimes.length > this.s('face', 35, 45) && now - (this.blinkPulse || 0) > 20000) {
      this.blinkPulse = now; c.pulse('blinks', 4000);
    }
  }

  // настрій обличчя за останні ms мілісекунд (для звірки зі словами)
  moodAround(now, ms = 2500) {
    const s = this.mood.filter(m => now - m.t < ms);
    if (s.length < 3) return null;
    return { smileMax: Math.max(...s.map(m => m.smile)), browDown: mean(s.map(m => m.browDown)) };
  }

  // ---------------- малювання ----------------
  draw(W, H) {
    const x = this.ctx;
    x.clearRect(0, 0, W, H);
    if (!this.skeleton) return;
    const L = this.lastPose;
    if (L) {
      x.lineWidth = Math.max(3, W / 160); x.strokeStyle = 'rgba(63,212,159,.85)'; x.fillStyle = '#fff';
      for (const [a, b] of POSE_LINES) {
        if ((L[a].visibility ?? 1) < 0.5 || (L[b].visibility ?? 1) < 0.5) continue;
        x.beginPath(); x.moveTo(L[a].x * W, L[a].y * H); x.lineTo(L[b].x * W, L[b].y * H); x.stroke();
      }
      for (const i of [15, 16]) if ((L[i].visibility ?? 1) > 0.5) { x.beginPath(); x.arc(L[i].x * W, L[i].y * H, W / 90, 0, 7); x.fill(); }
    }
    const lm = this.lastFace?.faceLandmarks?.[0];
    if (lm) {
      x.fillStyle = 'rgba(245,184,46,.9)';
      for (let i = 0; i < lm.length; i += 7) { x.fillRect(lm[i].x * W - 1, lm[i].y * H - 1, 2.5, 2.5); }
    }
  }

  summary() { return { ...this.st, base: this.base }; }
}
