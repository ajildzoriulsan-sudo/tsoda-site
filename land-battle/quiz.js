/* АСУУЛТ ХАРИУЛТ — quiz game for TikTok LIVE
 * A question with 4 answers; viewers answer by commenting 1–4. Faster correct answers earn more.
 * ❤ likes are a shared goal that removes a wrong answer for everybody; gifts give the sender
 * bonus multipliers and help the whole room (+5 s, remove a wrong answer). 10 questions per game.
 * Questions live in questions.js (editable). Logical canvas 1080×1920, TikTok UI zones kept clear.
 */
(() => {
'use strict';
const { audio, commentator } = window.LBLAudio;
const { cleanName, titleFor, scores } = window.LBLShared;

// ───────────────────────────── Config ─────────────────────────────
// HERD mode ("СҮРГЭЭ АВАР"): everyone starts with a herd of sheep (free points), splits it across the
// answers by commenting percentages; wolves take the sheep in the wrong pens. Last big herd wins.
// MONEY mode ("МӨНГӨӨ ХАДГАЛ") is the same game themed as a money show with VIRTUAL ₮ (not real prizes).
const _mode = window.QUIZ_MODE || new URLSearchParams(location.search).get('mode');
const MONEY = _mode === 'money';
const HERD = _mode === 'herd' || MONEY;
const GAME_KEY = MONEY ? 'money' : HERD ? 'herd' : 'quiz';
const fmtMoney = (n) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ') + '₮';
const fmtBig = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + ' сая₮' : fmtMoney(n);
/** wording / icons for the two themes of the split-your-stake game */
const TH = MONEY ? {
  title: 'МӨНГӨӨ ХАДГАЛ', icon: '💰', unitIcon: '💵', card: 'Мөнгөө хуваа', split: 'МӨНГӨӨ ХУВАА!',
  amount: (n) => fmtBig(n), all: 'бүх мөнгө', join: (v) => `💰 ${v.name} ${fmtBig(CFG.startHerd)}-өөр нэгдлээ`,
  lostLine: (n) => `${fmtBig(n)} унаж алга боллоо!`, lostStatus: (n) => `💸 ${fmtBig(n)} унаж алга боллоо`, outLine: (k) => `${k} хүн мөнгөө бүгдийг алдлаа.`,
  players: (k) => `💰 ${k} тоглогч`, best: 'Хамгийн их мөнгөтэй', bestOut: (k) => `😢 ${k} хүн мөнгөө алдлаа`, allOut: 'Энэ удаа бүгд мөнгөө алдлаа 😮',
  start: (n) => `Баг ${fmtBig(n)} (${Math.round(n / 1e6)} боодол) виртуал мөнгөтэй эхэлнэ · «мөнгө» гэж бичвэл багийн мөнгө харагдана`,
  final: '🎉 ТЭМЦЭЭНИЙ ДҮН', board: 'ОНООНЫ', none: 'Оноо авсан хүн алга', pen: 'тавцан', startLabel: 'Эхний мөнгө (₮)',
} : {
  title: 'СҮРГЭЭ АВАР', icon: '🐑', unitIcon: '🐑', card: 'Хонио хуваа', split: 'ХОНИО ХУВАА!',
  amount: (n) => fmt(n), all: 'бүх хонь', join: (v) => `🐑 ${v.name} ${fmt(CFG.startHerd)} хоньтой нэгдлээ`,
  lostLine: (n) => `Чоно ${fmt(n)} хонь авч явлаа!`, lostStatus: (n) => `🐺 Чоно ${fmt(n)} хонь авч явлаа`, outLine: (k) => `${k} хүн сүргээ алдлаа.`,
  players: (k) => `🐑 ${k} тоглогч`, best: 'Хамгийн том сүрэг', bestOut: (k) => `😢 ${k} хүн сүргээ алдлаа`, allOut: 'Энэ удаа бүгд сүргээ алдлаа 😮',
  start: (n) => `Шинэ тоглогч ${fmt(n)} хоньтой эхэлнэ · хугацаа дуустал өөрчилж болно`,
  final: '🎉 ХАМГИЙН ТОМ СҮРЭГ', board: 'СҮРГИЙН', none: 'Сүрэгтэй үлдсэн хүн алга', pen: 'хашаа', startLabel: 'Эхний хонь',
};
const DEFAULT_CONFIG = {
  questionsPerGame: 10,
  introSec: 3,
  answerSec: 20,
  revealSec: 7,
  boardSec: 9,
  finalSec: 15,
  likeGoal: 300,        // shared likes needed to remove one wrong answer
  readQuestion: 1,      // 1 = commentator reads the question
  readOptions: 1,       // 1 = … and the four answers
  maxPoints: 100,       // instant correct answer
  minPoints: 50,        // correct at the last second
  streakBonus: 10,      // per correct answer in a row
  // herd mode
  startHerd: 1000,      // sheep each player starts a game with
  topicSec: 12,         // topic vote
  idleKeep: 0.5,        // share kept by a player who did not place their sheep this question
  joinUntil: 3,         // new players may join during the first N questions
};
if (HERD) Object.assign(DEFAULT_CONFIG, { questionsPerGame: 8, answerSec: 30, revealSec: 9 });
if (MONEY) DEFAULT_CONFIG.startHerd = 50000000;   // 50 сая = 50 боодол
const UNIT = 1000000;                             // money mode: 1 боодол = 1 сая₮
const CFG_KEY = MONEY ? 'money.config.v2' : HERD ? 'herd.config.v1' : 'quiz.config.v1';
const CONFIG_LABELS = {
  questionsPerGame: 'Нэг тоглолтын асуулт', answerSec: 'Хариулах хугацаа (сек)', revealSec: 'Хариу харуулах (сек)',
  likeGoal: 'Like зорилго (50/50)', readQuestion: 'Асуулт унших (1/0)', readOptions: 'Хариулт унших (1/0)',
  maxPoints: 'Дээд оноо', minPoints: 'Доод оноо', streakBonus: 'Цуврал бонус',
};
if (HERD) { for (const k of ['maxPoints', 'minPoints', 'streakBonus']) delete CONFIG_LABELS[k]; Object.assign(CONFIG_LABELS, { startHerd: TH.startLabel, topicSec: 'Сэдэв сонгох (сек)', idleKeep: 'Хариулаагүй бол үлдэх хэсэг', joinUntil: 'Хэд дэх асуулт хүртэл нэгдэх' }); }
let CFG = loadConfig();
function loadConfig() { try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { ...DEFAULT_CONFIG }; } }
function saveConfig() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch {} }

// ───────────────────────────── Constants & utils ─────────────────────────────
const W = 1080, H = 1920, TAU = Math.PI * 2;
const SAFE = { top: 140, bottom: 1300 };
const AREA = { top: 440, bottom: 1290 };
if (HERD) AREA.top = MONEY ? 382 : 350;   // money mode also has the step ladder under the status line               // herd/money: no how-to strip, everything moves up
const OPT = [{ h: 355, s: 80, l: 55 }, { h: 212, s: 85, l: 55 }, { h: 44, s: 92, l: 50 }, { h: 140, s: 65, l: 42 }];
const GOLD = { h: 45, s: 100, l: 60 }, RED = { h: 350, s: 95, l: 62 }, CYAN = { h: 178, s: 90, l: 55 }, GREEN = { h: 140, s: 85, l: 55 };
const PINK = { h: 330, s: 90, l: 62 };
const PHASE = { TOPIC: 'TOPIC', INTRO: 'INTRO', QUESTION: 'QUESTION', REVEAL: 'REVEAL', BOARD: 'BOARD', FINAL: 'FINAL' };
const CAT_ICON = { 'Түүх': '📜', 'Газарзүй': '🗺', 'Соёл': '🎻', 'Шинжлэх ухаан': '🔬', 'Ерөнхий': '💡', 'Спорт': '🏅' };
const NUM_WORD = ['Нэг', 'Хоёр', 'Гурав', 'Дөрөв'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => performance.now() / 1000;
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
const hsl = (c, dl = 0, a = 1) => `hsla(${c.h},${c.s}%,${clamp(c.l + dl, 0, 100)}%,${a})`;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const avatarCache = new Map();
function getAvatar(url) {
  if (!url) return null;
  let rec = avatarCache.get(url);
  if (!rec) { rec = { img: new Image(), ok: false }; rec.img.referrerPolicy = 'no-referrer'; rec.img.onload = () => { rec.ok = true; }; rec.img.src = url; avatarCache.set(url, rec); }
  return rec.ok ? rec.img : null;
}
class SeenSet {
  constructor(max = 5000) { this.max = max; this.set = new Set(); this.q = []; }
  has(k) { return this.set.has(k); }
  add(k) { if (this.set.has(k)) return; this.set.add(k); this.q.push(k); if (this.q.length > this.max) this.set.delete(this.q.shift()); }
}
let hueSeed = Math.random() * 360;
function nextColor() { hueSeed = (hueSeed + 137.508) % 360; return { h: Math.round(hueSeed), s: 80, l: 58 }; }

// question pool: shuffled, no repeats until all were used
let pool = [];
/** target difficulty (1 easy … 5 very hard) for question i of n: starts easy, ends very hard */
function targetDiff(i, n) {
  if (n === 8) return [1, 1, 2, 2, 3, 3, 4, 5][i] || 5;
  return Math.min(5, 1 + Math.floor(i * 5 / Math.max(1, n)));
}
function nextQuestion(cat, diff) {
  const all = (window.QUIZ_QUESTIONS || []).filter(q => q && q.q && Array.isArray(q.a) && q.a.length >= 2);
  if (!all.length) return { c: 'Ерөнхий', q: 'questions.js файлд асуулт алга байна', opts: ['—', '—', '—', '—'], correct: 0 };
  if (!pool.length) pool = shuffle(all.slice());
  const dOf = (q) => q.d || 3;
  let src = null;
  // closest difficulty first (exact, then ±1, ±2 …), preferring the chosen topic, never repeating until the pool is used up
  for (let spread = 0; spread <= 4 && !src; spread++) {
    const ok = (q) => !diff || Math.abs(dOf(q) - diff) <= spread;
    let k = cat ? pool.findIndex(q => q.c === cat && ok(q)) : -1;
    if (k < 0 && !cat) k = pool.findIndex(ok);
    if (k >= 0) src = pool.splice(k, 1)[0];
  }
  if (!src && cat) { const same = all.filter(q => q.c === cat); if (same.length) src = same.sort((a, b) => Math.abs(dOf(a) - (diff || 3)) - Math.abs(dOf(b) - (diff || 3)))[0]; }
  if (!src) src = pool.shift();
  const opts = shuffle(src.a.slice(0, 4));
  return { c: src.c || 'Ерөнхий', q: src.q, opts, correct: opts.indexOf(src.a[0]), d: dOf(src) };
}

/** "2" → all on 2 · "1 60 3 40" / "1-60, 3-40%" → split. At most 3 answers, normalised to 100 %. */
function parseAlloc(s, removed) {
  if (!/^\s*[1-4]/.test(s)) return null;
  const nums = (s.replace(/[%:,\-=\/]/g, ' ').match(/\d+/g) || []).map(Number);
  const m = [0, 0, 0, 0];
  if (nums.length === 1) { if (nums[0] >= 1 && nums[0] <= 4) m[nums[0] - 1] = 100; }
  else for (let i = 0; i + 1 < nums.length; i += 2) { const a = nums[i], p = nums[i + 1]; if (a >= 1 && a <= 4 && p > 0) m[a - 1] += Math.min(100, p); }
  for (const k of removed) m[k] = 0;
  const used = m.map((p, i) => [p, i]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0]);
  if (!used.length) return null;
  for (const [, i] of used.slice(3)) m[i] = 0;                 // leave at least one pen empty
  const sum = m.reduce((a, b) => a + b, 0);
  return m.map(p => p * 100 / sum);
}

/** split B whole bundles by percentages (largest remainder), only on the chosen answers */
function toBundles(pct, B) {
  const raw = pct.map(p => p * B / 100), b = raw.map(Math.floor);
  let left = B - b.reduce((x, y) => x + y, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).filter(([, i]) => pct[i] > 0).sort((x, y) => y[0] - x[0]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) b[order[k][1]]++;
  return b;
}

// ───────────────────────────── Game state ─────────────────────────────
const quiz = {
  t: 0, phase: PHASE.INTRO, phaseT: 0, qIndex: 0, game: 1,
  cur: null, answers: new Map(), counts: [0, 0, 0, 0], removed: new Set(), likesQ: 0, likeRemoved: false, extra: 0,
  viewers: new Map(), recent: [], fastest: null, correctList: [],
  totalLikes: 0, totalDiamonds: 0, viewerCount: 0,
  feed: [], banners: [], banner: null, particles: [], flash: {}, flags: new Set(),
  seen: new SeenSet(), lastBeep: 0, board: { week: [], all: [] },
  bank: { likes: 0, secs: 0, removes: 0 }, sponsor: null, chooser: null, nextCat: null,
  alloc: new Map(), notes: [], results: [], drops: [], team: 0, teamBefore: 0, ladder: [], sadUntil: 0, sadFull: false, revealDoneT: 0, revealDone: true, shake: 0, topics: [], topicVotes: [0, 0], topicVoters: new Set(), lost: 0, outNow: 0,

  get duration() { return CFG.answerSec + this.extra; },

  viewer(user) {
    if (!user || !user.id) return null;
    let v = this.viewers.get(user.id);
    if (!v) {
      v = { id: user.id, name: cleanName(user.nickname || user.uniqueId || user.id, user.id), avatar: user.avatar || '', color: nextColor(),
            score: 0, streak: 0, correct: 0, allPts: 0, likeQ: 0, herd: null, out: false };
      this.viewers.set(v.id, v); lookupQueue.add(v.id);
    } else {
      if (user.avatar) v.avatar = user.avatar;
      if (user.nickname) v.name = cleanName(user.nickname, v.id);
    }
    return v;
  },

  handleEvent(ev) {
    if (ev.msgId) { if (this.seen.has(ev.msgId)) return; this.seen.add(ev.msgId); }
    switch (ev.type) {
      case 'viewers': this.viewerCount = ev.count | 0; return;
      case 'comment': return this.onComment(ev.user, String(ev.text || ''));
      case 'like': return this.onLike(ev.user, ev.count || 1);
      case 'gift': return this.onGift(ev.user, ev.gift || {});
      case 'follow': { const v = this.viewer(ev.user); if (v) this.pushFeed(`➕ ${v.name} follow хийлээ — баярлалаа!`, CYAN); return; }
    }
  },

  onComment(user, text) {
    const v = this.viewer(user); if (!v) return;
    const s = text.trim().toLowerCase();
    if (this.chooser === v && this.phase !== PHASE.QUESTION) {      // big gifter picks the next topic
      const map = [['түүх', 'Түүх'], ['газар', 'Газарзүй'], ['соёл', 'Соёл'], ['шинжлэх', 'Шинжлэх ухаан'], ['ухаан', 'Шинжлэх ухаан'], ['ерөнхий', 'Ерөнхий'], ['спорт', 'Спорт']];
      const hit = map.find(([k]) => s.includes(k));
      if (hit) {
        this.nextCat = hit[1]; this.chooser = null;
        this.announce({ avatar: v, text: `Дараагийн сэдэв: ${hit[1]}`, sub: `${v.name} сонголоо`, color: GOLD, dur: 2.4, prio: 3, voice: `${v.name} дараагийн сэдвийг ${hit[1]} гэж сонголоо!`, vprio: 2 });
      }
      return;
    }
    if (HERD) return this.herdComment(v, s);
    if (this.phase !== PHASE.QUESTION || this.answers.has(v.id)) return;
    let m = s.match(/^([1-4])(?!\d)/), opt = -1;
    if (m) opt = +m[1] - 1;
    else if ((m = s.match(/^([abcdабвг])(?![a-zа-яөү])/))) opt = 'abcdабвг'.indexOf(m[1]) % 4;
    if (opt < 0 || this.removed.has(opt)) return;
    this.answers.set(v.id, { opt, t: this.phaseT });
    this.counts[opt]++;
    this.recent.unshift({ v, t: this.t }); if (this.recent.length > 12) this.recent.length = 12;
    this.flash.answer = this.t;
    audio.play('vote');
  },

  onLike(user, count) {
    const v = this.viewer(user); if (!v) return;
    this.totalLikes += count; this.flash.like = this.t;
    if (HERD || this.phase !== PHASE.QUESTION) return;     // herd/money: no shared like goal
    const take = Math.max(0, Math.min(count, 60 - v.likeQ));   // anti-spam: one viewer counts ≤60 per question
    v.likeQ += take; this.likesQ += take;
    this.checkLikeGoal();
  },

  herdComment(v, s) {
    if (this.phase === PHASE.TOPIC) {
      const m = s.match(/^([12])(?!\d)/);
      if (m && !this.topicVoters.has(v.id)) { this.topicVoters.add(v.id); this.topicVotes[+m[1] - 1]++; this.flash.answer = this.t; audio.play('vote'); }
      return;
    }
    if (MONEY) return this.teamComment(v, s);
    if (/^(мөнгө|хонь|үлдэгдэл|\?)/.test(s)) {                        // "how much do I have?"
      if (v.herd != null) this.note(`${v.out ? '😢' : TH.unitIcon} ${v.name}: ${v.out ? 'энэ тоглолтод хасагдсан' : 'таньд ' + TH.amount(v.herd) + ' байна'}`, CYAN);
      return;
    }
    if (this.phase !== PHASE.QUESTION || v.out) return;
    let a = parseAlloc(s, this.removed); if (!a) return;
    if (v.herd == null) {
      if (this.qIndex >= CFG.joinUntil) { if (!v.lateHint) { v.lateHint = true; this.pushFeed(`⏳ ${v.name}: дараагийн тоглолтод нэгдээрэй`, CYAN); } return; }
      v.herd = CFG.startHerd; this.pushFeed(TH.join(v), GREEN);
    }
    if (MONEY) a = toBundles(a, Math.round(v.herd / UNIT)).map(b => b * UNIT * 100 / v.herd);   // whole bundles only
    const had = this.alloc.has(v.id);
    this.alloc.set(v.id, a);
    const parts = a.map((p, i) => [p, i]).filter(x => x[0] > 0).map(([p, i]) => `${i + 1}: ${TH.amount(v.herd * p / 100)}`);
    this.note(`✅ ${v.name} ➜ ${parts.join(' · ')}`, OPT[a.indexOf(Math.max(...a))]);
    this.answers.set(v.id, { opt: a.indexOf(Math.max(...a)), t: this.phaseT });
    if (!had) { this.recent.unshift({ v, t: this.t }); if (this.recent.length > 12) this.recent.length = 12; }
    this.flash.answer = this.t;
    audio.play('vote');
  },
  /** MONEY: everyone is one team; each comment is a vote "how to split the team's money" */
  teamComment(v, s) {
    if (/^(мөнгө|үлдэгдэл|\?)/.test(s)) { this.note(`💰 Багийн мөнгө: ${TH.amount(this.team)} (${Math.round(this.team / UNIT)} боодол)`, CYAN); return; }
    if (this.phase !== PHASE.QUESTION || this.team <= 0) return;
    const a = parseAlloc(s, this.removed); if (!a) return;
    const had = this.alloc.has(v.id);
    this.alloc.set(v.id, a);
    const parts = a.map((p, i) => [p, i]).filter(x => x[0] > 0).map(([p, i]) => `${i + 1}: ${Math.round(p)}%`);
    this.note(`✅ ${v.name} ➜ ${parts.join(' · ')}`, OPT[a.indexOf(Math.max(...a))]);
    this.answers.set(v.id, { opt: a.indexOf(Math.max(...a)), t: this.phaseT });
    if (!had) { this.recent.unshift({ v, t: this.t }); if (this.recent.length > 12) this.recent.length = 12; }
    this.flash.answer = this.t;
    audio.play('vote');
  },
  /** the team's money in whole bundles: average of everyone's split, at most 3 chests, one always empty */
  teamBundles() {
    const B = Math.round(this.team / UNIT), avg = [0, 0, 0, 0]; let n = 0;
    for (const a of this.alloc.values()) { for (let i = 0; i < 4; i++) avg[i] += a[i]; n++; }
    if (!n || !B) return [0, 0, 0, 0];
    for (const k of this.removed) avg[k] = 0;
    const used = avg.map((p, i) => [p, i]).filter(x => x[0] > 0).sort((x, y) => y[0] - x[0]);
    for (const [, i] of used.slice(3)) avg[i] = 0;
    const sum = avg.reduce((x, y) => x + y, 0); if (!sum) return [0, 0, 0, 0];
    return toBundles(avg.map(p => p * 100 / sum), B);
  },
  /** sheep currently placed on each answer, and number of players per answer */
  placed() {
    const sh = [0, 0, 0, 0], pl = [0, 0, 0, 0];
    if (MONEY) {
      const tb = this.teamBundles();
      for (const a of this.alloc.values()) for (let i = 0; i < 4; i++) if (a[i] > 0) pl[i]++;
      return { sh: tb.map(b => b * UNIT), pl };
    }
    for (const [id, a] of this.alloc) {
      const v = this.viewers.get(id); if (!v || !v.herd) continue;
      for (let i = 0; i < 4; i++) if (a[i] > 0) { sh[i] += v.herd * a[i] / 100; pl[i]++; }
    }
    return { sh, pl };
  },
  herdTop(n) {
    if (MONEY) return [...this.viewers.values()].filter(v => v.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
    return [...this.viewers.values()].filter(v => v.herd > 0).sort((a, b) => b.herd - a.herd).slice(0, n); },
  note(text, color) { this.notes.unshift({ text, color, t: this.t }); if (this.notes.length > 6) this.notes.length = 6; },
  players() { if (MONEY) return this.alloc.size; let n = 0; for (const v of this.viewers.values()) if (v.herd > 0) n++; return n; },

  checkLikeGoal() {
    if (this.likeRemoved || this.likesQ < CFG.likeGoal) return;
    this.likeRemoved = true;
    if (this.removeWrong()) this.announce({ icon: '❤', text: 'ХАМТЫН ХҮЧ!', sub: 'Нэг буруу хариулт арилав', color: RED, dur: 2.4, prio: 3,
      voice: 'Хамтын хүчээр нэг буруу хариулт арилав!', vprio: 2, vkey: 'q_fifty' });
  },
  addTime(secs) { const add = Math.min(secs, 15 - this.extra); if (add > 0) this.extra += add; return add; },

  /** Gifts never add points (points come only from answering right). They help the whole room. */
  onGift(user, gift) {
    const v = this.viewer(user); if (!v) return;
    const count = Math.max(1, gift.count | 0), dia = Math.max(1, gift.diamonds | 0), value = dia * count;
    this.totalDiamonds += value;
    const name = gift.name || 'Gift';
    const tier = /rose/i.test(name) || dia === 1 ? 0 : dia < 100 ? 1 : dia < 1000 ? 2 : 3;
    const live = this.phase === PHASE.QUESTION;
    this.sponsor = v;
    if (HERD) {
      // herd/money: gifts never change the game — they are an investment in the МАЛЧИН goal (counted by the bridge)
      const gname = (window.LBLGoal && LBLGoal.data && LBLGoal.data.config.gameName) || 'МАЛЧИН';
      this.flash[tier === 0 ? 'rose' : 'gift'] = this.t;
      this.pushFeed(`${tier === 0 ? '🌹' : '🎁'} ${v.name} → ${gname}-д хөрөнгө оруулалт`, tier >= 2 ? GOLD : PINK);
      if (tier === 0) { audio.play('rose'); return; }
      this.announce({ avatar: v, text: `Баярлалаа, ${v.name}!`, sub: `${name} · ${gname} тоглоомд хөрөнгө орууллаа · нэр тань мөнхлөгдөнө`,
        color: tier >= 2 ? GOLD : GREEN, dur: tier >= 2 ? 3 : 2.2, prio: tier >= 2 ? 3 : 2,
        voice: `Баярлалаа ${v.name}! ${gname} тоглоомд хөрөнгө орууллаа. Таны нэр тоглоомд мөнхлөгдөнө!`, vprio: 2, vkey: 'm_invest' });
      audio.play(tier >= 2 ? 'big' : 'gift');
      return;
    }
    if (tier === 0) {                                   // 🌹 adds to the shared like goal
      const add = 30 * count;
      if (live) { this.likesQ += add; this.checkLikeGoal(); } else this.bank.likes += add;
      this.flash.rose = this.t;
      this.pushFeed(`🌹 ${v.name}: хамтын тусламж +${add}`, PINK);
      audio.play('rose');
      return;
    }
    let sub, voice;
    if (tier === 1) {
      const secs = 5 * Math.min(3, count);
      if (live) this.addTime(secs); else this.bank.secs += secs;
      sub = `Бүгдэд +${secs} секунд${live ? '' : ' (дараагийн асуултад)'}`;
      voice = `Баярлалаа ${v.name}! Бүгдэд ${secs === 5 ? 'таван' : secs} секунд нэмэгдлээ!`;
    } else {
      if (live) this.removeWrong(); else this.bank.removes++;
      sub = `Бүгдэд нэг буруу хариулт арилав${live ? '' : ' (дараагийн асуултад)'}`;
      voice = `Баярлалаа ${v.name}! Бүгдэд нэг буруу хариулт арилав!`;
    }
    if (tier === 3) { this.chooser = v; sub += ' · дараагийн сэдвийг сонгоно'; voice += ' Мөн дараагийн сэдвийг сонгох эрх авлаа!'; }
    this.flash.gift = this.t;
    this.pushFeed(`🎁 ${v.name} · ${name}`, tier >= 2 ? GOLD : GREEN);
    this.announce({ avatar: v, text: `Баярлалаа, ${v.name}!`, sub, color: tier >= 2 ? GOLD : GREEN, dur: tier >= 2 ? 3 : 2.4, prio: tier >= 2 ? 3 : 2,
      voice, vprio: 2, vkey: tier === 1 ? 'q_time' : 'q_help' });
    audio.play(tier >= 2 ? 'big' : 'gift');
  },

  /** remove one wrong answer that is still on the board; returns true if one was removed */
  removeWrong() {
    const wrong = [0, 1, 2, 3].filter(i => i !== this.cur.correct && !this.removed.has(i));
    if (wrong.length <= 1) return false;
    // prefer removing the most popular wrong answer — most dramatic
    wrong.sort((a, b) => this.counts[b] - this.counts[a]);
    const k = Math.random() < 0.6 ? wrong[0] : pick(wrong);
    this.removed.add(k);
    // people who picked it may answer again
    for (const [id, a] of this.answers) if (a.opt === k) this.answers.delete(id);
    this.counts[k] = 0;
    for (const [id, a] of this.alloc) {               // herd mode: sheep on the removed answer go to the others
      if (!a[k]) continue;
      const rest = a.reduce((x, y, i) => x + (i === k ? 0 : y), 0);
      if (!rest) { this.alloc.delete(id); this.answers.delete(id); continue; }
      const n = a.map((p, i) => i === k ? 0 : p * 100 / rest); this.alloc.set(id, n);
    }
    audio.play('stumble');
    return true;
  },

  pushFeed(text, color) { this.feed.unshift({ text, color, t: this.t }); if (this.feed.length > 5) this.feed.length = 5; },
  announce(b) {
    if (b.voice || b.vkey) commentator.say(b.voice, b.vprio ?? 2, b.vkey);
    const item = { dur: 2, prio: 2, ...b, t: 0 };
    if (item.prio <= 1 && this.banners.length) return;
    if (item.prio >= 3) this.banners.unshift(item); else this.banners.push(item);
    if (this.banners.length > 4) this.banners.length = 4;
  },
  burst(x, y, color, n, power = 1) {
    for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(80, 380) * power; this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1.1), t: 0, r: rand(3, 8), color }); }
  },
  setPhase(p) { this.phase = p; this.phaseT = 0; this.lastBeep = 0; },

  // ── flow ──
  startIntro() {
    if (this.chooser && !this.nextCat) this.chooser = null;     // didn't choose in time → random topic
    this.sponsor = null;
    this.answers.clear(); this.alloc.clear(); this.lost = 0; this.outNow = 0; this.prePlaced = null; this.notes = []; this.counts = [0, 0, 0, 0]; this.removed.clear(); this.likesQ = 0; this.likeRemoved = false; this.extra = 0;
    this.recent = []; this.fastest = null; this.correctList = []; this.flags.clear();
    for (const v of this.viewers.values()) v.likeQ = 0;
    if (MONEY && this.qIndex === 0) { this.team = CFG.startHerd; this.ladder = [CFG.startHerd]; this.sadFull = false; this.sadUntil = 0; }
    if (HERD && !this.nextCat) {                          // viewers choose between two topics
      const td = targetDiff(this.qIndex, CFG.questionsPerGame);
      const cats = shuffle([...new Set((window.QUIZ_QUESTIONS || []).filter(q => Math.abs((q.d || 3) - td) <= 1).map(q => q.c))]);
      this.topics = cats.slice(0, 2); this.topicVotes = [0, 0]; this.topicVoters.clear();
      if (this.topics.length === 2) {
        this.setPhase(PHASE.TOPIC); audio.intensity = 0;
        commentator.say(`Сэдвээ сонгоцгооё! Нэг: ${this.topics[0]}. Хоёр: ${this.topics[1]}.`, 3, 'h_topic');
        return;
      }
    }
    this.cur = nextQuestion(this.nextCat, targetDiff(this.qIndex, CFG.questionsPerGame)); this.nextCat = null;
    this.setPhase(PHASE.INTRO);
    audio.intensity = 0;
    commentator.say('Шинэ асуулт!', 2, 'q_new');
    audio.play('box');
  },
  endTopic() {
    const [a, b] = this.topicVotes;
    const k = a === b ? Math.floor(Math.random() * 2) : a > b ? 0 : 1;
    const cat = this.nextCat || this.topics[k];
    this.cur = nextQuestion(cat, targetDiff(this.qIndex, CFG.questionsPerGame)); this.nextCat = null;
    this.pushFeed(`🗂 Сэдэв: ${this.cur.c}`, GOLD);
    this.setPhase(PHASE.INTRO);
    commentator.say(`${this.cur.c}! ${['', 'Амархан асуулт.', 'Амархан асуулт.', 'Дунд зэргийн асуулт.', 'Хэцүү асуулт!', 'Маш хэцүү асуулт!'][this.cur.d || 3]}`, 2);
    audio.play('box');
  },
  startQuestion() {
    this.setPhase(PHASE.QUESTION);
    const b = this.bank;                                 // help sent between questions
    if (b.secs) this.addTime(b.secs);
    for (let k = 0; k < b.removes; k++) this.removeWrong();
    if (b.likes && !HERD) { this.likesQ += b.likes; this.checkLikeGoal(); }
    this.bank = { likes: 0, secs: 0, removes: 0 };
    audio.intensity = 1;
    if (CFG.readQuestion) {
      let s = `Асуулт ${this.qIndex + 1}. ${this.cur.q}`;
      if (CFG.readOptions) s += ' ' + this.cur.opts.map((o, i) => `${NUM_WORD[i]}: ${o}.`).join(' ');
      commentator.say(s, 3);
    }
    // herd/money: the how-to card and the empty ranking already explain how to split (no banner over the ranking)
  },
  finishMoneyReveal() {
    this.revealDone = true;
    const q = this.cur, step = this.qIndex + 1, loss = this.teamBefore ? this.lost / this.teamBefore : 0;
    const say = (t) => commentator.say(t.replace(/₮/g, ' төгрөг'), 3);
    const right = `Зөв хариулт: ${NUM_WORD[q.correct].toLowerCase()}, ${q.opts[q.correct]}.`;
    if (this.team <= 0) {                                           // everything is gone — let it hurt
      this.sadFull = true; this.sadUntil = this.t + 999;
      audio.intensity = 0; audio.play('sad');
      this.announce({ icon: '😢', text: 'БАГ БҮХ МӨНГӨӨ АЛДЛАА', sub: `${step}-р шатанд ${fmtBig(this.teamBefore)} бүгд унав...`, color: { h: 215, s: 25, l: 60 }, dur: 4.5, prio: 3 });
      say(`Өө... харамсалтай. ${right} Баг бүх мөнгөө алдлаа...`);
    } else if (loss >= 0.5) {                                       // most of it fell
      this.sadUntil = this.t + 3;
      audio.play('sigh');
      this.announce({ icon: '😔', text: `${step}-р шат: ${fmtBig(this.team)} үлдлээ`, sub: `−${fmtBig(this.lost)} унав... харамсалтай`, color: { h: 215, s: 35, l: 62 }, dur: 3, prio: 3 });
      say(`Өө... ${right} ${fmtBig(this.lost)} унав. Багт ${fmtBig(this.team)} л үлдлээ.`);
    } else {
      audio.play('win'); audio.play('cheer');
      this.announce({ icon: '💰', text: `${step}-р шат: ${fmtBig(this.team)} үлдлээ`, sub: this.lost ? `−${fmtBig(this.lost)} унав` : 'Нэг ч төгрөг унасангүй!', color: GOLD, dur: 3, prio: 3 });
      say(`${right} ${this.lost ? fmtBig(this.lost) + ' унав. ' : 'Гайхалтай! '}Багт ${fmtBig(this.team)} үлдлээ.`);
      this.burst(540, 900, GOLD, 40, 1.3);
    }
  },
  herdReveal() {
    const q = this.cur;
    if (MONEY) {
      this.prePlaced = this.placed();
      this.preRank = this.herdTop(6).map(v => ({ v, herd: v.score }));
      const tb = this.teamBundles(), before = this.team;
      this.team = this.alloc.size ? tb[q.correct] * UNIT : Math.floor(before / UNIT * CFG.idleKeep) * UNIT;
      this.teamBefore = before; this.lost = before - this.team; this.outNow = 0;
      this.ladder.push(this.team);
      this.results = []; let best = null;
      for (const [id, a] of this.alloc) {
        const v = this.viewers.get(id); if (!v) continue;
        const pts = Math.round(a[q.correct]);                 // your own split: share you put on the right answer
        v.score += pts; v.lastPts = pts; this.results.push({ v, pts });
        if (!best || pts > best.lastPts) best = v;
      }
      this.fastest = best;
    }
    if (!MONEY) { this.preRank = this.herdTop(6).map(v => ({ v, herd: v.herd })); this.prePlaced = this.placed(); }
    let lost = 0, out = 0, best = null;
    if (!MONEY) { this.correctList = []; this.results = []; }
    for (const v of (MONEY ? [] : this.viewers.values())) {
      if (!(v.herd > 0)) continue;
      const a = this.alloc.get(v.id);
      const keep = a ? a[q.correct] / 100 : CFG.idleKeep;
      let nh = Math.round(v.herd * keep);
      if (MONEY) nh = (a ? Math.round(nh / UNIT) : Math.floor(nh / UNIT)) * UNIT;
      this.results.push({ v, before: v.herd, after: nh, idle: !a });
      lost += v.herd - nh; v.lastLost = v.herd - nh; v.herd = nh; v.score = nh;
      if (nh > 0) { this.correctList.push(v); if (!best || nh > best.herd) best = v; }
      else { v.out = true; out++; }
    }
    if (!MONEY) { this.lost = lost; this.outNow = out; this.fastest = best; }
    this.setPhase(PHASE.REVEAL);
    if (MONEY) {
      // suspense: drum roll, then the wrong chests open one at a time and the money drops
      const wrong = shuffle([0, 1, 2, 3].filter(i => i !== q.correct && !this.removed.has(i)));
      this.drops = [0, 1, 2, 3].map(() => null);
      wrong.forEach((i, k) => { this.drops[i] = { at: 1.6 + k * 1.6, done: false }; });
      this.revealDoneT = 1.6 + wrong.length * 1.6 + 0.4; this.revealDone = false;
      audio.intensity = 0; audio.play('drumroll');
      commentator.say(pick(['Мөнгөө харцгаая...', 'Хаана нь мөнгө үлдэх бол...', 'Бэлэн үү? Харцгаая...']), 3, 'm_suspense');
      return;
    }
    audio.intensity = 0; audio.play('win'); setTimeout(() => audio.play(MONEY ? 'whoosh' : 'stumble'), 600);
    let s = `Зөв хариулт: ${NUM_WORD[q.correct].toLowerCase()}, ${q.opts[q.correct]}!`;
    if (lost) s += ' ' + TH.lostLine(lost);
    if (out) s += ' ' + TH.outLine(out);
    commentator.say(s, 3);
    this.burst(540, 760, GREEN, 30, 1.2);
  },
  reveal() {
    if (HERD) return this.herdReveal();
    const q = this.cur, dur = this.duration;
    const entries = [];
    let fastest = null;
    for (const v of this.viewers.values()) {
      const a = this.answers.get(v.id);
      if (!a) continue;
      if (a.opt === q.correct) {
        const frac = clamp(1 - a.t / dur, 0, 1);
        const pts = Math.round((CFG.minPoints + (CFG.maxPoints - CFG.minPoints) * frac)  + CFG.streakBonus * v.streak);
        v.score += pts; v.streak++; v.correct++; v.lastPts = pts;
        this.correctList.push(v);
        entries.push({ id: v.id, name: v.name, avatar: v.avatar, add: pts });
        if (!fastest || a.t < this.answers.get(fastest.id).t) fastest = v;
      } else { v.streak = 0; v.lastPts = 0; }
    }
    this.fastest = fastest;
    scores.add(GAME_KEY, entries).then(r => { for (const [id, pts] of Object.entries(r.all || {})) { const v = this.viewers.get(id); if (v) v.allPts = pts; } refreshBoard(); });
    this.setPhase(PHASE.REVEAL);
    audio.intensity = 0;
    audio.play('win');
    const total = this.answers.size, ok = this.correctList.length;
    let s = `Зөв хариулт: ${NUM_WORD[q.correct].toLowerCase()}, ${q.opts[q.correct]}!`;
    s += total ? ` ${ok} хүн зөв хариуллаа.` : '';
    if (fastest) s += ` Хамгийн хурдан нь ${fastest.name}!`;
    commentator.say(s, 3);
    const streaker = this.correctList.filter(v => v.streak >= 3).sort((a, b) => b.streak - a.streak)[0];
    if (streaker) setTimeout(() => commentator.say(`${streaker.name} ${streaker.streak} удаа дараалан зөв хариуллаа!`, 2), 300);
    this.burst(540, 760, GREEN, 40, 1.3);
    if (this.chooser && this.qIndex + 1 < CFG.questionsPerGame)
      this.announce({ avatar: this.chooser, text: 'СЭДЭВ СОНГО!', sub: `${this.chooser.name}: Түүх · Газарзүй · Соёл · Шинжлэх · Ерөнхий · Спорт`, color: GOLD, dur: 4, prio: 2,
        voice: `${this.chooser.name}, дараагийн асуултын сэдвийг коммент хэсэгт бичээрэй!`, vprio: 2, vkey: 'q_cat' });
  },
  afterReveal() {
    this.qIndex++;
    if (this.qIndex >= CFG.questionsPerGame || (MONEY && this.team <= 0)) {
      this.setPhase(PHASE.FINAL);
      if (HERD) {
        const entries = [...this.viewers.values()].filter(v => MONEY ? v.score > 0 : v.herd > 0).map(v => ({ id: v.id, name: v.name, avatar: v.avatar, add: MONEY ? v.score : v.herd }));
        scores.add(GAME_KEY, entries).then(r => { for (const [id, pts] of Object.entries(r.all || {})) { const v = this.viewers.get(id); if (v) v.allPts = pts; } refreshBoard(); });
      }
      const top = this.top(1)[0];
      if (MONEY) commentator.say(`Тэмцээн дууслаа! Баг ${fmtBig(this.team).replace('₮', ' төгрөг')}-тэй үлдлээ!${top ? ' Шилдэг тоглогч бол ' + top.name + '!' : ''}`, 3);
      else commentator.say(top ? `Тэмцээн өндөрлөлөө! Ялагч бол ${top.name}! Баяр хүргэе!` : 'Тэмцээн өндөрлөлөө!', 3, 'q_champion');
      audio.play('win'); audio.play('cheer');
    } else if (this.qIndex % 5 === 0) {
      this.setPhase(PHASE.BOARD);
      commentator.say('Онооны самбарыг харцгаая!', 2, 'q_board');
    } else this.startIntro();
  },
  top(n) { return [...this.viewers.values()].filter(v => v.score > 0).sort((a, b) => b.score - a.score).slice(0, n); },

  update(dt) {
    this.t += dt; this.phaseT += dt;
    const P = this.phase;
    if (P === PHASE.TOPIC) { if (this.phaseT >= CFG.topicSec) this.endTopic(); }
    else if (P === PHASE.INTRO) { if (this.phaseT >= CFG.introSec) this.startQuestion(); }
    else if (P === PHASE.QUESTION) {
      const left = this.duration - this.phaseT;
      if (left < 5.5 && !this.flags.has('5s')) { this.flags.add('5s'); audio.intensity = 2; commentator.say('Таван секунд үлдлээ!', 2, 'q_5s'); }
      if (left <= 5 && left > 0) { const n = Math.ceil(left); if (n !== this.lastBeep) { this.lastBeep = n; audio.play(n <= 3 ? 'beep' : 'tick'); } }
      if (left <= 0) this.reveal();
    } else if (P === PHASE.REVEAL && MONEY && !this.revealDone) {
      this.drops.forEach(d => { if (d && !d.done && this.phaseT >= d.at) { d.done = true; audio.play('drop'); this.shake = 0.45; } });
      if (this.phaseT >= this.revealDoneT) this.finishMoneyReveal();
    } else if (P === PHASE.REVEAL) { if (this.phaseT >= (MONEY ? this.revealDoneT + 4.5 : CFG.revealSec) && !(window.LBLGoal && LBLGoal.trySpotlight(t => commentator.say(t, 3, 'goal_info')))) this.afterReveal(); }
    else if (P === PHASE.BOARD) { if (this.phaseT >= CFG.boardSec) this.startIntro(); }
    else if (P === PHASE.FINAL) {
      if (this.phaseT >= CFG.finalSec) {
        for (const v of this.viewers.values()) { v.score = 0; v.streak = 0; v.correct = 0; v.herd = null; v.out = false; v.lateHint = false; }
        this.sadFull = false; this.sadUntil = 0;
        this.qIndex = 0; this.game++; this.startIntro();
      }
    }
    this.shake = Math.max(0, this.shake - dt);
    if (MONEY && this.t < this.sadUntil && (this.sadFull || this.sadUntil - this.t < 3))
      for (let k = 0; k < (this.sadFull ? 3 : 1); k++) this.particles.push({ x: rand(0, W), y: rand(140, 400), vx: -40, vy: rand(700, 900), life: 1.4, t: 0, r: 2, color: { h: 210, s: 40, l: 75 }, rain: true });
    if (!this.banner && this.banners.length) this.banner = this.banners.shift();
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
    for (const q of this.particles) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 2.5 * dt; q.vy *= 1 - 2.5 * dt; }
    this.particles = this.particles.filter(q => q.t < q.life);
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  },
};

const lookupQueue = new Set();
setInterval(() => {
  if (!lookupQueue.size) return;
  const ids = [...lookupQueue].slice(0, 200); ids.forEach(id => lookupQueue.delete(id));
  scores.lookup(GAME_KEY, ids).then(m => { for (const [id, pts] of Object.entries(m)) { const v = quiz.viewers.get(id); if (v) v.allPts = pts; } });
}, 3000);
function refreshBoard() { scores.board(GAME_KEY, 5).then(b => { quiz.board = b; }); }

// ───────────────────────────── Rendering ─────────────────────────────
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Noto Sans", sans-serif';
let SCALE = 1, quality = 1, showSafe = false;
function fitCanvas() {
  const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
  const w = Math.round(clamp(rect.width * (window.devicePixelRatio || 1) * quality, 360, 1080));
  if (canvas.width !== w) { canvas.width = w; canvas.height = Math.round(w * 16 / 9); }
  SCALE = canvas.width / W;
}
window.addEventListener('resize', fitCanvas);
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function text(str, x, y, size, color = '#fff', align = 'center', weight = 800, stroke = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(10,5,25,.88)'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function fitText(str, maxW, size, weight = 800) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  if (ctx.measureText(str).width <= maxW) return str;
  let s = str; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
/** word-wrap into at most maxLines lines */
function wrap(str, maxW, size, maxLines, weight = 800) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const words = str.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW) line = t; else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { const rest = lines.slice(maxLines - 1).join(' '); lines.length = maxLines - 1; lines.push(fitText(rest, maxW, size, weight)); }
  return lines;
}
function drawAvatar(p, x, y, r) {
  const img = getAvatar(p.avatar);
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.closePath();
  if (img) { ctx.clip(); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); }
  else { ctx.fillStyle = hsl(p.color || GOLD, -18); ctx.fill(); text(((p.name || '?').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase(), x, y + r * 0.05, r * 1.1, '#fff', 'center', 900); }
  ctx.restore();
}
const pulse = (sp = 4) => 0.5 + 0.5 * Math.sin(quiz.t * sp);

const bgCanvas = document.createElement('canvas'); bgCanvas.width = 270; bgCanvas.height = 480;
(function drawBg() {
  const c = bgCanvas.getContext('2d'); c.setTransform(0.25, 0, 0, 0.25, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, H);
  if (MONEY) { g.addColorStop(0, '#4a0b12'); g.addColorStop(0.5, '#25060c'); g.addColorStop(1, '#0a0204'); }
  else { g.addColorStop(0, '#24104a'); g.addColorStop(0.5, '#140b33'); g.addColorStop(1, '#07041a'); }
  if (MONEY) {                       // studio spotlights
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (const [x0, ang] of [[160, 0.35], [540, 0], [920, -0.35]]) {
      c.save(); c.translate(x0, 0); c.rotate(ang);
      const cone = c.createLinearGradient(0, 0, 0, 1500); cone.addColorStop(0, 'rgba(255,220,150,.22)'); cone.addColorStop(1, 'rgba(255,220,150,0)');
      c.fillStyle = cone; c.beginPath(); c.moveTo(-30, 0); c.lineTo(30, 0); c.lineTo(260, 1500); c.lineTo(-260, 1500); c.closePath(); c.fill(); c.restore();
    }
  }
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  [[150, 400, 'rgba(37,244,238,.12)'], [950, 800, 'rgba(255,61,127,.12)'], [500, 1400, 'rgba(255,209,102,.08)']].forEach(([x, y, col]) => {
    const r = c.createRadialGradient(x, y, 0, x, y, 520); r.addColorStop(0, col); r.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H);
  });
})();

function drawHeader() {
  const ty = 186, n = CFG.questionsPerGame;
  const goalOn = !!(window.LBLGoal && LBLGoal.active);
  if (goalOn) LBLGoal.draw(ctx, 30, 146, W - 60, 78);   // donation goal replaces the title row
  if (!goalOn) {
  const TITLE = HERD ? TH.title : 'АСУУЛТ ХАРИУЛТ';
  text(TITLE, 34, ty, 52, '#fff', 'left', 900, 10);
  ctx.font = `900 52px ${FONT}`; const tw = ctx.measureText(TITLE).width;
  const px = 34 + tw + 16;
  roundRect(px, ty - 26, 150, 52, 26); ctx.fillStyle = quiz.phase === PHASE.QUESTION ? '#ff2d55' : 'rgba(255,255,255,.14)'; ctx.fill();
  text(`${Math.min(quiz.qIndex + 1, n)}/${n}`, px + 75, ty + 1, 26, '#fff', 'center', 900);
  for (let i = 0; i < n; i++) {
    const dx = W - 36 - (n - 1 - i) * 18, done = i < quiz.qIndex, cur = i === quiz.qIndex;
    ctx.beginPath(); ctx.arc(dx, ty, cur ? 7 : 5.5, 0, TAU); ctx.fillStyle = done ? '#ffd166' : cur ? '#ff2d55' : 'rgba(255,255,255,.25)'; ctx.fill();
  }
  }
  const cards = [
    HERD ? ['answer', '💬', '1 60 3 40', TH.card, CYAN] : ['answer', '💬', '1–4 БИЧ', 'Хариулах', CYAN],
    HERD ? ['rose', '🌹', 'ROSE', 'Хөрөнгө оруулалт', PINK] : ['like', '❤', 'LIKE', 'Хамтдаа 50/50', RED],
    HERD ? ['gift', '🎁', 'GIFT', 'МАЛЧИН-д хөрөнгө', GOLD] : ['rose', '🌹', 'ROSE', 'Хамтын тусламж', PINK],
    HERD ? ['goal', '🐑', 'ХАНДИВ', 'Нэр тань үлдэнэ', GREEN] : ['gift', '🎁', 'GIFT', '+5с · 50/50', GOLD],
  ];
  const cw = 252, chh = 88, cy = 234, gap = 8;
  if (!HERD) cards.forEach(([key, ic, title, desc, col], i) => {
    const cx = 30 + i * (cw + gap);
    const now = key === 'answer' && (quiz.phase === PHASE.QUESTION || quiz.phase === PHASE.TOPIC);
    const lit = Math.max(clamp(1 - (quiz.t - (quiz.flash[key] ?? -9)) / 0.7, 0, 1), now ? 0.4 + 0.4 * pulse(6) : 0);
    roundRect(cx, cy, cw, chh, 20); ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.14 * lit})`; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = hsl(col, 0, 0.35 + 0.65 * lit); ctx.stroke();
    text(ic, cx + 40, cy + chh / 2, 38 + 8 * lit, '#fff', 'center', 400);
    text(title, cx + 76, cy + 29, 25, hsl(col, 10), 'left', 900);
    text(fitText(desc, cw - 84, 21, 700), cx + 76, cy + 62, 21, '#fff', 'left', 700);
  });
  const sy = HERD ? 262 : 362, P = quiz.phase; let s, col = '#25f4ee';
  if (P === PHASE.TOPIC) { s = `🗂 Сэдэв сонго · ${Math.ceil(Math.max(0, CFG.topicSec - quiz.phaseT))}с · ${quiz.topicVoters.size} санал`; col = '#ffd166'; }
  else if (P === PHASE.INTRO) s = `❓ Асуулт ${quiz.qIndex + 1} удахгүй…`;
  else if (HERD && P === PHASE.QUESTION) {
    const left = Math.max(0, quiz.duration - quiz.phaseT);
    s = MONEY ? `⏱ ${Math.ceil(left)}с · 💰 Баг: ${fmtBig(quiz.team)} · ${quiz.alloc.size} санал` : `⏱ ${Math.ceil(left)}с · ${TH.players(quiz.players())}`; col = left < 5 ? (pulse(10) > 0.5 ? '#ff4d6d' : '#fff') : '#ffd166';
  } else if (HERD && P === PHASE.REVEAL) s = MONEY ? (quiz.revealDone ? `💰 Багт ${fmtBig(quiz.team)} үлдлээ · 💸 ${fmtBig(quiz.lost)} унав` : '🥁 Мөнгө хаана үлдэх бол...') : TH.lostStatus(quiz.lost);
  else if (P === PHASE.QUESTION) {
    const left = Math.max(0, quiz.duration - quiz.phaseT);
    s = `⏱ ${Math.ceil(left)}с · ${quiz.answers.size} хариулт`; col = left < 5 ? (pulse(10) > 0.5 ? '#ff4d6d' : '#fff') : '#ffd166';
  } else if (P === PHASE.REVEAL) s = `✅ ${quiz.correctList.length} хүн зөв хариуллаа`;
  else if (P === PHASE.BOARD) s = '🏆 Онооны самбар';
  else s = '🎉 Тэмцээн өндөрлөлөө';
  if (goalOn) s = `${Math.min(quiz.qIndex + 1, n)}/${n} · ` + s;
  text(fitText(s, W - 330, 31, 900), 34, sy, 31, col, 'left', 900, 7);
  text(`❤ ${fmt(quiz.totalLikes)}  💎 ${fmt(quiz.totalDiamonds)}`, W - 30, sy, 22, 'rgba(255,255,255,.8)', 'right', 800, 5);
  const champ = quiz.board.week && quiz.board.week[0];
  if (champ && !MONEY) text(fitText(`👑 7 хоног: ${champ.name}`, 330, 20, 800), W - 30, sy + 44, 20, '#ffd166', 'right', 800, 5);
  if (MONEY) { drawLadder(sy + 54); return; }
  const f = quiz.feed[0];
  if (f && quiz.t - f.t < 4) text(fitText(f.text, W - 420, 22, 700), 34, sy + 44, 22, hsl(f.color, 15), 'left', 700, 5);
}

/** money mode: the steps of the game and how much the team had left after each */
function drawLadder(y) {
  const n = CFG.questionsPerGame, x0 = 70, x1 = W - 70, step = (x1 - x0) / n;
  const hidden = quiz.phase === PHASE.REVEAL && !quiz.revealDone;           // don't show the new amount before the drop
  const known = hidden ? quiz.ladder.length - 1 : quiz.ladder.length;
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  if (known > 1) { ctx.strokeStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + step * (known - 1), y); ctx.stroke(); }
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * step, done = i < known, cur = i === known && quiz.phase !== PHASE.FINAL;
    const amt = done ? quiz.ladder[i] : null, zero = done && amt === 0;
    ctx.beginPath(); ctx.arc(x, y, cur ? 17 : 14, 0, TAU);
    ctx.fillStyle = zero ? '#5b6b7d' : done ? '#ffd166' : cur ? `rgba(255,45,85,${0.6 + 0.4 * pulse(6)})` : 'rgba(255,255,255,.18)'; ctx.fill();
    text(i === 0 ? '★' : String(i), x, y + 1, i === 0 ? 16 : 16, done ? '#1a0f33' : '#fff', 'center', 900);
    if (done) text(zero ? '0 😢' : `${Math.round(amt / UNIT)} сая`, x, y + 30, 17, zero ? '#9fb3c8' : '#ffd166', 'center', 900, 4);
    else if (cur) text('?', x, y + 30, 18, '#fff', 'center', 900, 4);
  }
}

function drawQuestion() {
  const P = quiz.phase;
  if (P === PHASE.TOPIC) return drawTopic();
  const q = quiz.cur; if (!q) return;
  if (P === PHASE.BOARD || P === PHASE.FINAL) return;
  // question card
  const y0 = AREA.top, hq = 220;
  roundRect(30, y0, W - 60, hq, 28); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
  roundRect(54, y0 - 18, 0, 0, 0);
  const chip = `${CAT_ICON[q.c] || '❓'} ${q.c} · ${['', 'Маш амархан', 'Амархан', 'Дунд', 'Хэцүү', 'Маш хэцүү'][q.d || 3]}`;
  ctx.font = `900 22px ${FONT}`; const cwid = ctx.measureText(chip).width + 32;
  roundRect(56, y0 - 20, cwid, 40, 20); ctx.fillStyle = '#7b3fe4'; ctx.fill();
  text(chip, 56 + cwid / 2, y0 + 1, 22, '#fff', 'center', 900);
  if (quiz.sponsor) {
    const sp = `🎁 Ивээн тэтгэсэн: ${quiz.sponsor.name}`;
    text(fitText(sp, 420, 20, 800), W - 54, y0 + hq - 20, 20, '#7b3fe4', 'right', 800);
  }
  if (P === PHASE.INTRO) {
    const k = 1 + 0.06 * pulse(8);
    text(`АСУУЛТ ${quiz.qIndex + 1}`, W / 2, y0 + hq / 2, 76 * k, '#24104a', 'center', 900);
  } else {
    const lines = wrap(q.q, W - 140, 44, 3, 800);
    const lh = 54, start = y0 + hq / 2 - (lines.length - 1) * lh / 2 + 6;
    lines.forEach((l, i) => text(l, W / 2, start + i * lh, 44, '#1a0f33', 'center', 800));
  }
  // timer bar
  if (P === PHASE.QUESTION) {
    const frac = clamp(1 - quiz.phaseT / quiz.duration, 0, 1);
    roundRect(30, y0 + hq + 14, W - 60, 16, 8); ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fill();
    roundRect(30, y0 + hq + 14, (W - 60) * frac, 16, 8); ctx.fillStyle = frac < 0.25 ? '#ff4d6d' : frac < 0.5 ? '#ffd166' : '#25f4ee'; ctx.fill();
  }
  if (P === PHASE.INTRO) {
    if (HERD) drawRule(y0 + hq + 50);
    return;
  }
  // options
  const oy = y0 + hq + 46, oh = 92, gap = 12;
  if (HERD) { if (MONEY && P === PHASE.QUESTION) drawRule(y0 + hq + 44); return drawPens(q, oy, oh, gap); }
  const total = Math.max(1, quiz.counts.reduce((a, b) => a + b, 0));
  q.opts.forEach((o, i) => {
    const y = oy + i * (oh + gap);
    const removed = quiz.removed.has(i), isRight = i === q.correct, rev = P === PHASE.REVEAL;
    const col = OPT[i];
    ctx.globalAlpha = removed ? 0.3 : rev && !isRight ? 0.45 : 1;
    roundRect(30, y, W - 60, oh, 24); ctx.fillStyle = 'rgba(12,8,30,.85)'; ctx.fill();
    // live answer distribution
    const frac = quiz.counts[i] / total;
    if (quiz.counts[i]) { roundRect(30, y, Math.max(48, (W - 60) * frac), oh, 24); ctx.fillStyle = hsl(col, 0, 0.35); ctx.fill(); }
    ctx.lineWidth = rev && isRight ? 7 : 3;
    ctx.strokeStyle = rev && isRight ? `rgba(109,255,176,${0.7 + 0.3 * pulse(8)})` : hsl(col); roundRect(30, y, W - 60, oh, 24); ctx.stroke();
    ctx.beginPath(); ctx.arc(82, y + oh / 2, 32, 0, TAU); ctx.fillStyle = hsl(col); ctx.fill();
    text(String(i + 1), 82, y + oh / 2 + 2, 40, '#fff', 'center', 900);
    text(fitText(o, W - 330, 36, 800), 132, y + oh / 2 + 1, 36, '#fff', 'left', 800);
    text(`${quiz.counts[i]} · ${Math.round(frac * 100)}%`, W - 60, y + oh / 2 + 1, 24, 'rgba(255,255,255,.85)', 'right', 800);
    if (removed) { ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(60, y + oh / 2); ctx.lineTo(W - 60, y + oh / 2); ctx.stroke(); }
    if (rev && isRight) text('✅', W - 210, y + oh / 2, 40, '#fff', 'center', 400);
    ctx.globalAlpha = 1;
  });
  // shared like goal
  const ly = oy + 4 * (oh + gap) + 8;
  const lf = clamp(quiz.likesQ / CFG.likeGoal, 0, 1);
  roundRect(30, ly, W - 60, 40, 20); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
  roundRect(30, ly, Math.max(40, (W - 60) * lf), 40, 20); ctx.fillStyle = quiz.likeRemoved ? 'rgba(109,255,176,.5)' : 'rgba(255,77,109,.6)'; ctx.fill();
  text(quiz.likeRemoved ? '❤ Хамтын хүчээр буруу хариулт арилсан!' : `❤ ${Math.min(quiz.likesQ, CFG.likeGoal)} / ${CFG.likeGoal} — хамтдаа нэг буруу хариултыг арилга`, W / 2, ly + 21, 21, '#fff', 'center', 800, 4);
  // bottom ribbon: who answered / fastest
  const ry = ly + 70;
  if (P === PHASE.QUESTION) {
    text('Хариулсан:', 34, ry, 22, 'rgba(255,255,255,.7)', 'left', 800);
    quiz.recent.slice(0, 11).forEach((r, k) => {
      const x = 180 + k * 76, a = clamp((quiz.t - r.t) / 0.25, 0, 1);
      ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, ry, 28, 0, TAU); ctx.fillStyle = hsl(r.v.color); ctx.fill(); drawAvatar(r.v, x, ry, 25);
      ctx.globalAlpha = 1;
    });
  } else if (P === PHASE.REVEAL) {
    const f = quiz.fastest;
    if (f) {
      ctx.beginPath(); ctx.arc(70, ry, 32, 0, TAU); ctx.fillStyle = '#ffd166'; ctx.fill(); drawAvatar(f, 70, ry, 28);
      text(fitText(`⚡ Хамгийн хурдан: ${f.name}`, 640, 28, 900), 116, ry - 12, 28, '#ffd166', 'left', 900, 6);
      text(`+${f.lastPts} оноо${f.streak >= 2 ? ` · 🔥${f.streak} дараалан` : ''}`, 116, ry + 20, 22, '#fff', 'left', 800, 5);
    } else text('Энэ удаа хэн ч зөв хариулсангүй 😮', W / 2, ry, 28, '#fff', 'center', 800, 6);
  }
}

function drawTopic() {
  const y0 = AREA.top, left = Math.max(0, CFG.topicSec - quiz.phaseT);
  text('🗂 СЭДВЭЭ СОНГО!', W / 2, y0 + 50, 56, '#ffd166', 'center', 900, 10);
  text('Comment-д 1 эсвэл 2 бич', W / 2, y0 + 112, 30, '#fff', 'center', 800, 6);
  const tot = Math.max(1, quiz.topicVotes[0] + quiz.topicVotes[1]);
  quiz.topics.forEach((c, i) => {
    const y = y0 + 170 + i * 250, col = OPT[i];
    roundRect(60, y, W - 120, 220, 30); ctx.fillStyle = 'rgba(12,8,30,.85)'; ctx.fill();
    const f = quiz.topicVotes[i] / tot;
    if (quiz.topicVotes[i]) { roundRect(60, y, Math.max(60, (W - 120) * f), 220, 30); ctx.fillStyle = hsl(col, 0, 0.35); ctx.fill(); }
    ctx.lineWidth = 4; ctx.strokeStyle = hsl(col); roundRect(60, y, W - 120, 220, 30); ctx.stroke();
    ctx.beginPath(); ctx.arc(150, y + 110, 56, 0, TAU); ctx.fillStyle = hsl(col); ctx.fill();
    text(String(i + 1), 150, y + 114, 70, '#fff', 'center', 900);
    text(`${CAT_ICON[c] || '❓'} ${c}`, 240, y + 88, 52, '#fff', 'left', 900, 6);
    text(`${quiz.topicVotes[i]} санал · ${Math.round(f * 100)}%`, 240, y + 150, 28, 'rgba(255,255,255,.85)', 'left', 800);
  });
  text(String(Math.ceil(left)), W / 2, y0 + 720, 90, left < 4 ? '#ff4d6d' : '#ffd166', 'center', 900, 12);
}

/** a stylised bundle of (fictional) ₮ notes — deliberately not a real banknote design */
function drawCash(x, y, r, alpha = 1, burn = 0) {
  ctx.globalAlpha *= alpha;
  const w = r * 2.6, h = r * 1.4;
  for (let k = 2; k >= 0; k--) {
    const ox = x - w / 2 + k * 2, oy = y - h / 2 - k * 3;
    roundRect(ox, oy, w, h, 3);
    ctx.fillStyle = burn > 0 ? `hsl(${120 - burn * 100},${50 + burn * 40}%,${45 - burn * 15}%)` : k ? '#5f9e63' : '#7fc184'; ctx.fill();
    ctx.strokeStyle = 'rgba(20,60,25,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.fillStyle = '#e8c547'; ctx.fillRect(x - 3, y - h / 2 - 6, 6, h + 6);         // paper band
  text('₮', x - w * 0.28, y - 4, r * 1.1, 'rgba(20,60,25,.9)', 'center', 900);
  ctx.globalAlpha = 1;
}

/** Mongolian painted chest (авдар), seen slightly from above. burn 0..1 chars it, glow marks the right answer. */
function drawChest(cx, cy, col, burn, glow) {
  if (glow) {
    const g = ctx.createRadialGradient(cx, cy - 20, 20, cx, cy - 20, 170);
    g.addColorStop(0, `rgba(255,215,100,${0.55 + 0.25 * pulse(6)})`); g.addColorStop(1, 'rgba(255,215,100,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - 170, cy - 190, 340, 340);
  }
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(cx + 8, cy + 54, 108, 16, 0, 0, TAU); ctx.fill();
  // front face
  const fg = ctx.createLinearGradient(0, cy - 50, 0, cy + 50);
  fg.addColorStop(0, '#2385a1'); fg.addColorStop(1, '#114a5c');
  roundRect(cx - 100, cy - 50, 200, 100, 8); ctx.fillStyle = fg; ctx.fill();
  // lid (top face)
  ctx.beginPath(); ctx.moveTo(cx - 100, cy - 50); ctx.lineTo(cx + 100, cy - 50); ctx.lineTo(cx + 84, cy - 74); ctx.lineTo(cx - 84, cy - 74); ctx.closePath();
  ctx.fillStyle = '#2f9cba'; ctx.fill();
  ctx.strokeStyle = hsl(col); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx - 100, cy - 50); ctx.lineTo(cx + 100, cy - 50); ctx.stroke();
  // gold trim + ornament (simplified өлзий knot and corner brackets)
  ctx.strokeStyle = '#e8c547'; ctx.lineWidth = 3;
  roundRect(cx - 92, cy - 42, 184, 84, 6); ctx.stroke();
  ctx.save(); ctx.translate(cx, cy + 2); ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-17, -17, 34, 34); ctx.strokeRect(-9, -9, 18, 18); ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy + 2, 30, 0, TAU); ctx.stroke();
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const ex = cx + sx * 80, ey = cy + sy * 30;
    ctx.beginPath(); ctx.moveTo(ex, ey - sy * 14); ctx.lineTo(ex, ey); ctx.lineTo(ex - sx * 14, ey); ctx.stroke();
  }
  if (burn > 0) {                                    // charred
    roundRect(cx - 100, cy - 74, 200, 124, 8); ctx.fillStyle = `rgba(20,8,4,${0.65 * burn})`; ctx.fill();
  }
}

/** Top-down chest lid (авдар) with gold ornament. burn 0..1 chars it, glow marks the right answer. */
function drawLidTop(cx, cy, w, h, col, burn, glow) {
  if (glow) {
    const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 190);
    g.addColorStop(0, `rgba(255,215,100,${0.55 + 0.25 * pulse(6)})`); g.addColorStop(1, 'rgba(255,215,100,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - 190, cy - 190, 380, 380);
  }
  ctx.fillStyle = 'rgba(0,0,0,.4)'; roundRect(cx - w / 2 + 8, cy - h / 2 + 10, w, h, 14); ctx.fill();      // floor shadow
  const lg = ctx.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  lg.addColorStop(0, '#2f9cba'); lg.addColorStop(1, '#155a6e');
  roundRect(cx - w / 2, cy - h / 2, w, h, 14); ctx.fillStyle = lg; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = hsl(col); ctx.stroke();                                         // answer colour rim
  ctx.strokeStyle = '#e8c547'; ctx.lineWidth = 3;
  roundRect(cx - w / 2 + 12, cy - h / 2 + 12, w - 24, h - 24, 8); ctx.stroke();
  // өлзий knot in the middle + corner brackets
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-22, -22, 44, 44); ctx.strokeRect(-12, -12, 24, 24); ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, 38, 0, TAU); ctx.stroke();
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const ex = cx + sx * (w / 2 - 22), ey = cy + sy * (h / 2 - 22);
    ctx.beginPath(); ctx.moveTo(ex, ey - sy * 16); ctx.lineTo(ex, ey); ctx.lineTo(ex - sx * 16, ey); ctx.stroke();
  }
  if (burn > 0) { roundRect(cx - w / 2, cy - h / 2, w, h, 14); ctx.fillStyle = `rgba(20,8,4,${0.7 * burn})`; ctx.fill(); }
}

/** a (fictional) ₮ bundle lying flat, seen from above */
function drawCashTop(x, y, ang, alpha, burn) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(ang);
  const w = 54, h = 26;
  roundRect(-w / 2 + 2, -h / 2 + 3, w, h, 3); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
  roundRect(-w / 2, -h / 2, w, h, 3);
  ctx.fillStyle = burn > 0 ? `hsl(${120 - burn * 100},${50 + burn * 40}%,${48 - burn * 18}%)` : '#7fc184'; ctx.fill();
  ctx.strokeStyle = 'rgba(20,60,25,.85)'; ctx.lineWidth = 1.5; ctx.stroke();
  roundRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 2); ctx.strokeStyle = 'rgba(20,60,25,.4)'; ctx.stroke();
  ctx.fillStyle = '#e8c547'; ctx.fillRect(-3, -h / 2, 6, h);                    // paper band
  ctx.restore();
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(ang);
  text('₮', -15, 1, 16, 'rgba(20,60,25,.9)', 'center', 900); ctx.restore();
}

/** MONEY mode, seen from directly above: four chests in an arc, answer label above each, money lying on the lids. */
function drawStations(q, rev, sh, pl, total) {
  const dy = AREA.top - 440, xs = [148, 404, 676, 932], ys = [1000 + dy, 935 + dy, 935 + dy, 1000 + dy], LW = 200, LH = 158;
  const done = !rev || quiz.revealDone, suspense = rev && !quiz.revealDone;
  q.opts.forEach((o, i) => {
    const cx0 = xs[i], cy0 = ys[i], col = OPT[i];
    const removed = quiz.removed.has(i), isRight = i === q.correct;
    const d = rev ? quiz.drops[i] : null;
    const dp = d ? clamp((quiz.phaseT - d.at) / 1.1, 0, 1) : 0;          // 0 → 1 drop progress
    const dropped = d && quiz.phaseT >= d.at;
    // chests tremble while everyone waits
    const tremble = suspense && !dropped ? (quiz.phaseT < 1.6 ? 1.5 : 2.5) : 0;
    const cx = cx0 + (tremble ? Math.sin(quiz.t * 47 + i) * tremble : 0), cy = cy0 + (tremble ? Math.cos(quiz.t * 53 + i) * tremble : 0);
    ctx.globalAlpha = removed ? 0.35 : 1;
    // answer label
    const sw = 238, shh = 92, sx = cx0 - sw / 2, sy = cy0 - LH / 2 - shh - 12;
    const good = rev && done && isRight;
    roundRect(sx, sy, sw, shh, 16); ctx.fillStyle = 'rgba(8,6,20,.94)'; ctx.fill();
    ctx.lineWidth = good ? 6 : 3;
    ctx.strokeStyle = good ? `rgba(109,255,176,${0.7 + 0.3 * pulse(8)})` : dropped ? '#ff4d6d' : hsl(col); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + 4, sy + 4, 22, 0, TAU); ctx.fillStyle = hsl(col); ctx.fill();
    text(String(i + 1), sx + 4, sy + 6, 28, '#fff', 'center', 900);
    const lines = wrap(o, sw - 28, 26, 2, 800);
    lines.forEach((l, k) => text(l, cx0, sy + shh / 2 + (k - (lines.length - 1) / 2) * 30 + 2, 26, '#fff', 'center', 800));
    // the lid splits and slides open over a dark pit
    const open = clamp(dp * 2.2, 0, 1);
    if (open > 0) {
      roundRect(cx - LW / 2, cy - LH / 2, LW, LH, 14);
      const pit = ctx.createRadialGradient(cx, cy, 10, cx, cy, LW * 0.7);
      pit.addColorStop(0, '#000'); pit.addColorStop(1, '#1a0a06'); ctx.fillStyle = pit; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = hsl(col); ctx.stroke();
    }
    if (open < 1) {
      ctx.save();
      if (open > 0) {                                   // two halves sliding apart
        const half = (LW / 2) * (1 - open);
        ctx.beginPath(); ctx.rect(cx - LW / 2, cy - LH / 2 - 10, half, LH + 20); ctx.rect(cx + LW / 2 - half, cy - LH / 2 - 10, half, LH + 20); ctx.clip();
      }
      drawLidTop(cx, cy, LW, LH, col, 0, good);
      ctx.restore();
    } else if (good) drawLidTop(cx, cy, LW, LH, col, 0, true);
    // money on the lid; falls into the pit when it opens
    const f = sh[i] / total, n = sh[i] ? clamp(Math.round(f * 12), 1, 12) : 0;
    const fall = clamp((dp - 0.12) / 0.75, 0, 1);
    for (let k = 0; k < n; k++) {
      const c = k % 3, r = Math.floor(k / 3);
      const jx = Math.sin(k * 12.9 + i) * 5, jy = Math.cos(k * 7.3 + i) * 4, ang = Math.sin(k * 3.1 + i * 2) * 0.25;
      let bx = cx + (c - 1) * 58 + jx, by = cy - 51 + r * 34 + jy;
      if (fall > 0) {                                   // shrink toward the centre of the pit = falling away
        const e = fall * fall;
        bx = bx + (cx - bx) * e; by = by + (cy - by) * e;
        ctx.save(); ctx.translate(bx, by); ctx.scale(1 - 0.8 * e, 1 - 0.8 * e); ctx.translate(-bx, -by);
        drawCashTop(bx, by, ang + e * (k % 2 ? 2 : -2), 1 - e * 0.9, 0);
        ctx.restore();
      } else drawCashTop(bx, by, ang, 1, 0);
    }
    if (dropped && dp < 0.7) {                          // the "ПАЛ!" moment
      const k = dp / 0.7;
      text('ПАЛ!', cx0, cy0 - 10 - k * 20, 54 * (1 + 0.3 * (1 - k)), `rgba(255,77,109,${1 - k})`, 'center', 900, 8);
    }
    const shown = dropped ? sh[i] * (1 - fall) : sh[i];
    text(`💵 ${TH.amount(shown)}`, cx0, cy0 + LH / 2 + 22, 24, dropped ? '#ff8a9a' : '#fff', 'center', 900, 5);
    text(`${pl[i]} хүн · ${Math.round(f * 100)}%`, cx0, cy0 + LH / 2 + 46, 18, 'rgba(255,255,255,.8)', 'center', 800, 4);
    if (removed) text('✖', cx0, cy0, 100, '#ff4d6d', 'center', 900, 8);
    if (good) text('✅', cx0 + sw / 2 - 6, sy + 4, 38, '#fff', 'center', 400);
    ctx.globalAlpha = 1;
  });
}

function drawSheep(x, y, r, alpha = 1) {
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#f4f1e8';
  for (const [dx, dy] of [[-r * 0.5, 0], [0, -r * 0.35], [r * 0.5, 0], [0, r * 0.3]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, r * 0.62, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#2b2522'; ctx.beginPath(); ctx.ellipse(x + r * 1.05, y, r * 0.42, r * 0.34, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}

/** HERD mode: four pens; sheep placed live; on reveal wolves chase the sheep out of the wrong pens. */
function drawPens(q, oy, oh, gap) {
  const P = quiz.phase, rev = P === PHASE.REVEAL;
  const { sh, pl } = rev && quiz.prePlaced ? quiz.prePlaced : quiz.placed();
  const total = Math.max(1, sh.reduce((a, b) => a + b, 0));
  const chase = rev ? clamp(quiz.phaseT / 2.4, 0, 1) : 0;
  if (MONEY) drawStations(q, rev, sh, pl, total);
  else q.opts.forEach((o, i) => {
    const y = oy + i * (oh + gap);
    const removed = quiz.removed.has(i), isRight = i === q.correct, wrong = rev && !isRight;
    const col = OPT[i];
    ctx.globalAlpha = removed ? 0.3 : 1;
    roundRect(30, y, W - 60, oh, 24); ctx.fillStyle = wrong ? `rgba(60,10,20,${0.6 + 0.3 * chase})` : 'rgba(12,8,30,.85)'; ctx.fill();
    const f = sh[i] / total;
    if (sh[i] && !wrong) { roundRect(30, y, Math.max(48, (W - 60) * f), oh, 24); ctx.fillStyle = hsl(col, 0, 0.3); ctx.fill(); }
    ctx.lineWidth = rev && isRight ? 7 : 3;
    ctx.strokeStyle = rev && isRight ? `rgba(109,255,176,${0.7 + 0.3 * pulse(8)})` : wrong ? '#ff4d6d' : hsl(col); roundRect(30, y, W - 60, oh, 24); ctx.stroke();
    ctx.beginPath(); ctx.arc(82, y + oh / 2, 32, 0, TAU); ctx.fillStyle = hsl(col); ctx.fill();
    text(String(i + 1), 82, y + oh / 2 + 2, 40, '#fff', 'center', 900);
    text(fitText(o, 420, 34, 800), 132, y + oh / 2 + 1, 34, '#fff', 'left', 800);
    // sheep in the pen (up to 8 icons), running away on a wrong answer
    const n = sh[i] ? clamp(Math.round(f * (MONEY ? 10 : 8)), 1, MONEY ? 10 : 8) : 0;
    for (let k = 0; k < n; k++) {
      let sx = 600 + k * 34, sy = y + oh / 2 + (k % 2 ? 12 : -10);
      if (MONEY) { sx = 590 + (k % 5) * 44; sy = y + oh / 2 + (k < 5 ? 14 : -14); }
      let al = 1;
      if (wrong) { sx += chase * (420 + k * 30); al = 1 - chase; }
      if (MONEY) { if (wrong) { sx -= chase * (420 + k * 30); sy -= chase * 40; }   // money burns in place
        if (al > 0.02) drawCash(sx, sy, 15, al, wrong ? chase : 0); }
      else if (al > 0.02) drawSheep(sx, sy + Math.sin(quiz.t * 8 + k) * (wrong ? 3 : 1), 11, al);
    }
    if (wrong && chase < 1) {
      if (MONEY) { for (let k = 0; k < 4; k++) text('🔥', 610 + k * 60, y + oh / 2 - Math.abs(Math.sin(quiz.t * 9 + k)) * 10, 40 * (0.6 + chase * 0.6), '#fff', 'center', 400);
        if (Math.random() < 0.5) quiz.particles.push({ x: rand(600, 820), y: y + oh / 2, vx: rand(-30, 30), vy: rand(-160, -60), life: 0.8, t: 0, r: rand(3, 6), color: { h: 25, s: 100, l: 55 } }); }
      else text('🐺', 560 + chase * 520, y + oh / 2, 44, '#fff', 'center', 400);
    }
    const shown = wrong ? sh[i] * (1 - chase) : sh[i];
    text(`${TH.unitIcon} ${TH.amount(shown)}`, W - 56, y + oh / 2 - 14, 24, '#fff', 'right', 900, 4);
    text(`${pl[i]} хүн · ${Math.round(f * 100)}%`, W - 56, y + oh / 2 + 18, 18, 'rgba(255,255,255,.75)', 'right', 800, 3);
    if (removed) { ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(60, y + oh / 2); ctx.lineTo(W - 60, y + oh / 2); ctx.stroke(); }
    if (rev && isRight) text('✅', 560, y + oh / 2, 40, '#fff', 'center', 400);
    ctx.globalAlpha = 1;
  });
  drawHerdRanking(oy + 4 * (oh + gap) + 6);
}

/** Live top-6 by money / sheep (replaces the shared like goal in herd & money modes). */
function drawRule(y) {
  if (MONEY) {
    const shown = quiz.phase === PHASE.REVEAL && !quiz.revealDone ? quiz.teamBefore : quiz.team;
    text(`👥 БҮГД НЭГ БАГ · 💰 ${fmtBig(shown)} = ${Math.round(shown / UNIT)} боодол`, W / 2, y, 25, '#ffd166', 'center', 900, 5);
    text('Comment: «2» эсвэл «1 60 3 40» · саналын дунджаар байрлана · 1 авдар ХООСОН', W / 2, y + 30, 19, '#25f4ee', 'center', 800, 4);
    return;
  }
  text(fitText(`${fmt(CFG.startHerd)} хонь · 1 хариултыг ХООСОН үлдээ`, W - 60, 21, 800), W / 2, y, 21, '#ffd166', 'center', 800, 4);
  text('Comment: «2» = бүгдийг 2-т · «1 60 3 40» = 60% нь 1-д, 40% нь 3-т', W / 2, y + 28, 20, '#25f4ee', 'center', 800, 4);
}

/** personal confirmations while answering; everyone's result after the reveal */
function drawNotes(y) {
  const P = quiz.phase;
  if (P === PHASE.REVEAL && (!MONEY || quiz.revealDone) && (quiz.results.length || MONEY)) {
    const parts = MONEY
      ? quiz.results.slice().sort((a, b) => b.pts - a.pts).map(r => `${r.v.name} +${r.pts} оноо`)
      : quiz.results.slice().sort((a, b) => b.after - a.after).map(r => `${r.v.name} ${TH.amount(r.before)} → ${r.after ? TH.amount(r.after) : '0 😢'}${r.idle ? ' (хариулаагүй)' : ''}`);
    const line = (MONEY ? `💰 Багт ${fmtBig(quiz.team)} үлдлээ:   ` : '💰 Хэдтэй үлдсэн:   ') + parts.join('   ·   ') + '   ·   ';
    ctx.save(); ctx.beginPath(); ctx.rect(30, y, W - 60, 60); ctx.clip();
    ctx.font = `800 22px ${FONT}`; const lw = ctx.measureText(line).width;
    const off = lw > W - 60 ? (quiz.phaseT * 110) % lw : 0;
    text(line, 34 - off, y + 30, 22, '#fff', 'left', 800, 5);
    if (off) text(line, 34 - off + lw, y + 30, 22, '#fff', 'left', 800, 5);
    ctx.restore();
    return;
  }
  if (P !== PHASE.QUESTION) return;
  quiz.notes.slice(0, 2).forEach((n, k) => {
    const a = clamp(1 - (quiz.t - n.t - 5) / 1, 0, 1); if (a <= 0) return;
    ctx.globalAlpha = a;
    text(fitText(n.text, W - 70, 21, 800), 34, y + 16 + k * 30, 21, hsl(n.color, 15), 'left', 800, 4);
    ctx.globalAlpha = 1;
  });
}

function drawHerdRanking(y) {
  const P = quiz.phase;
  const hide = MONEY && P === PHASE.REVEAL && !quiz.revealDone;           // don't spoil the drop
  const list = hide ? (quiz.preRank || []) : quiz.herdTop(6).map(v => ({ v, herd: MONEY ? v.score : v.herd }));
  text('🏆 ШИЛДЭГ ТОГЛОГЧИД', 34, y + 14, 22, '#ffd166', 'left', 900, 5);
  text(MONEY ? `👥 ${quiz.alloc.size} санал · виртуал мөнгө, шагнал биш` : TH.players(quiz.players()), W - 34, y + 14, 19, 'rgba(255,255,255,.75)', 'right', 800, 4);
  if (!list.length) {
    text(P === PHASE.QUESTION ? (MONEY ? 'Comment-д «2» эсвэл «1 60 3 40» гэж бичээд багтаа тусал!' : `«2» = ${TH.all} 2-т · «1 60 3 40» = 60% 1-д, 40% 3-т`) : 'Comment-д хариултаа бичээд тоглоорой!', W / 2, y + 74, 24, '#25f4ee', 'center', 900, 5);
    text(TH.start(CFG.startHerd), W / 2, y + 108, 19, 'rgba(255,255,255,.75)', 'center', 700, 4);
    drawNotes(y + 130);
    return;
  }
  const cw = (W - 60 - 20) / 3, ch = 64, MED = ['#ffd166', '#d9dee8', '#e0a070'];
  list.forEach(({ v, herd }, k) => {
    const cx = 30 + (k % 3) * (cw + 10), cy = y + 34 + Math.floor(k / 3) * (ch + 8);
    roundRect(cx, cy, cw, ch, 16); ctx.fillStyle = k < 3 ? 'rgba(255,209,102,.16)' : 'rgba(255,255,255,.07)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = k < 3 ? MED[k] : 'rgba(255,255,255,.15)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 22, cy + ch / 2, 15, 0, TAU); ctx.fillStyle = k < 3 ? MED[k] : 'rgba(255,255,255,.25)'; ctx.fill();
    text(String(k + 1), cx + 22, cy + ch / 2 + 1, 18, '#1a0f33', 'center', 900);
    ctx.beginPath(); ctx.arc(cx + 62, cy + ch / 2, 21, 0, TAU); ctx.fillStyle = hsl(v.color); ctx.fill(); drawAvatar(v, cx + 62, cy + ch / 2, 19);
    text(fitText(v.name, cw - 100, 19, 800), cx + 90, cy + ch / 2 - 11, 19, '#fff', 'left', 800);
    text(MONEY ? `⭐ ${fmt(herd)} оноо` : `${TH.unitIcon} ${TH.amount(herd)}`, cx + 90, cy + ch / 2 + 13, 18, '#ffd166', 'left', 900);
  });
  drawNotes(y + 34 + 2 * (ch + 8) + 2);
}

function drawBoard() {
  const P = quiz.phase;
  if (P !== PHASE.BOARD && P !== PHASE.FINAL) return;
  const top = AREA.top - 10;
  roundRect(30, top, W - 60, AREA.bottom - top, 30); ctx.fillStyle = 'rgba(10,6,28,.88)'; ctx.fill();
  text(P === PHASE.FINAL ? (MONEY ? (quiz.team > 0 ? `🎉 БАГ ${fmtBig(quiz.team)}-ТЭЙ ДУУСЛАА` : '😢 БАГ БҮХ МӨНГӨӨ АЛДЛАА') : HERD ? TH.final : '🎉 ТЭМЦЭЭНИЙ ДҮН') : `🏆 ${HERD ? TH.board : 'ОНООНЫ'} САМБАР · ${quiz.qIndex}/${CFG.questionsPerGame}`, W / 2, top + 50, 40, '#ffd166', 'center', 900, 8);
  const list = quiz.top(P === PHASE.FINAL ? 6 : 8);
  if (!list.length) text(HERD ? TH.none : 'Одоогоор оноо авсан хүн алга', W / 2, top + 160, 28, '#fff', 'center', 700);
  const row = (v, k, y, pts, gold) => {
    roundRect(70, y - 25, W - 140, 50, 18); ctx.fillStyle = gold ? 'rgba(255,209,102,.3)' : 'rgba(255,255,255,.07)'; ctx.fill();
    text(['🥇', '🥈', '🥉'][k] || String(k + 1), 112, y, 26, '#fff', 'center', 900);
    ctx.beginPath(); ctx.arc(166, y, 20, 0, TAU); ctx.fillStyle = '#ffd166'; ctx.fill(); drawAvatar(v, 166, y, 18);
    text(fitText(v.name, 380, 24, 800), 198, y - 1, 24, '#fff', 'left', 800);
    const tt = titleFor(v.allPts ?? v.pts);
    if (v.streak >= 2) text(`🔥${v.streak}`, 640, y, 22, '#ffd166', 'center', 900);
    else if (tt && tt.icon) text(tt.icon, 640, y, 22, '#fff', 'center', 400);
    text(MONEY ? `${fmt(pts)} оноо` : HERD ? `${TH.unitIcon} ${TH.amount(pts)}` : fmt(pts), W - 100, y, 24, '#ffd166', 'right', 900);
  };
  list.forEach((v, k) => row(v, k, top + 120 + k * 60, v.score, k === 0));
  if (P === PHASE.FINAL) {
    text('👑 ЭНЭ 7 ХОНОГИЙН АВАРГА', W / 2, top + 500, 26, '#ffd166', 'center', 900, 6);
    (quiz.board.week || []).slice(0, 3).forEach((r, k) => row({ name: r.name, avatar: r.avatar, color: GOLD, pts: r.pts }, k, top + 556 + k * 60, r.pts, k === 0));
    if (MONEY) text(fitText('Шат бүрт: ' + quiz.ladder.map(v => Math.round(v / UNIT)).join(' → ') + ' сая', W - 120, 24, 800), W / 2, AREA.bottom - 66, 24, quiz.team > 0 ? '#ffd166' : '#9fb3c8', 'center', 800, 5);
    text(MONEY && quiz.team <= 0 ? `Харамсалтай... Дараагийн тоглолт ${Math.ceil(CFG.finalSec - quiz.phaseT)}с — эргээд ирээрэй!` : `Шинэ тоглолт ${Math.ceil(CFG.finalSec - quiz.phaseT)}с`, W / 2, AREA.bottom - 30, 22, 'rgba(255,255,255,.7)', 'center', 700);
    if (Math.random() < 0.6 && !(MONEY && quiz.team <= 0)) quiz.particles.push({ x: rand(0, W), y: AREA.top, vx: rand(-50, 50), vy: rand(200, 420), life: 2.2, t: 0, r: rand(5, 10), color: nextColor(), confetti: true });
  } else text(`Дараагийн асуулт ${Math.ceil(CFG.boardSec - quiz.phaseT)}с`, W / 2, AREA.bottom - 30, 22, 'rgba(255,255,255,.7)', 'center', 700);
}

function drawBanner() {
  const b = quiz.banner; if (!b) return;
  const t = b.t, inK = clamp(t / 0.22, 0, 1), outK = clamp((b.dur - t) / 0.3, 0, 1);
  const s = (0.6 + 0.4 * (1 - Math.pow(1 - inK, 3))) * (outK < 1 ? 0.9 + 0.1 * outK : 1);
  ctx.save(); ctx.globalAlpha = Math.min(inK * 1.5, outK);
  ctx.translate(W / 2, AREA.bottom - 70); ctx.scale(s, s);
  const w = 900, h = b.sub ? 124 : 92;
  roundRect(-w / 2, -h / 2, w, h, 28); ctx.fillStyle = 'rgba(8,6,26,.92)'; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = hsl(b.color); ctx.stroke();
  let tx = 0;
  if (b.avatar) { ctx.beginPath(); ctx.arc(-w / 2 + 66, 0, 46, 0, TAU); ctx.fillStyle = hsl(b.color); ctx.fill(); drawAvatar(b.avatar, -w / 2 + 66, 0, 41); tx = 50; }
  else text(b.icon || '', -w / 2 + 60, 0, 52, '#fff', 'center', 400);
  text(fitText(b.text, w - 200, 42, 900), tx + 20, b.sub ? -20 : 0, 42, hsl(b.color, 15), 'center', 900, 8);
  if (b.sub) text(fitText(b.sub, w - 170, 25, 800), tx + 20, 31, 25, '#fff', 'center', 800, 6);
  ctx.restore();
}

function drawSafeZones() {
  if (!showSafe) return;
  ctx.fillStyle = 'rgba(255,0,60,.22)'; ctx.fillRect(0, 0, W, SAFE.top); ctx.fillRect(0, SAFE.bottom, W, H - SAFE.bottom);
  text('TikTok UI', W / 2, SAFE.top / 2, 30, '#fff', 'center', 800, 6); text('TikTok UI (comment, gift)', W / 2, (SAFE.bottom + H) / 2, 34, '#fff', 'center', 800, 6);
}

let audioHint = false;
function render() {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  ctx.save();
  if (quiz.shake > 0) ctx.translate(rand(-1, 1) * quiz.shake * 22, rand(-1, 1) * quiz.shake * 22);
  drawQuestion();
  drawBoard();
  ctx.restore();
  if (MONEY && quiz.t < quiz.sadUntil) {                          // sadness: colour drains out, blue-grey tint
    const k = quiz.sadFull ? clamp((quiz.t - (quiz.sadUntil - 999)) / 1.5, 0, 1) : clamp((quiz.sadUntil - quiz.t) / 0.6, 0, 1) * 0.6;
    ctx.save(); ctx.globalAlpha = k; ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.fillRect(0, SAFE.top, W, SAFE.bottom - SAFE.top); ctx.restore();
    ctx.fillStyle = `rgba(20,30,55,${0.35 * k})`; ctx.fillRect(0, SAFE.top, W, SAFE.bottom - SAFE.top);
  }
  if (window.LBLGoal) LBLGoal.drawSpotlight(ctx, 30, AREA.top - 10, W - 60, AREA.bottom - AREA.top + 10);
  for (const q of quiz.particles) {
    const a = 1 - q.t / q.life; ctx.globalAlpha = a; ctx.fillStyle = hsl(q.color, 10);
    if (q.rain) { ctx.globalAlpha = 0.5; ctx.fillRect(q.x, q.y, 2, 22); }
    else if (q.confetti) { ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.t * 6 + q.r); ctx.fillRect(-q.r, -q.r / 2, q.r * 2, q.r); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(q.x, q.y, q.r * a, 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  drawHeader();
  drawBanner();
  drawSafeZones();
  if (audioHint && !audio.running) {
    roundRect(330, 1240, 420, 52, 26); ctx.fillStyle = 'rgba(255,45,85,.9)'; ctx.fill();
    text('🔊 Дуу асаахын тулд дарна уу', 540, 1267, 22, '#fff', 'center', 800);
  }
}

// ───────────────────────────── Simulator ─────────────────────────────
const NAMES = ['bataa_99', 'saraa.mn', 'tuguldur', 'anu_x', 'khulan', 'temka', 'zola.ub', 'boldoo', 'misheel', 'nomin',
  'ganzo', 'oyunaa', 'tsogoo', 'enkhjin', 'dulmaa', 'azaa_7', 'bilguun', 'naraa', 'khuslen', 'erdene', 'munkh', 'solongo'];
let simMsg = 0;
const simUser = (name) => ({ id: 'sim_' + name, uniqueId: name, nickname: name, avatar: '', isFollower: true });
function sim(type, name, extra = {}) { quiz.handleEvent({ type, user: simUser(name), msgId: 'qs' + (++simMsg), ...extra }); }
const SIM_GIFTS = {
  rose: { name: 'Rose', diamonds: 1, count: 1 }, small: { name: 'Heart Me', diamonds: 5, count: 1 },
  big: { name: 'Lion', diamonds: 299, count: 1 }, huge: { name: 'Galaxy', diamonds: 1000, count: 1 },
};
function botAnswer(name) {
  if (HERD && quiz.phase === PHASE.TOPIC) return sim('comment', name, { text: String(1 + Math.floor(Math.random() * 2)) });
  const q = quiz.cur; if (!q) return;
  if (HERD) {
    const guess = Math.random() < 0.55 ? q.correct : Math.floor(Math.random() * 4), other = (guess + 1 + Math.floor(Math.random() * 3)) % 4;
    const p = 40 + Math.floor(Math.random() * 6) * 10;
    return sim('comment', name, { text: Math.random() < 0.4 ? String(guess + 1) : `${guess + 1} ${p} ${other + 1} ${100 - p}` });
  }
  let opt = Math.random() < 0.55 ? q.correct : Math.floor(Math.random() * 4);
  if (quiz.removed.has(opt)) opt = q.correct;
  sim('comment', name, { text: String(opt + 1) });
}
let autoSim = false, autoAcc = 0;
function autoSimTick(dt) {
  if (!autoSim) return;
  autoAcc += dt;
  while (autoAcc > 0.1) {
    autoAcc -= 0.1;
    if (quiz.phase === PHASE.TOPIC && Math.random() < 0.15) { botAnswer(pick(NAMES)); continue; }
    if (quiz.phase !== PHASE.QUESTION) continue;
    const name = pick(NAMES), r = Math.random();
    if (r < 0.08) botAnswer(name);
    else if (r < 0.6) sim('like', name, { count: 1 + Math.floor(Math.random() * 5) });
    else if (r < 0.61) sim('gift', name, { gift: SIM_GIFTS.rose });
    else if (r < 0.613) sim('gift', name, { gift: SIM_GIFTS.small });
  }
}

// ───────────────────────────── Recorded voice lines ─────────────────────────────
const QUIZ_LINES = [
  ['q_new',      'Шинэ асуулт',          'Шинэ асуулт!'],
  ['q_5s',       '5 секунд үлдэх',       'Таван секунд үлдлээ!'],
  ['q_fifty',    'Хамтын 50/50',         'Хамтын хүчээр нэг буруу хариулт арилав!'],
  ['q_time',     'Gift: цаг нэмэх',      'Баярлалаа! Бүгдэд таван секунд нэмэгдлээ!'],
  ['q_help',     'Gift: буруу арилгах',  'Баярлалаа! Бүгдэд нэг буруу хариулт арилав!'],
  ['q_cat',      'Сэдэв сонгох',         'Дараагийн асуултын сэдвийг коммент хэсэгт бичээрэй!'],
  ['q_board',    'Онооны самбар',        'Онооны самбарыг харцгаая!'],
  ['goal_info',  'Тоглоомын танилцуулга', 'МАЛЧИН тоглоомын тухай... (өөрийн танилцуулгаа бичнэ)'],
  ['goal_step',  'Зорилгын 25/50/75%',   'Зорилгын нэг хэсэг биеллээ! Баярлалаа!'],
  ['goal_done',  'Зорилго биелэх',       'Зорилго биеллээ! Бүгдэд баярлалаа!'],
  ['m_invest',   'Gift: хөрөнгө оруулалт', 'Баярлалаа! Таны нэр тоглоомд мөнхлөгдөнө!'],
  ['m_suspense', 'Мөнгө: хүлээлт',      'Мөнгөө харцгаая...'],
  ['h_topic',    'Сэдэв сонгох (сүрэг)', 'Сэдвээ сонгоцгооё! Коммент хэсэгт нэг эсвэл хоёр гэж бичээрэй!'],
  ['q_champion', 'Тэмцээн өндөрлөх',     'Тэмцээн өндөрлөлөө! Баяр хүргэе!'],
];

// ───────────────────────────── Bridge client ─────────────────────────────
const bridge = {
  ws: null, url: '', lastSeq: 0, boot: '', retry: 0, timer: null, wanted: false,
  connect(url) { this.url = url; this.wanted = true; this.retry = 0; commentator.ttsBase = httpBase(url); scores.base = commentator.ttsBase; this.open(); },
  disconnect() { this.wanted = false; clearTimeout(this.timer); if (this.ws) this.ws.close(); setStatus('Салгасан (симуляц горим)', 'off'); },
  open() {
    clearTimeout(this.timer);
    try { this.ws = new WebSocket(this.url); } catch { return this.schedule(); }
    setStatus('Холбогдож байна…', 'warn');
    this.ws.onopen = () => { this.retry = 0; commentator.loadClips(); this.ws.send(JSON.stringify({ type: 'hello', lastSeq: this.lastSeq })); setStatus('Bridge-тэй холбогдлоо', 'ok'); };
    this.ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'status') {
        if (msg.boot && msg.boot !== this.boot) { if (this.boot) this.lastSeq = 0; this.boot = msg.boot; }
        setStatus(msg.text, msg.level || 'ok');
        if (typeof msg.viewers === 'number') quiz.viewerCount = msg.viewers;
        return;
      }
      if (msg.type === 'goal') { if (window.LBLGoal) LBLGoal.update(msg.goal); return; }
      if (msg.type === 'events') { for (const ev of msg.events) this.accept(ev); return; }
      this.accept(msg);
    };
    this.ws.onclose = () => { if (this.wanted) this.schedule(); };
    this.ws.onerror = () => {};
  },
  accept(ev) {
    if (typeof ev.seq === 'number') { if (ev.seq <= this.lastSeq) return; this.lastSeq = ev.seq; }
    quiz.handleEvent(ev);
  },
  schedule() {
    const delay = Math.min(30, 1.5 * 2 ** this.retry++);
    setStatus(`Холболт тасарлаа · ${Math.round(delay)}с-ийн дараа дахин оролдоно`, 'warn');
    this.timer = setTimeout(() => this.open(), delay * 1000);
  },
};
function httpBase(wsUrl) { try { const u = new URL(wsUrl); return `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`; } catch { return ''; } }
function refreshAudioBtn() {
  const b = $('audioOn'); if (!b) return;
  b.textContent = audio.running ? '🔊 Дуу асаалттай' : '🔇 Дуу асаах';
  b.classList.toggle('on', audio.running);
}
function initAudioPanel() {
  const S = audio.settings;
  refreshAudioBtn();
  $('audioOn').onclick = () => { audio.unlock(); setTimeout(refreshAudioBtn, 100); };
  const bindRange = (id, key, after) => { const el = $(id); el.value = S[key]; el.oninput = () => { S[key] = parseFloat(el.value); audio.applyVolumes(); audio.save(); after && after(); }; };
  bindRange('sfxVol', 'sfxVol', () => audio.play('gift'));
  bindRange('musicVol', 'musicVol');
  bindRange('voiceVol', 'voiceVol');
  bindRange('voiceRate', 'voiceRate');
  const mus = $('musicOn'); mus.checked = S.music; mus.onchange = () => { S.music = mus.checked; audio.applyVolumes(); audio.save(); };
  const mode = $('voiceMode'); mode.value = S.voiceMode;
  mode.onchange = () => { S.voiceMode = mode.value; audio.save(); commentator.stop(); updateVoiceInfo(); };
  const chat = $('voiceChatty'); chat.value = S.voiceChatty; chat.onchange = () => { S.voiceChatty = +chat.value; audio.save(); };
  const vsel = $('voiceName');
  const fill = () => {
    const vs = commentator.loadVoices();
    vsel.innerHTML = '<option value="">Автомат (mn → ru)</option>' + vs.map(v => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name} (${v.lang})</option>`).join('');
    vsel.value = S.voiceName; updateVoiceInfo();
  };
  fill();
  if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', fill);
  vsel.onchange = () => { S.voiceName = vsel.value; audio.save(); updateVoiceInfo(); };
  $('voiceTest').onclick = () => { audio.unlock(); commentator.stop(); commentator.say('Сайн байна уу! Асуулт хариултад тавтай морил. Коммент хэсэгт хариултынхаа дугаарыг бичээрэй!', 3); };
  commentator.onError = (e) => { $('voiceInfo').textContent = `Azure хоолой ажилласангүй (${e.message}). Bridge дээр AZURE_SPEECH_KEY тохируулсан эсэхээ шалгана уу.`; $('voiceInfo').className = 'status warn'; };
}
function updateVoiceInfo() {
  const S = audio.settings, el = $('voiceInfo');
  if (S.voiceMode === 'off') { el.textContent = 'Тайлбарлагч унтарсан'; el.className = 'status off'; return; }
  if (S.voiceMode === 'azure') { el.textContent = 'Azure монгол neural хоолой (bridge-ээр)'; el.className = 'status ok'; return; }
  const v = commentator.pickVoice();
  if (!('speechSynthesis' in window)) { el.textContent = 'Энэ браузерт TTS байхгүй — Azure горимыг ашиглана уу'; el.className = 'status warn'; }
  else if (v && /^mn/i.test(v.lang)) { el.textContent = `Монгол хоолой: ${v.name}`; el.className = 'status ok'; }
  else { el.textContent = `Монгол хоолой олдсонгүй → ${v ? v.name : 'үндсэн хоолой'} уншина. Жинхэнэ монгол дуудлагад Azure горим зөвлөнө.`; el.className = 'status warn'; }
}

// ── recorder: the streamer records commentary lines in their own voice ──
const recorder = { stream: null, mr: null, key: '', timer: null };
function voiceBase() { return commentator.ttsBase || (location.protocol.startsWith('http') ? location.origin : ''); }
function initRecorder() {
  const S = audio.settings;
  const cb = $('useRecorded'); cb.checked = S.useRecorded;
  cb.onchange = () => { S.useRecorded = cb.checked; audio.save(); };
  commentator.loadClips().then(renderVoiceList);
  if (voiceBase()) setInterval(() => commentator.loadClips(), 20000); // OBS copy picks up new recordings
}
function renderVoiceList() {
  const box = $('voiceList'); box.innerHTML = '';
  if (!voiceBase()) { box.innerHTML = '<div class="status warn">Хоолой бичихийн тулд тоглоомыг start.bat-аар (http://localhost:8787) нээнэ үү.</div>'; return; }
  for (const [key, label, line] of QUIZ_LINES) {
    const files = commentator.clips[key] || [];
    const row = document.createElement('div'); row.className = 'vrow';
    row.innerHTML = `<div class="top"><span class="name"></span><span class="cnt ${files.length ? 'has' : ''}">${files.length ? '✓ ' + files.length : 'бичээгүй'}</span>
      <button class="rec">● Бичих</button><button class="play" ${files.length ? '' : 'disabled'}>▶</button><button class="del" ${files.length ? '' : 'disabled'} title="Сүүлийн бичлэгийг устгах">🗑</button></div>
      <div class="say"></div>`;
    row.querySelector('.name').textContent = label;
    row.querySelector('.say').textContent = '“' + line + '”';
    const recBtn = row.querySelector('.rec');
    if (recorder.key === key) { recBtn.classList.add('on'); recBtn.textContent = '■ Зогсоох'; }
    recBtn.onclick = () => recorder.key === key ? stopRecording() : startRecording(key);
    row.querySelector('.play').onclick = () => { audio.unlock(); commentator.stop(); commentator.say(line, 3, key); };
    row.querySelector('.del').onclick = async () => {
      if (!confirm(`"${label}" — сүүлийн бичлэгийг устгах уу?`)) return;
      await fetch(`${voiceBase()}/voices/${encodeURIComponent(files[files.length - 1])}`, { method: 'DELETE' });
      await commentator.loadClips(); renderVoiceList();
    };
    box.append(row);
  }
}
async function startRecording(key) {
  if (recorder.key) stopRecording();
  try {
    if (!recorder.stream) recorder.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) { alert('Микрофон ашиглах зөвшөөрөл өгөөгүй байна: ' + e.message); return; }
  commentator.stop();
  const chunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const mr = new MediaRecorder(recorder.stream, mime ? { mimeType: mime } : undefined);
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = () => uploadRecording(key, new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
  recorder.mr = mr; recorder.key = key;
  mr.start();
  recorder.timer = setTimeout(stopRecording, 10000);   // safety: max 10 s per line
  renderVoiceList();
}
function stopRecording() {
  clearTimeout(recorder.timer);
  if (recorder.mr && recorder.mr.state !== 'inactive') recorder.mr.stop();
  recorder.key = ''; recorder.mr = null;
  renderVoiceList();
}
/** Trim silence at both ends, normalise loudness, encode as WAV, upload to the bridge. */
async function uploadRecording(key, blob) {
  let body = blob, type = blob.type;
  try {
    audio.init();
    const buf = await audio.ctx.decodeAudioData(await blob.arrayBuffer());
    const d = buf.getChannelData(0), sr = buf.sampleRate;
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const th = Math.max(0.02, peak * 0.08);
    let a = 0, b = d.length - 1;
    while (a < d.length && Math.abs(d[a]) < th) a++;
    while (b > a && Math.abs(d[b]) < th) b--;
    a = Math.max(0, a - Math.floor(sr * 0.08)); b = Math.min(d.length - 1, b + Math.floor(sr * 0.25));
    if (b - a < sr * 0.2) { alert('Дуу бичигдсэнгүй. Микрофоноо шалгаад дахин оролдоно уу.'); return; }
    const gain = peak > 0 ? Math.min(4, 0.9 / peak) : 1;
    const n = b - a + 1, out = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, str) => { for (let i = 0; i < str.length; i++) out.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
    w(36, 'data'); out.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const fade = Math.min(1, i / (sr * 0.01), (n - 1 - i) / (sr * 0.03)); // tiny fades, no clicks
      out.setInt16(44 + i * 2, clamp(d[a + i] * gain * fade, -1, 1) * 0x7fff, true);
    }
    body = new Blob([out], { type: 'audio/wav' }); type = 'audio/wav';
  } catch (e) { console.warn('trim failed, uploading raw', e); }
  const r = await fetch(`${voiceBase()}/voices/${key}`, { method: 'POST', headers: { 'Content-Type': type }, body }).catch(() => null);
  if (!r || !r.ok) { alert('Хадгалж чадсангүй. Bridge (start.bat) ажиллаж байгаа эсэхийг шалгана уу.'); return; }
  await commentator.loadClips();
  renderVoiceList();
  commentator.say('', 3, key); // play it back once
}



// ───────────────────────────── UI + boot ─────────────────────────────
const $ = (id) => document.getElementById(id);
function setStatus(msg, level) { const el = $('wsStatus'); el.textContent = msg; el.className = 'status ' + level; }

function initPanel() {
  const params = new URLSearchParams(location.search);
  const overlay = params.get('overlay') === '1';
  if (overlay) document.body.classList.add('overlay');
  showSafe = params.get('safe') === '1';
  if (params.get('ws')) $('wsUrl').value = params.get('ws') === 'auto' ? `ws://${location.host}` : params.get('ws');
  commentator.ttsBase = httpBase($('wsUrl').value) || (location.protocol.startsWith('http') ? location.origin : '');
  scores.base = commentator.ttsBase;
  if (params.get('ws') || params.get('connect') === '1') bridge.connect($('wsUrl').value);
  if (window.LBLGoal) {
    LBLGoal.start(commentator.ttsBase);
    LBLGoal.on(e => { if (e.type === 'milestone') quiz.announce({ icon: '🐑', text: `ЗОРИЛГЫН ${e.pct}% БИЕЛЛЭЭ!`, sub: e.goal.config.title, color: { h: 45, s: 100, l: 60 }, dur: 3.2, prio: 3,
      voice: e.pct >= 100 ? `Зорилго биеллээ! ${e.goal.config.title} Бүгдэд баярлалаа!` : `Зорилгын ${e.pct} хувь биеллээ! Баярлалаа!`, vprio: 3, vkey: e.pct >= 100 ? 'goal_done' : 'goal_step' }); });
  }
  if (params.get('demo') === '1') { autoSim = true; addBots(14); }
  if (params.get('voice')) audio.settings.voiceMode = params.get('voice');

  audio.unlock();
  audioHint = !overlay;
  const unlock = () => { audio.unlock(); refreshAudioBtn(); };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  audio.onState = refreshAudioBtn;
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide-panel');
  });
  $('wsConnect').onclick = () => {
    if (bridge.wanted) { bridge.disconnect(); $('wsConnect').textContent = 'Холбох'; }
    else { bridge.connect($('wsUrl').value.trim()); $('wsConnect').textContent = 'Салгах'; }
  };
  if (bridge.wanted) $('wsConnect').textContent = 'Салгах';
  $('simRandom').onclick = () => { $('simUser').value = pick(NAMES) + '_' + Math.floor(Math.random() * 90 + 10); };
  const who = () => $('simUser').value.trim() || 'guest';
  document.querySelectorAll('[data-vote]').forEach(b => b.onclick = () => sim('comment', who(), { text: b.dataset.vote }));
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const act = b.dataset.act;
    if (act === 'follow') sim('follow', who());
    else if (act === 'like1') sim('like', who(), { count: 1 });
    else if (act === 'like15') sim('like', who(), { count: 15 });
    else sim('gift', who(), { gift: SIM_GIFTS[act] });
  });
  const send = () => { const v = $('simComment').value; if (!v) return; sim('comment', who(), { text: v }); $('simComment').value = ''; };
  $('simSend').onclick = send;
  $('simComment').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  $('addBots').onclick = () => addBots(10);
  $('autoSim').onclick = () => { autoSim = !autoSim; $('autoSim').classList.toggle('on', autoSim); };
  $('autoSim').classList.toggle('on', autoSim);
  $('nextPhase').onclick = () => {
    const P = quiz.phase;
    if (P === PHASE.INTRO) quiz.phaseT = CFG.introSec; else if (P === PHASE.QUESTION) quiz.reveal();
    else if (P === PHASE.REVEAL) quiz.phaseT = CFG.revealSec; else if (P === PHASE.BOARD) quiz.phaseT = CFG.boardSec; else quiz.phaseT = CFG.finalSec;
  };
  $('resetAll').onclick = () => {
    if (!confirm('Бүх оноог арилгаж тоглолтыг эхнээс нь эхлүүлэх үү?')) return;
    quiz.viewers.clear(); quiz.totalLikes = 0; quiz.totalDiamonds = 0; quiz.seen = new SeenSet(); quiz.feed = [];
    quiz.qIndex = 0; quiz.startIntro();
  };
  $('safeZone').onclick = () => { showSafe = !showSafe; $('safeZone').classList.toggle('on', showSafe); };
  $('safeZone').classList.toggle('on', showSafe);
  initAudioPanel();
  initRecorder();
  buildBalance();
}

let botN = 0;
function addBots(n) {
  for (let k = 0; k < n; k++) {
    const name = NAMES[botN % NAMES.length] + (botN >= NAMES.length ? '_' + Math.floor(botN / NAMES.length) : '');
    botN++;
    if (quiz.phase === PHASE.QUESTION) botAnswer(name); else sim('follow', name);
  }
}

function buildBalance() {
  const box = $('balance'); box.innerHTML = '';
  for (const k of Object.keys(CONFIG_LABELS)) {
    const lab = document.createElement('label'); lab.textContent = CONFIG_LABELS[k]; lab.htmlFor = 'cfg_' + k;
    const inp = document.createElement('input'); inp.type = 'number'; inp.id = 'cfg_' + k; inp.step = 'any'; inp.value = CFG[k];
    inp.oninput = () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) CFG[k] = v; };
    box.append(lab, inp);
  }
  $('balSave').onclick = () => { saveConfig(); $('balSave').textContent = 'Хадгалсан ✓'; setTimeout(() => $('balSave').textContent = 'Хадгалах', 1200); };
  $('balReset').onclick = () => { CFG = { ...DEFAULT_CONFIG }; saveConfig(); buildBalance(); };
}

let last = performance.now(), ftAvg = 16, qT = 0;
function frame(ts) {
  const raw = (ts - last) / 1000, dt = Math.min(0.05, raw); last = ts;
  ftAvg += (raw * 1000 - ftAvg) * 0.05; qT += raw;
  if (qT > 3) {
    qT = 0;
    if (ftAvg > 24 && quality > 0.6) { quality = Math.max(0.6, quality - 0.15); fitCanvas(); }
    else if (ftAvg < 15 && quality < 1) { quality = Math.min(1, quality + 0.1); fitCanvas(); }
  }
  autoSimTick(dt);
  quiz.update(dt);
  render();
  requestAnimationFrame(frame);
}

quiz.startIntro();
initPanel();
fitCanvas();
refreshBoard();
requestAnimationFrame(frame);
window.QUIZ = { quiz, bridge, sim, audio, commentator, CFG: () => CFG };
})();
