/* МОРИН УРАЛДААН — Naadam horse race for TikTok LIVE
 * Viewers vote for a horse by commenting its number (1–6), then cheer it on:
 * every like speeds it up, gifts give a big "speed feed". Six races, one per
 * Naadam age class (Даага … Азарга). Top-down view, logical canvas 1080×1920.
 *
 * Layout keeps clear of TikTok's UI (y < 140 and y > 1300).
 */
(() => {
'use strict';
const { audio, commentator } = window.LBLAudio;

// ───────────────────────────── Config ─────────────────────────────
const DEFAULT_CONFIG = {
  voteSec: 25,          // voting phase length
  readySec: 5,          // "Гийнгоо" + 3-2-1
  raceSec: 50,          // race length with nobody cheering
  resultSec: 11,
  finaleSec: 16,
  likePower: 1,         // how much likes speed a horse up
  giftPower: 1,         // how much gifts speed a horse up
  likesPerSecCap: 10,   // anti-spam per viewer
  likeBurst: 40,
  pointsWin: [100, 60, 40, 25, 15, 0], // viewer points by their horse's place
  uyachBonus: 30,       // top supporter of each horse
};
const CFG_KEY = 'race.config.v1';
const CONFIG_LABELS = {
  voteSec: 'Санал авах (сек)', readySec: 'Гараа (сек)', raceSec: 'Уралдааны урт (сек)', resultSec: 'Дүн харуулах (сек)',
  likePower: 'Like-ийн хүч', giftPower: 'Gift-ийн хүч', likesPerSecCap: 'Like/сек хязгаар', uyachBonus: 'Уяачийн бонус',
};
let CFG = loadConfig();
function loadConfig() { try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { ...DEFAULT_CONFIG }; } }
function saveConfig() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch {} }

// ───────────────────────────── Constants & utils ─────────────────────────────
const W = 1080, H = 1920, TAU = Math.PI * 2;
const SAFE = { top: 140, bottom: 1300 };
const TRACK = { top: 448, laneH: 98, lanes: 6, x0: 150 };      // lanes y 448 … 1036
const TRACK_BOTTOM = TRACK.top + TRACK.laneH * TRACK.lanes;
const L = 9000;                                                 // world length of a race
const CLASSES = [
  { name: 'ДААГА',    age: '2 настай',  km: 12, size: 0.8 },
  { name: 'ШҮДЛЭН',   age: '3 настай',  km: 16, size: 0.87 },
  { name: 'ХЯЗААЛАН', age: '4 настай',  km: 20, size: 0.93 },
  { name: 'СОЁОЛОН',  age: '5 настай',  km: 24, size: 1.0 },
  { name: 'ИХ НАС',   age: '6+ настай', km: 28, size: 1.06 },
  { name: 'АЗАРГА',   age: 'азарга',    km: 26, size: 1.1 },
];
// coat name, body colour, dark (mane/tail) colour
const COATS = [
  ['Хээр', '#8a4b2c', '#3b1f12'], ['Зээрд', '#b8662a', '#6d3714'], ['Хар', '#2f2826', '#0f0d0c'],
  ['Саарал', '#a9a9a6', '#5d5d5b'], ['Цагаан', '#efe9dc', '#b8b0a0'], ['Шарга', '#d4ae63', '#5a4220'],
  ['Хонгор', '#d89b5d', '#a2683a'], ['Бор', '#6e5c4b', '#3a3027'], ['Хүрэн', '#5c3423', '#2a160d'], ['Халиун', '#c49255', '#2a1d12'],
];
const LANE = [
  { h: 355, s: 85, l: 55 }, { h: 212, s: 88, l: 55 }, { h: 135, s: 70, l: 42 },
  { h: 46, s: 95, l: 52 }, { h: 280, s: 70, l: 58 }, { h: 24, s: 95, l: 55 },
];
const GOLD = { h: 45, s: 100, l: 60 }, RED = { h: 350, s: 95, l: 62 }, CYAN = { h: 178, s: 90, l: 55 }, GREEN = { h: 140, s: 85, l: 55 };
const PHASE = { VOTE: 'VOTE', READY: 'READY', RACE: 'RACE', RESULT: 'RESULT', FINALE: 'FINALE' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => performance.now() / 1000;
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
const hsl = (c, dl = 0, a = 1) => `hsla(${c.h},${c.s}%,${clamp(c.l + dl, 0, 100)}%,${a})`;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

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

// ───────────────────────────── Game state ─────────────────────────────
const race = {
  t: 0, phase: PHASE.VOTE, phaseT: 0, round: 0,
  horses: [], viewers: new Map(),
  camX: 0, leader: null, leaderSaidAt: -99, firstFinishT: 0, finishOrder: [],
  totalLikes: 0, totalDiamonds: 0, viewerCount: 0,
  feed: [], banners: [], banner: null, particles: [], floaters: [], flash: {}, flags: new Set(),
  seen: new SeenSet(), lastBeep: 0, gallopT: 0,
  lastResult: null,

  get cls() { return CLASSES[this.round]; },

  viewer(user) {
    if (!user || !user.id) return null;
    let v = this.viewers.get(user.id);
    if (!v) {
      v = { id: user.id, name: user.nickname || user.uniqueId || user.id, avatar: user.avatar || '', color: nextColor(),
            score: 0, wins: 0, vote: -1, likeTokens: CFG.likeBurst, likeAt: now(), pending: 0, hinted: -1, commentAt: -99, gifts: 0 };
      this.viewers.set(v.id, v);
    } else {
      if (user.avatar) v.avatar = user.avatar;
      if (user.nickname) v.name = user.nickname;
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
      case 'follow': return this.onFollow(ev.user);
      case 'share': { const v = this.viewer(ev.user); if (v && v.vote >= 0) this.boost(this.horses[v.vote], v, 4); return; }
    }
  },

  canVote() { return this.phase === PHASE.VOTE || this.phase === PHASE.READY || this.phase === PHASE.RACE; },

  vote(v, i) {
    if (!this.canVote() || v.vote >= 0) return false;
    const h = this.horses[i];
    v.vote = i; h.votes.add(v.id);
    this.flash.vote = this.t;
    this.pushFeed(`🗳 ${v.name} → ${i + 1}`, LANE[i]);
    audio.play('vote');
    return true;
  },

  onComment(user, text) {
    const v = this.viewer(user); if (!v) return;
    const m = text.trim().match(/^[#№]?\s*([1-6])(?!\d)/);
    if (m) {
      const i = +m[1] - 1;
      if (v.vote < 0) { this.vote(v, i); return; }
    }
    // any comment cheers your horse a little (once per 3 s)
    if (v.vote >= 0 && this.phase === PHASE.RACE && this.t - v.commentAt > 3) { v.commentAt = this.t; this.boost(this.horses[v.vote], v, 3); }
  },

  onLike(user, count) {
    const v = this.viewer(user); if (!v) return;
    this.totalLikes += count; this.flash.like = this.t;
    if (v.vote < 0) {
      if (this.canVote() && v.hinted !== this.round) { v.hinted = this.round; this.pushFeed(`💬 ${v.name}: эхлээд 1–6 бичиж морио сонго!`, CYAN); }
      return;
    }
    v.pending = Math.min(v.pending + count, 300);
  },

  onGift(user, gift) {
    const v = this.viewer(user); if (!v) return;
    const count = Math.max(1, gift.count | 0), dia = Math.max(1, gift.diamonds | 0), value = dia * count;
    this.totalDiamonds += value; v.gifts += value;
    if (v.vote < 0 && this.canVote()) {
      // gifted without voting: they back the horse with the fewest supporters
      const under = [...this.horses].sort((a, b) => a.votes.size - b.votes.size)[0];
      this.vote(v, under.i);
    }
    if (v.vote < 0) return;
    const h = this.horses[v.vote];
    const name = gift.name || 'Gift';
    const isRose = /rose/i.test(name) || dia === 1;
    const level = isRose ? 0.45 : dia < 100 ? 0.8 : 1.5;
    const secs = (isRose ? 2.5 : dia < 100 ? 4 : 6) * Math.min(4, Math.sqrt(count));
    h.contrib.set(v.id, (h.contrib.get(v.id) || 0) + value * 10);
    if (this.phase === PHASE.RACE) {
      h.giftLevel = Math.max(h.giftLevel, level * CFG.giftPower);
      h.giftUntil = Math.max(h.giftUntil, this.t) + secs;
    } else h.giftBank += secs;               // saved and released at the start
    if (isRose) { this.flash.rose = this.t; this.pushFeed(`🌹 ${v.name} → ${h.i + 1} ${h.name}`, LANE[h.i]); audio.play('rose'); }
    else {
      this.flash.gift = this.t;
      this.pushFeed(`🎁 ${v.name} → ${h.i + 1} ${h.name} · ${name}`, GOLD);
      this.announce({ avatar: v, text: `${h.i + 1} ${h.name.toUpperCase()} НИСЭЖ БАЙНА!`, sub: `${v.name} · ${name} · хурдны тэжээл`, color: dia >= 100 ? GOLD : GREEN,
        dur: dia >= 100 ? 3 : 2.2, prio: dia >= 100 ? 3 : 2,
        voice: pick([`${v.name} хурдны тэжээл өглөө! ${h.i + 1} дугаар ${h.name} нисэж байна!`, `Баярлалаа ${v.name}! ${h.name} морь давхиж байна!`]), vprio: dia >= 100 ? 3 : 2, vkey: 'r_gift' });
      audio.play(dia >= 100 ? 'big' : 'gift');
      if (h.screenX != null) this.burst(h.screenX, h.screenY, GOLD, 30, 1.2);
    }
  },

  onFollow(user) {
    const v = this.viewer(user); if (!v) return;
    this.flash.follow = this.t;
    this.pushFeed(`➕ ${v.name} follow хийлээ`, CYAN);
    if (v.vote >= 0) this.boost(this.horses[v.vote], v, 8);
  },

  /** like-equivalent boost from one viewer to a horse */
  boost(h, v, amount) {
    h.e += amount * CFG.likePower;
    h.likes += amount; h.flashT = race.t;
    h.contrib.set(v.id, (h.contrib.get(v.id) || 0) + amount);
    if (h.screenX != null && Math.random() < 0.3) this.floaters.push({ x: h.screenX + rand(-20, 20), y: h.screenY - 30, text: '❤', t: 0 });
  },

  uyach(h) {
    let best = null, bestV = 0;
    for (const [id, val] of h.contrib) if (val > bestV) { bestV = val; best = this.viewers.get(id); }
    return best;
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
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(80, 380) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1.1), t: 0, r: rand(3, 8), color });
    }
  },

  // ── phases ──
  setPhase(p) { this.phase = p; this.phaseT = 0; this.lastBeep = 0; },

  newRace(round) {
    this.round = round;
    const coats = shuffle(COATS.slice()).slice(0, 6);
    this.horses = coats.map((c, i) => ({
      i, name: c[0], coat: c[1], dark: c[2],
      x: 0, v: 0, e: 0, likes: 0, votes: new Set(), contrib: new Map(),
      giftLevel: 0, giftUntil: 0, giftBank: 0,
      base: rand(0.95, 1.05), f1: rand(0.25, 0.6), p1: rand(0, TAU), f2: rand(0.9, 1.6), p2: rand(0, TAU),
      stride: rand(0, TAU), finished: false, finishT: 0, place: 0, screenX: null, screenY: 0, dustAcc: 0,
    }));
    for (const v of this.viewers.values()) v.vote = -1;
    this.camX = 0; this.leader = null; this.firstFinishT = 0; this.finishOrder = []; this.flags.clear();
    this.banners = []; this.banner = null;
    this.setPhase(PHASE.VOTE);
    audio.intensity = 0;
    const c = this.cls;
    this.announce({ icon: '🗳', text: 'САНАЛ ӨГӨХ ЭХЭЛЛЭЭ!', sub: `${round + 1}/6 · ${c.name} · Коммент-д 1–6 бич`, color: CYAN, dur: 3.2, prio: 3,
      voice: `${round + 1}-р уралдаан, ${c.name.toLowerCase()}! Санал өгөх эхэллээ! Коммент хэсэгт морины дугаараа бичээрэй!`, vprio: 3, vkey: 'r_vote' });
    audio.play('go');
  },

  startRace() {
    this.setPhase(PHASE.RACE);
    audio.intensity = 1;
    for (const h of this.horses) if (h.giftBank > 0) { h.giftLevel = 0.8 * CFG.giftPower; h.giftUntil = this.t + h.giftBank; h.giftBank = 0; }
    this.announce({ icon: '🏇', text: 'МОРЬД ГАРААНААС МОРДЛОО!', sub: 'Like дарж морио хурдлуул!', color: GOLD, dur: 2.2, prio: 3,
      voice: pick(['Морьд гараанаас мордлоо! Like дарж морио хурдлуулаарай!', 'Уралдаан эхэллээ! Дэмжсэн морио like-аар давхиулаарай!']), vprio: 3, vkey: 'r_go' });
    audio.play('go');
  },

  finishRace() {
    // horses that did not reach the finish are ranked by distance
    const rest = this.horses.filter(h => !h.finished).sort((a, b) => b.x - a.x);
    for (const h of rest) { h.finished = true; this.finishOrder.push(h); }
    this.finishOrder.forEach((h, k) => { h.place = k + 1; });
    // award viewers
    const winners = [];
    for (const v of this.viewers.values()) {
      if (v.vote < 0) continue;
      const place = this.horses[v.vote].place;
      const pts = CFG.pointsWin[place - 1] || 0;
      v.score += pts + 5;
      if (place === 1) { v.wins++; winners.push(v); }
    }
    const uyachs = this.horses.map(h => this.uyach(h));
    uyachs.forEach(u => { if (u) u.score += CFG.uyachBonus; });
    const first = this.finishOrder[0], last = this.finishOrder[this.finishOrder.length - 1];
    this.lastResult = { order: this.finishOrder.slice(), winners, uyachs };
    this.setPhase(PHASE.RESULT);
    audio.intensity = 0;
    audio.play('win');
    commentator.say(`${first.i + 1} дугаар ${first.name} морь түрүүллээ! ${winners.length ? winners.length + ' хүн зөв таалаа!' : ''}`, 3, 'r_win');
    setTimeout(() => commentator.say(`Бүүрэг бол ${last.i + 1} дугаар ${last.name}. Бүүрэг ч гэсэн баатар!`, 2, 'r_buureg'), 200);
    for (let i = 0; i < 5; i++) this.burst(rand(150, 930), rand(500, 1000), nextColor(), 26, 1.4);
  },

  // ── update ──
  update(dt) {
    this.t += dt; this.phaseT += dt;
    const P = this.phase;

    if (P === PHASE.VOTE) {
      const left = CFG.voteSec - this.phaseT;
      if (left < 5.5 && !this.flags.has('voteEnd')) { this.flags.add('voteEnd'); commentator.say('Санал авалт дуусах гэж байна! Яараарай!', 2, 'r_vote_end'); }
      if (left <= 3 && left > 0) { const n = Math.ceil(left); if (n !== this.lastBeep) { this.lastBeep = n; audio.play('tick'); } }
      if (left <= 0) {
        this.setPhase(PHASE.READY);
        this.announce({ icon: '🚩', text: 'ГИЙНГОО!', sub: 'Морьд гараанд бэлдэж байна', color: GOLD, dur: 2.2, prio: 3,
          voice: 'Гийн гоо! Морьд гараанд бэлэн боллоо!', vprio: 3, vkey: 'r_giingoo' });
      }
    } else if (P === PHASE.READY) {
      const left = CFG.readySec - this.phaseT;
      if (left <= 3 && left > 0) { const n = Math.ceil(left); if (n !== this.lastBeep) { this.lastBeep = n; audio.play('beep'); } }
      if (left <= 0) this.startRace();
    } else if (P === PHASE.RACE) {
      this.simulate(dt);
    } else if (P === PHASE.RESULT) {
      if (this.phaseT >= CFG.resultSec) {
        if (this.round >= 5) {
          this.setPhase(PHASE.FINALE);
          const top = this.topViewers(1)[0];
          commentator.say(top ? `Наадам өндөрлөлөө! Шилдэг уяач бол ${top.name}! Баяр хүргэе!` : 'Наадам өндөрлөлөө! Баяр хүргэе!', 3, 'r_champion');
          audio.play('win');
        } else this.newRace(this.round + 1);
      }
    } else if (P === PHASE.FINALE) {
      if (this.phaseT >= CFG.finaleSec) {
        for (const v of this.viewers.values()) { v.score = 0; v.wins = 0; }
        this.newRace(0);
      }
    }

    // likes → horse energy through a per-viewer token bucket
    const tNow = now();
    for (const v of this.viewers.values()) {
      v.likeTokens = Math.min(CFG.likeBurst, v.likeTokens + (tNow - v.likeAt) * CFG.likesPerSecCap); v.likeAt = tNow;
      if (v.pending > 0 && v.vote >= 0) {
        const take = Math.min(v.pending, Math.floor(v.likeTokens));
        if (take > 0) {
          v.pending -= take; v.likeTokens -= take;
          if (P === PHASE.RACE) { this.boost(this.horses[v.vote], v, take); audio.play('like'); }
          else this.horses[v.vote].contrib.set(v.id, (this.horses[v.vote].contrib.get(v.id) || 0) + take);
        }
        if (v.pending > CFG.likeBurst * 3) v.pending = CFG.likeBurst * 3;
      }
    }

    // camera follows the leader
    let lead = null; for (const h of this.horses) if (!lead || h.x > lead.x) lead = h;
    const targetCam = P === PHASE.RACE || P === PHASE.RESULT ? clamp(lead.x - 620, 0, L - 830) : 0;
    this.camX += (targetCam - this.camX) * Math.min(1, dt * 3);

    if (!this.banner && this.banners.length) this.banner = this.banners.shift();
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
    for (const f of this.floaters) { f.t += dt; f.y -= 70 * dt; }
    this.floaters = this.floaters.filter(f => f.t < 1.1);
    for (const q of this.particles) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 2.5 * dt; q.vy *= 1 - 2.5 * dt; }
    this.particles = this.particles.filter(q => q.t < q.life);
    const maxP = quality < 0.8 ? 250 : 700;
    if (this.particles.length > maxP) this.particles.splice(0, this.particles.length - maxP);
  },

  simulate(dt) {
    const unit = L / CFG.raceSec;
    let lead = null; for (const h of this.horses) if (!lead || h.x > lead.x) lead = h;
    for (const h of this.horses) {
      if (h.finished) { h.v *= 1 - 1.5 * dt; h.x += h.v * dt; h.stride += h.v * dt / 34; continue; }
      const wobble = 1 + 0.07 * Math.sin(this.t * h.f1 + h.p1) + 0.04 * Math.sin(this.t * h.f2 + h.p2);
      const behind = (lead.x - h.x) / L;
      const rubber = 1 + Math.min(0.16, behind * 0.7);
      const likeBonus = unit * 1.15 * (1 - Math.exp(-h.e / 10));
      const giftBonus = this.t < h.giftUntil ? unit * h.giftLevel : 0;
      const target = unit * h.base * wobble * rubber + likeBonus + giftBonus;
      const ramp = Math.min(1, this.phaseT / 1.5);
      h.v += (target * ramp - h.v) * Math.min(1, dt * 2.2);
      h.x += h.v * dt;
      h.e *= Math.exp(-dt / 2.2);
      h.stride += h.v * dt / 34;
      if (h.x >= L) {
        h.finished = true; h.finishT = this.phaseT; this.finishOrder.push(h);
        if (this.finishOrder.length === 1) {
          this.firstFinishT = this.phaseT;
          this.announce({ icon: '🏆', text: `${h.i + 1} ${h.name.toUpperCase()} ТҮРҮҮЛЛЭЭ!`, sub: 'Бариандаа орлоо!', color: GOLD, dur: 2.5, prio: 3 });
          audio.play('win');
        }
      }
    }
    // commentary
    if (lead !== this.leader && this.phaseT > 4 && this.t - this.leaderSaidAt > 8) {
      this.leaderSaidAt = this.t;
      commentator.say(pick([`${lead.i + 1} дугаар ${lead.name} тэргүүлж байна!`, `${lead.name} морь урагшаа гарлаа!`]), 1, 'r_lead');
    }
    this.leader = lead;
    if (lead.x > L * 0.82 && !this.flags.has('final')) {
      this.flags.add('final'); audio.intensity = 2;
      this.announce({ icon: '🏁', text: 'БАРИА ОЙРТОЖ БАЙНА!', sub: 'Сүүлчийн хүч — like!', color: RED, dur: 2, prio: 2, voice: 'Бариа ойртож байна! Сүүлчийн хүчээ гаргаарай!', vprio: 2, vkey: 'r_final' });
    }
    // gallop sound follows the leader's speed
    this.gallopT += dt;
    const interval = clamp(0.42 * (L / CFG.raceSec) / Math.max(60, lead.v), 0.22, 0.6);
    if (this.gallopT > interval) { this.gallopT = 0; audio.play('gallop'); }
    const done = this.horses.every(h => h.finished);
    if (done || (this.firstFinishT && this.phaseT - this.firstFinishT > 8) || this.phaseT > CFG.raceSec * 2.2) this.finishRace();
  },

  topViewers(n) { return [...this.viewers.values()].filter(v => v.score > 0).sort((a, b) => b.score - a.score).slice(0, n); },
};

// session persistence (viewer scores survive a reload)
const SESSION_KEY = 'race.session.v1';
function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ totalLikes: race.totalLikes, totalDiamonds: race.totalDiamonds,
      viewers: [...race.viewers.values()].filter(v => v.score > 0).map(v => ({ id: v.id, name: v.name, avatar: v.avatar, score: v.score, wins: v.wins, gifts: v.gifts })) }));
  } catch {}
}
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); if (!s) return;
    race.totalLikes = s.totalLikes || 0; race.totalDiamonds = s.totalDiamonds || 0;
    for (const d of s.viewers || []) { const v = race.viewer({ id: d.id, nickname: d.name, avatar: d.avatar }); Object.assign(v, { score: d.score, wins: d.wins, gifts: d.gifts || 0 }); }
  } catch {}
}

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
function drawAvatar(p, x, y, r) {
  const img = getAvatar(p.avatar);
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.closePath();
  if (img) { ctx.clip(); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); }
  else { ctx.fillStyle = hsl(p.color, -18); ctx.fill(); text((p.name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase(), x, y + r * 0.05, r * 1.1, '#fff', 'center', 900); }
  ctx.restore();
}
const pulse = (sp = 4) => 0.5 + 0.5 * Math.sin(race.t * sp);

// background (sky gradient + soft blobs) cached at low resolution
const bgCanvas = document.createElement('canvas'); bgCanvas.width = 270; bgCanvas.height = 480;
(function drawBg() {
  const c = bgCanvas.getContext('2d'); c.setTransform(0.25, 0, 0, 0.25, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0f2a3d'); g.addColorStop(0.5, '#0b1d2b'); g.addColorStop(1, '#050b12');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  [[200, 300, 'rgba(37,244,238,.10)'], [900, 700, 'rgba(255,200,80,.10)'], [500, 1500, 'rgba(120,255,160,.08)']].forEach(([x, y, col]) => {
    const r = c.createRadialGradient(x, y, 0, x, y, 520); r.addColorStop(0, col); r.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H);
  });
})();

const wx = (x) => TRACK.x0 + (x - race.camX);   // world → screen x

function drawSteppe() {
  const top = TRACK.top - 26, bot = TRACK_BOTTOM + 26;
  // grass
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, '#5f9a3e'); g.addColorStop(0.5, '#6aa845'); g.addColorStop(1, '#578f38');
  ctx.fillStyle = g; ctx.fillRect(0, top, W, bot - top);
  // lane stripes (mowed look)
  for (let i = 0; i < TRACK.lanes; i++) {
    const y = TRACK.top + i * TRACK.laneH;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.035)';
    ctx.fillRect(0, y, W, TRACK.laneH);
    // dirt path where hooves run
    ctx.fillStyle = 'rgba(140,105,60,.22)';
    ctx.fillRect(0, y + TRACK.laneH * 0.32, W, TRACK.laneH * 0.36);
  }
  // decorations in world space: tufts, flowers, stones (deterministic per tile)
  const tile = 160, first = Math.floor((race.camX - TRACK.x0) / tile) - 1, lastT = first + Math.ceil(W / tile) + 2;
  for (let k = first; k <= lastT; k++) {
    for (let j = 0; j < 5; j++) {
      const r1 = hash(k * 13 + j * 7.3), r2 = hash(k * 31 + j * 3.7), r3 = hash(k * 7 + j * 11.1);
      const x = wx(k * tile + r1 * tile), y = top + 8 + r2 * (bot - top - 16);
      if (r3 < 0.55) { // grass tuft
        ctx.strokeStyle = 'rgba(40,80,25,.55)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x - 2, y - 5); ctx.moveTo(x, y + 4); ctx.lineTo(x + 1, y - 7); ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + 6, y - 4); ctx.stroke();
      } else if (r3 < 0.8) { // flower
        ctx.fillStyle = ['#ffe066', '#ffffff', '#c58bff', '#ff8fb1'][Math.floor(r1 * 4)];
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
      } else { // stone
        ctx.fillStyle = 'rgba(120,120,110,.7)'; ctx.beginPath(); ctx.ellipse(x, y, 7, 5, r1, 0, TAU); ctx.fill();
      }
    }
  }
  // lane separators
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.setLineDash([22, 18]);
  ctx.lineDashOffset = race.camX % 40;
  for (let i = 1; i < TRACK.lanes; i++) { const y = TRACK.top + i * TRACK.laneH; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.setLineDash([]);
  // km markers
  const km = race.cls.km;
  for (let k = 1; k < km; k++) {
    const x = wx(L * k / km);
    if (x < -40 || x > W + 40) continue;
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - 1, top, 2, bot - top);
    text(`${k} км`, x, top + 12, 18, 'rgba(255,255,255,.75)', 'center', 800, 4);
  }
  // start line
  const sx = wx(0);
  if (sx > -80 && sx < W + 80) {
    ctx.fillStyle = '#fff'; ctx.fillRect(sx - 4, top, 8, bot - top);
    text('ГАРАА', sx, top + 12, 20, '#fff', 'center', 900, 5);
  }
  // finish line (checkered) + flags
  const fx = wx(L);
  if (fx > -80 && fx < W + 80) {
    const sq = 14;
    for (let y = top, r = 0; y < bot; y += sq, r++) for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff'; ctx.fillRect(fx + c * sq - sq, y, sq, sq);
    }
    text('БАРИА', fx + 52, top - 2, 26, '#ffd166', 'center', 900, 6);
    for (const fy of [top - 4, bot + 4]) {
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(fx + 16, fy); ctx.lineTo(fx + 16, fy - 40); ctx.stroke();
      ctx.fillStyle = '#ff3d5a'; ctx.beginPath(); ctx.moveTo(fx + 16, fy - 40); ctx.lineTo(fx + 44 + Math.sin(race.t * 6) * 3, fy - 33); ctx.lineTo(fx + 16, fy - 26); ctx.fill();
    }
  }
  // soft edges
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, top, W, 4); ctx.fillRect(0, bot - 4, W, 4);
}

/** Top-down horse with a child jockey, facing right. */
function drawHorse(h, x, y) {
  const s = race.cls.size * 1.6;
  const moving = h.v > 5;
  const ph = h.stride;
  const lane = LANE[h.i];
  ctx.save();
  ctx.translate(x, y + (moving ? Math.sin(ph * 2) * 1.5 : 0));
  ctx.scale(s, s);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(4, 6, 50, 17, 0, 0, TAU); ctx.fill();
  // legs (gallop: front and hind pairs swing alternately)
  const sw = moving ? Math.sin(ph) : 0, sw2 = moving ? Math.sin(ph + Math.PI * 0.8) : 0;
  ctx.fillStyle = h.dark;
  const leg = (lx, ly, d) => { ctx.beginPath(); ctx.ellipse(lx + d * 14, ly, 9, 3.4, 0, 0, TAU); ctx.fill(); };
  leg(22, -11, sw); leg(22, 11, sw * 0.8); leg(-24, -11, sw2); leg(-24, 11, sw2 * 0.8);
  // tail
  ctx.strokeStyle = h.dark; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-36, 0); ctx.quadraticCurveTo(-52, Math.sin(ph * 1.3) * 7, -64, Math.sin(ph * 1.3 + 1) * 10); ctx.stroke();
  // body
  const g = ctx.createLinearGradient(0, -16, 0, 16);
  g.addColorStop(0, h.coat); g.addColorStop(0.5, h.coat); g.addColorStop(1, h.dark);
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 38, 15, 0, 0, TAU); ctx.fill();
  // neck + head
  const bob = moving ? Math.sin(ph * 2) * 2 : 0;
  ctx.fillStyle = h.coat;
  ctx.beginPath(); ctx.ellipse(34, bob * 0.5, 15, 8.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(51, bob, 11, 7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = h.dark; // muzzle, ears, mane
  ctx.beginPath(); ctx.ellipse(59, bob, 4, 5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(44, bob - 5); ctx.lineTo(40, bob - 10); ctx.lineTo(47, bob - 6); ctx.fill();
  ctx.beginPath(); ctx.moveTo(44, bob + 5); ctx.lineTo(40, bob + 10); ctx.lineTo(47, bob + 6); ctx.fill();
  ctx.strokeStyle = h.dark; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(22, 0); ctx.quadraticCurveTo(32, -1, 44, bob); ctx.stroke();
  // saddle cloth with number
  ctx.fillStyle = hsl(lane); roundRect(-16, -16, 30, 32, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke();
  // jockey (child in a deel and pointed hat, leaning forward)
  ctx.strokeStyle = hsl(lane, -10); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(4, -6); ctx.lineTo(20, -4); ctx.moveTo(4, 6); ctx.lineTo(20, 4); ctx.stroke();  // arms
  ctx.strokeStyle = 'rgba(60,30,10,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(20, -4); ctx.lineTo(48, bob - 2); ctx.moveTo(20, 4); ctx.lineTo(48, bob + 2); ctx.stroke(); // reins
  ctx.fillStyle = hsl(lane, 8); ctx.beginPath(); ctx.ellipse(-1, 0, 10, 12, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = hsl(lane, -18); ctx.fillRect(-3, -12, 3, 24); // sash
  // hat ribbons trailing
  ctx.strokeStyle = hsl(lane, 15); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.quadraticCurveTo(-14, -6 + Math.sin(ph * 3) * 3, -24, -4 + Math.sin(ph * 3 + 1) * 5);
  ctx.moveTo(0, 2); ctx.quadraticCurveTo(-14, 6 + Math.sin(ph * 3 + 2) * 3, -24, 4 + Math.sin(ph * 3 + 3) * 5); ctx.stroke();
  ctx.fillStyle = '#f3c9a0'; ctx.beginPath(); ctx.arc(4, 0, 6.5, 0, TAU); ctx.fill();              // face edge
  ctx.fillStyle = hsl(lane, -5); ctx.beginPath(); ctx.arc(2, 0, 6.8, 0, TAU); ctx.fill();         // hat
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(2, 0, 2.2, 0, TAU); ctx.fill();             // hat top knot
  ctx.restore();
  // number tag above (readable at any zoom)
  const tx = x - 34 * s, ty = y - 30;
  ctx.beginPath(); ctx.arc(tx, ty, 16, 0, TAU); ctx.fillStyle = hsl(lane); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  text(String(h.i + 1), tx, ty + 1, 21, '#fff', 'center', 900);
  // speed-feed aura
  if (race.t < h.giftUntil) {
    ctx.strokeStyle = `hsla(45,100%,60%,${0.5 + 0.4 * pulse(12)})`; ctx.lineWidth = 4;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x - 95 - k * 18, y - 16 + k * 16); ctx.lineTo(x - 150 - k * 18 - Math.random() * 30, y - 16 + k * 16); ctx.stroke(); }
  }
}

function drawTrack() {
  drawSteppe();
  for (const h of race.horses) {
    const y = TRACK.top + TRACK.laneH * (h.i + 0.5);
    const x = wx(h.x);
    h.screenX = x; h.screenY = y;
    // dust
    if (h.v > 40 && race.phase === PHASE.RACE) {
      h.dustAcc += h.v / 900;
      while (h.dustAcc > 1) { h.dustAcc--; race.particles.push({ x: x - 80, y: y + rand(-10, 10), vx: rand(-90, -30), vy: rand(-20, 20), life: rand(0.4, 0.8), t: 0, r: rand(4, 9), color: { h: 35, s: 30, l: 62 }, dust: true }); }
    }
    if (x < -70) {
      // horse is behind the camera: show an arrow with the gap
      const gap = (race.camX + 20 - h.x) / L * race.cls.km;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; roundRect(6, y - 22, 118, 44, 22); ctx.fill();
      ctx.beginPath(); ctx.arc(30, y, 16, 0, TAU); ctx.fillStyle = hsl(LANE[h.i]); ctx.fill();
      text(String(h.i + 1), 30, y + 1, 20, '#fff', 'center', 900);
      text(`◀ ${gap.toFixed(1)}км`, 86, y + 1, 17, '#fff', 'center', 800);
    } else if (x < W + 80) drawHorse(h, x, y);
    else {
      ctx.beginPath(); ctx.arc(W - 30, y, 16, 0, TAU); ctx.fillStyle = hsl(LANE[h.i]); ctx.fill();
      text(String(h.i + 1), W - 30, y + 1, 20, '#fff', 'center', 900);
    }
    if (h.finished && h.place) text(['🥇', '🥈', '🥉'][h.place - 1] || `#${h.place}`, Math.min(x + 60, W - 70), y, 30, '#fff', 'center', 900, 5);
  }
}

function drawMinimap() {
  const y = TRACK_BOTTOM + 52, x0 = 70, x1 = W - 70;
  roundRect(x0 - 20, y - 22, x1 - x0 + 40, 44, 22); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  text('🚩', x0 - 4, y - 1, 20, '#fff', 'center', 400); text('🏁', x1 + 4, y - 1, 20, '#fff', 'center', 400);
  const sorted = [...race.horses].sort((a, b) => a.x - b.x);
  for (const h of sorted) {
    const x = lerp(x0, x1, clamp(h.x / L, 0, 1));
    ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU); ctx.fillStyle = hsl(LANE[h.i]); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    text(String(h.i + 1), x, y + 1, 16, '#fff', 'center', 900);
  }
}

function drawCards() {
  const y0 = TRACK_BOTTOM + 88, cw = 334, ch = 82, gap = 9, x0 = 30;
  const ranking = race.phase === PHASE.RACE || race.phase === PHASE.RESULT ? [...race.horses].sort((a, b) => (a.place || 99) - (b.place || 99) || b.x - a.x) : null;
  let maxVotes = 1; for (const h of race.horses) maxVotes = Math.max(maxVotes, h.votes.size);
  race.horses.forEach((h, k) => {
    const cx = x0 + (k % 3) * (cw + gap), cy = y0 + Math.floor(k / 3) * (ch + gap);
    const lane = LANE[h.i];
    const lit = clamp(1 - (race.t - (h.flashT ?? -9)) / 0.5, 0, 1);
    roundRect(cx, cy, cw, ch, 18); ctx.fillStyle = 'rgba(10,20,30,.78)'; ctx.fill();
    // vote bar
    const frac = h.votes.size / maxVotes;
    if (h.votes.size) { roundRect(cx, cy, cw * frac, ch, 18); ctx.fillStyle = hsl(lane, 0, 0.28); ctx.fill(); }
    ctx.lineWidth = 3; ctx.strokeStyle = hsl(lane, 0, 0.6 + 0.4 * lit); roundRect(cx, cy, cw, ch, 18); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 40, cy + ch / 2, 28, 0, TAU); ctx.fillStyle = hsl(lane); ctx.fill();
    text(String(h.i + 1), cx + 40, cy + ch / 2 + 1, 36, '#fff', 'center', 900);
    // coat swatch + name
    ctx.beginPath(); ctx.arc(cx + 86, cy + 24, 9, 0, TAU); ctx.fillStyle = h.coat; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke();
    text(h.name, cx + 102, cy + 24, 24, '#fff', 'left', 900);
    if (ranking) { const pos = ranking.indexOf(h) + 1; text(`#${pos}`, cx + cw - 14, cy + 24, 24, pos === 1 ? '#ffd166' : 'rgba(255,255,255,.75)', 'right', 900); }
    text(`👥 ${h.votes.size}   ❤ ${fmt(h.likes)}`, cx + 78, cy + 58, 19, 'rgba(255,255,255,.9)', 'left', 700);
    const u = race.uyach(h);
    if (u && race.phase !== PHASE.VOTE) {
      ctx.beginPath(); ctx.arc(cx + cw - 30, cy + 58, 15, 0, TAU); ctx.fillStyle = '#ffd166'; ctx.fill();
      drawAvatar(u, cx + cw - 30, cy + 58, 13);
    }
  });
}

function drawHeader() {
  const ty = 186;
  text('МОРИН УРАЛДААН', 34, ty, 52, '#fff', 'left', 900, 10);
  ctx.font = `900 52px ${FONT}`; const tw = ctx.measureText('МОРИН УРАЛДААН').width;
  const c = race.cls, px = 34 + tw + 16;
  roundRect(px, ty - 26, 250, 52, 26); ctx.fillStyle = race.phase === PHASE.RACE ? '#ff2d55' : 'rgba(255,255,255,.14)'; ctx.fill();
  text(`${race.round + 1}/6 · ${c.name}`, px + 125, ty + 1, 25, '#fff', 'center', 900);
  // 6-age progress dots
  CLASSES.forEach((k, i) => {
    const dx = W - 40 - (5 - i) * 26, done = i < race.round || race.phase === PHASE.FINALE, cur = i === race.round && race.phase !== PHASE.FINALE;
    ctx.beginPath(); ctx.arc(dx, ty, cur ? 10 : 8, 0, TAU);
    ctx.fillStyle = done ? '#ffd166' : cur ? '#ff2d55' : 'rgba(255,255,255,.25)'; ctx.fill();
  });

  // how to play
  const cards = [
    ['vote', '💬', '1–6 БИЧ', 'Морь сонгох', CYAN],
    ['like', '❤', 'LIKE', 'Хурдлуулах', RED],
    ['rose', '🌹', 'ROSE', 'Давхиа нэмэх', { h: 330, s: 90, l: 62 }],
    ['gift', '🎁', 'GIFT', 'Хурдны тэжээл', GOLD],
  ];
  const cw = 252, chh = 88, cy = 234, gap = 8;
  cards.forEach(([key, ic, title, desc, col], i) => {
    const cx = 30 + i * (cw + gap);
    const voteNow = key === 'vote' && race.phase === PHASE.VOTE;
    const lit = Math.max(clamp(1 - (race.t - (race.flash[key] ?? -9)) / 0.7, 0, 1), voteNow ? 0.5 + 0.5 * pulse(6) : 0);
    roundRect(cx, cy, cw, chh, 20); ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.14 * lit})`; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = hsl(col, 0, 0.35 + 0.65 * lit); ctx.stroke();
    text(ic, cx + 40, cy + chh / 2, 38 + 8 * lit, '#fff', 'center', 400);
    text(title, cx + 76, cy + 29, 25, hsl(col, 10), 'left', 900);
    text(fitText(desc, cw - 84, 21, 700), cx + 76, cy + 62, 21, '#fff', 'left', 700);
  });

  // status line
  const sy = 362; let s, col = '#25f4ee';
  const P = race.phase;
  if (P === PHASE.VOTE) {
    const left = Math.max(0, CFG.voteSec - race.phaseT); let votes = 0; for (const h of race.horses) votes += h.votes.size;
    s = `🗳 САНАЛ АВАЛТ · ${Math.ceil(left)}с · ${votes} санал`; col = left < 5 ? (pulse(10) > 0.5 ? '#ff4d6d' : '#fff') : '#25f4ee';
  } else if (P === PHASE.READY) { s = `🚩 ${c.name} (${c.age}) · гараанд бэлдэж байна`; col = '#ffd166'; }
  else if (P === PHASE.RACE) {
    const lead = race.leader || race.horses[0];
    s = `🏇 ${c.name} · ${(clamp(lead.x / L, 0, 1) * c.km).toFixed(1)} / ${c.km} км · ${Math.floor(race.phaseT)}с`; col = '#ffd166';
  } else if (P === PHASE.RESULT) s = `🏆 ${c.name}-ий уралдааны дүн`;
  else s = '🎉 НААДАМ ӨНДӨРЛӨЛӨӨ';
  text(s, 34, sy, 31, col, 'left', 900, 7);
  text(`❤ ${fmt(race.totalLikes)}  💎 ${fmt(race.totalDiamonds)}`, W - 30, sy, 22, 'rgba(255,255,255,.8)', 'right', 800, 5);
  // feed (single line under status)
  const f = race.feed[0];
  if (f && race.t - f.t < 4) text(fitText(f.text, W - 70, 22, 700), 34, sy + 44, 22, hsl(f.color, 15), 'left', 700, 5);
}

function drawVoteOverlay() {
  if (race.phase !== PHASE.VOTE) return;
  const cy = (TRACK.top + TRACK_BOTTOM) / 2, left = Math.max(0, CFG.voteSec - race.phaseT);
  ctx.fillStyle = 'rgba(5,12,20,.55)'; ctx.fillRect(0, TRACK.top - 26, W, TRACK_BOTTOM - TRACK.top + 52);
  const k = 1 + 0.04 * pulse(5);
  text('🗳 САНАЛ ӨГ!', W / 2, cy - 170, 74 * k, '#25f4ee', 'center', 900, 14);
  text('Коммент-д морины дугаараа бич', W / 2, cy - 92, 36, '#fff', 'center', 800, 8);
  // number chips 1–6
  for (let i = 0; i < 6; i++) {
    const x = W / 2 + (i - 2.5) * 132, y = cy + 6;
    ctx.beginPath(); ctx.arc(x, y, 48, 0, TAU); ctx.fillStyle = hsl(LANE[i]); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.stroke();
    text(String(i + 1), x, y + 3, 56, '#fff', 'center', 900);
    text(race.horses[i].name, x, y + 72, 22, '#fff', 'center', 800, 5);
  }
  text(String(Math.ceil(left)), W / 2, cy + 190, 90, left < 5 ? '#ff4d6d' : '#ffd166', 'center', 900, 14);
}

function drawReadyOverlay() {
  if (race.phase !== PHASE.READY) return;
  const left = CFG.readySec - race.phaseT, cy = (TRACK.top + TRACK_BOTTOM) / 2;
  if (left > 3) text('ГИЙНГОО!', W / 2, cy, 110, '#ffd166', 'center', 900, 16);
  else { const n = Math.ceil(left), kk = 1 + 0.3 * (left % 1); text(String(n), W / 2, cy, 160 * kk, n === 1 ? '#ff4d6d' : '#fff', 'center', 900, 18); }
}

function drawResult() {
  if (race.phase !== PHASE.RESULT || !race.lastResult) return;
  const { order, winners, uyachs } = race.lastResult;
  const e = 1 - Math.pow(1 - clamp(race.phaseT / 0.5, 0, 1), 3);
  const top = TRACK.top - 26, hgt = TRACK_BOTTOM - TRACK.top + 52;
  ctx.fillStyle = `rgba(5,10,20,${0.82 * e})`; ctx.fillRect(0, top, W, hgt);
  ctx.globalAlpha = e;
  const first = order[0];
  text('🏆 ТҮРҮҮ МОРЬ', W / 2, top + 50, 40, '#ffd166', 'center', 900, 8);
  ctx.beginPath(); ctx.arc(W / 2 - 170, top + 118, 38, 0, TAU); ctx.fillStyle = hsl(LANE[first.i]); ctx.fill();
  text(String(first.i + 1), W / 2 - 170, top + 120, 46, '#fff', 'center', 900);
  text(`${first.name.toUpperCase()}`, W / 2 + 20, top + 104, 56, '#fff', 'center', 900, 10);
  const u1 = uyachs[first.i];
  text(u1 ? `Уяач: ${u1.name}` : 'Уяачгүй', W / 2 + 20, top + 150, 24, '#25f4ee', 'center', 800, 5);
  // айргийн тав (top 5)
  text('АЙРГИЙН ТАВ', W / 2, top + 200, 26, 'rgba(255,255,255,.75)', 'center', 900);
  order.slice(0, 5).forEach((h, k) => {
    const ry = top + 240 + k * 50;
    roundRect(150, ry - 21, W - 300, 42, 14); ctx.fillStyle = k === 0 ? 'rgba(255,209,102,.25)' : 'rgba(255,255,255,.07)'; ctx.fill();
    text(['🥇', '🥈', '🥉', '4', '5'][k], 186, ry, 26, '#fff', 'center', 900);
    ctx.beginPath(); ctx.arc(236, ry, 16, 0, TAU); ctx.fillStyle = hsl(LANE[h.i]); ctx.fill();
    text(String(h.i + 1), 236, ry + 1, 20, '#fff', 'center', 900);
    text(h.name, 264, ry, 24, '#fff', 'left', 800);
    text(`👥 ${h.votes.size}`, W - 170, ry, 22, 'rgba(255,255,255,.85)', 'right', 800);
  });
  const last = order[order.length - 1];
  text(`🐴 Бүүрэг: ${last.i + 1} ${last.name} — бүүрэг ч гэсэн баатар!`, W / 2, top + 505, 24, '#ffb3c1', 'center', 800, 5);
  text(winners.length ? `✅ ${winners.length} хүн зөв таалаа · +${CFG.pointsWin[0]} оноо` : 'Энэ удаад хэн ч таасангүй', W / 2, top + 552, 28, '#6dffb0', 'center', 900, 6);
  const nextIdx = race.round + 1;
  text(nextIdx < 6 ? `Дараагийн уралдаан: ${CLASSES[nextIdx].name} · ${Math.ceil(CFG.resultSec - race.phaseT)}с` : `Наадмын дүн ${Math.ceil(CFG.resultSec - race.phaseT)}с`,
    W / 2, top + 600, 24, 'rgba(255,255,255,.75)', 'center', 700);
  ctx.globalAlpha = 1;
}

function drawFinale() {
  if (race.phase !== PHASE.FINALE) return;
  const top = TRACK.top - 26, hgt = TRACK_BOTTOM - TRACK.top + 52;
  ctx.fillStyle = 'rgba(5,10,20,.9)'; ctx.fillRect(0, top, W, hgt);
  text('🎉 НААДАМ ӨНДӨРЛӨЛӨӨ', W / 2, top + 52, 46, '#ffd166', 'center', 900, 10);
  text('ШИЛДЭГ УЯАЧИД', W / 2, top + 104, 28, '#25f4ee', 'center', 900, 6);
  const list = race.topViewers(8);
  if (!list.length) text('Энэ удаа санал өгсөн хүн алга', W / 2, top + 220, 28, '#fff', 'center', 700);
  list.forEach((v, k) => {
    const ry = top + 156 + k * 54;
    roundRect(120, ry - 23, W - 240, 46, 16); ctx.fillStyle = k === 0 ? 'rgba(255,209,102,.3)' : 'rgba(255,255,255,.07)'; ctx.fill();
    text(['🥇', '🥈', '🥉'][k] || String(k + 1), 160, ry, 26, '#fff', 'center', 900);
    ctx.beginPath(); ctx.arc(214, ry, 19, 0, TAU); ctx.fillStyle = '#ffd166'; ctx.fill(); drawAvatar(v, 214, ry, 17);
    text(fitText(v.name, 420, 24, 800), 246, ry, 24, '#fff', 'left', 800);
    text(`${fmt(v.score)} · ${v.wins}🏆`, W - 150, ry, 22, '#ffd166', 'right', 900);
  });
  if (Math.random() < 0.6) race.particles.push({ x: rand(0, W), y: top, vx: rand(-50, 50), vy: rand(200, 420), life: 2.2, t: 0, r: rand(5, 10), color: nextColor(), confetti: true });
}

function drawBanner() {
  const b = race.banner; if (!b) return;
  const t = b.t, inK = clamp(t / 0.22, 0, 1), outK = clamp((b.dur - t) / 0.3, 0, 1);
  const s = (0.6 + 0.4 * (1 - Math.pow(1 - inK, 3))) * (outK < 1 ? 0.9 + 0.1 * outK : 1);
  ctx.save(); ctx.globalAlpha = Math.min(inK * 1.5, outK);
  ctx.translate(W / 2, TRACK.top + 70); ctx.scale(s, s);
  const w = 900, h = b.sub ? 124 : 92;
  roundRect(-w / 2, -h / 2, w, h, 28); ctx.fillStyle = 'rgba(8,14,26,.86)'; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = hsl(b.color); ctx.stroke();
  let tx = 0;
  if (b.avatar) { ctx.beginPath(); ctx.arc(-w / 2 + 66, 0, 46, 0, TAU); ctx.fillStyle = hsl(b.color); ctx.fill(); drawAvatar(b.avatar, -w / 2 + 66, 0, 41); tx = 50; }
  else text(b.icon || '', -w / 2 + 60, 0, 52, '#fff', 'center', 400);
  text(fitText(b.text, w - 200, 44, 900), tx + 20, b.sub ? -20 : 0, 44, hsl(b.color, 15), 'center', 900, 8);
  if (b.sub) text(fitText(b.sub, w - 170, 26, 800), tx + 20, 31, 26, '#fff', 'center', 800, 6);
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
  ctx.save(); ctx.beginPath(); ctx.rect(0, TRACK.top - 26, W, TRACK_BOTTOM - TRACK.top + 52); ctx.clip();
  drawTrack();
  for (const q of race.particles) {
    const a = 1 - q.t / q.life; ctx.globalAlpha = a * (q.dust ? 0.6 : 1); ctx.fillStyle = hsl(q.color, q.dust ? 0 : 10);
    if (q.confetti) { ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.t * 6 + q.r); ctx.fillRect(-q.r, -q.r / 2, q.r * 2, q.r); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (q.dust ? 1 + q.t : a), 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  for (const f of race.floaters) { ctx.globalAlpha = clamp(1.1 - f.t, 0, 1); text(f.text, f.x, f.y, 26, '#ff4d8d', 'center', 900); }
  ctx.globalAlpha = 1;
  drawVoteOverlay(); drawReadyOverlay(); drawResult(); drawFinale();
  ctx.restore();
  drawMinimap();
  drawCards();
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
function sim(type, name, extra = {}) { race.handleEvent({ type, user: simUser(name), msgId: 'rs' + (++simMsg), ...extra }); }
const SIM_GIFTS = {
  rose: { name: 'Rose', diamonds: 1, count: 1 }, small: { name: 'Heart Me', diamonds: 5, count: 1 },
  big: { name: 'Lion', diamonds: 299, count: 1 }, huge: { name: 'Galaxy', diamonds: 1000, count: 1 },
};
let autoSim = false, autoAcc = 0;
function autoSimTick(dt) {
  if (!autoSim) return;
  autoAcc += dt;
  while (autoAcc > 0.1) {
    autoAcc -= 0.1;
    const name = pick(NAMES), r = Math.random();
    if (race.phase === PHASE.VOTE && r < 0.12) sim('comment', name, { text: String(1 + Math.floor(Math.random() * 6)) });
    else if (race.phase === PHASE.RACE) {
      if (r < 0.6) sim('like', name, { count: 1 + Math.floor(Math.random() * 5) });
      else if (r < 0.63) sim('gift', name, { gift: SIM_GIFTS.rose });
      else if (r < 0.64) sim('gift', name, { gift: SIM_GIFTS.small });
      else if (r < 0.642) sim('gift', name, { gift: SIM_GIFTS.big });
    }
  }
}

// ───────────────────────────── Recorded voice lines ─────────────────────────────
const RACE_LINES = [
  ['r_vote',     'Санал авалт эхлэх',   'Санал өгөх эхэллээ! Коммент хэсэгт морины дугаараа бичээрэй!'],
  ['r_vote_end', 'Санал дуусах',        'Санал авалт дуусах гэж байна! Яараарай!'],
  ['r_giingoo',  'Гийнгоо',             'Гийн гоо! Морьд гараанд бэлэн боллоо!'],
  ['r_go',       'Гараанаас гарах',     'Морьд гараанаас мордлоо! Like дарж морио хурдлуулаарай!'],
  ['r_lead',     'Тэргүүлэгч солигдох', 'Тэргүүлэгч солигдлоо!'],
  ['r_gift',     'Хурдны тэжээл',       'Хурдны тэжээл! Морь нисэж байна!'],
  ['r_final',    'Бариа ойртох',        'Бариа ойртож байна! Сүүлчийн хүчээ гаргаарай!'],
  ['r_win',      'Түрүүлэх',            'Түрүү морь бариандаа орлоо!'],
  ['r_buureg',   'Бүүрэг',              'Бүүрэг ч гэсэн баатар!'],
  ['r_champion', 'Наадам өндөрлөх',     'Наадам өндөрлөлөө! Баяр хүргэе!'],
];

// ───────────────────────────── Bridge client ─────────────────────────────
const bridge = {
  ws: null, url: '', lastSeq: 0, boot: '', retry: 0, timer: null, wanted: false,
  connect(url) { this.url = url; this.wanted = true; this.retry = 0; commentator.ttsBase = httpBase(url); this.open(); },
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
        if (typeof msg.viewers === 'number') race.viewerCount = msg.viewers;
        return;
      }
      if (msg.type === 'events') { for (const ev of msg.events) this.accept(ev); return; }
      this.accept(msg);
    };
    this.ws.onclose = () => { if (this.wanted) this.schedule(); };
    this.ws.onerror = () => {};
  },
  accept(ev) {
    if (typeof ev.seq === 'number') { if (ev.seq <= this.lastSeq) return; this.lastSeq = ev.seq; }
    race.handleEvent(ev);
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
  $('voiceTest').onclick = () => { audio.unlock(); commentator.stop(); commentator.say('Сайн байна уу! Морин уралдаанд тавтай морил. Коммент хэсэгт морины дугаараа бичээрэй!', 3); };
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
  for (const [key, label, line] of RACE_LINES) {
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
  if (params.get('ws') || params.get('connect') === '1') bridge.connect($('wsUrl').value);
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
    const P = race.phase;
    if (P === PHASE.VOTE) race.phaseT = CFG.voteSec; else if (P === PHASE.READY) race.phaseT = CFG.readySec;
    else if (P === PHASE.RACE) race.finishRace(); else if (P === PHASE.RESULT) race.phaseT = CFG.resultSec; else race.phaseT = CFG.finaleSec;
  };
  $('resetAll').onclick = () => {
    if (!confirm('Бүх оноо, уралдааныг эхнээс нь эхлүүлэх үү?')) return;
    race.viewers.clear(); race.totalLikes = 0; race.totalDiamonds = 0; race.seen = new SeenSet(); race.feed = [];
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    race.newRace(0);
  };
  $('safeZone').onclick = () => { showSafe = !showSafe; $('safeZone').classList.toggle('on', showSafe); };
  $('safeZone').classList.toggle('on', showSafe);
  initAudioPanel();
  initRecorder();
  buildBalance();
}

let botN = 0;
function addBots(n) {
  for (let i = 0; i < n; i++) {
    const name = NAMES[botN % NAMES.length] + (botN >= NAMES.length ? '_' + Math.floor(botN / NAMES.length) : '');
    botN++;
    sim('comment', name, { text: String(1 + Math.floor(Math.random() * 6)) });
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
  race.update(dt);
  render();
  requestAnimationFrame(frame);
}

loadSession();
race.newRace(0);
initPanel();
fitCanvas();
setInterval(saveSession, 5000);
requestAnimationFrame(frame);
window.RACE = { race, bridge, sim, audio, commentator, CFG: () => CFG };
})();
