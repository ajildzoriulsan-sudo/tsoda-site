/* LAND BATTLE LIVE — TikTok LIVE interactive physics battle
 * Pure canvas, no dependencies. Logical resolution 1080x1920 (9:16).
 *
 * Screen layout keeps clear of TikTok's own LIVE UI:
 *   y 0–140      TikTok host info / viewer count   → nothing important drawn
 *   y 140–420    title, "how to play" strip, round status
 *   y 420–1290   arena (left) + TOP 10 / supporter / feed column (right)
 *   y 1300–1920  TikTok comments + gift buttons      → left empty
 *
 * Sections: 1 Config · 2 Utils · 3 Player · 4 Game · 5 Renderer · 6 Event input · 7 UI + boot
 */
(() => {
'use strict';
const { audio, commentator } = window.LBLAudio;

// ───────────────────────────── 1. Config ─────────────────────────────
const DEFAULT_CONFIG = {
  // Growth
  basePoints: 0,
  baseRadius: 24,
  areaPerPoint: 9,
  maxRadius: 100,
  likePoints: 1,
  likesPerSecCap: 10,     // anti-spam: likes/sec counted per user
  likeBurst: 40,
  roseBonus: 20,
  pointsPerDiamond: 4,
  smallGiftMax: 99,
  growthBoostSec: 15,
  growthBoostMult: 2,
  powerSec: 12,
  powerMult: 2.2,
  // Physics
  baseSpeed: 220,
  accel: 500,
  friction: 1.6,
  pushStrength: 900,
  restitution: 0.55,
  edgeGrip: 500,
  healthDrain: 28,
  healthRegen: 10,
  // Lives
  lives: 3,
  respawnDelay: 1.2,
  respawnKeep: 0.6,       // fraction of size kept after losing a life
  ghostSec: 2,            // invulnerable after respawn
  // Rounds
  minPlayers: 2,
  maxPlayers: 40,
  lobbySec: 12,
  lateJoinSec: 25,
  reviveCutoffSec: 15,    // Rose revive is closed in the last N seconds
  shrinkStartSec: 45,
  shrinkDurSec: 70,
  arenaMinFrac: 0.4,
  roundMaxSec: 150,
  winnerSec: 8,
  // Scoring
  scorePerSec: 1,
  killScore: 50,
  winScore: 250,
};
const CFG_KEY = 'lbl.config.v2';
const CONFIG_LABELS = {
  areaPerPoint: 'Оноо → хэмжээ', maxRadius: 'Хамгийн их радиус', likePoints: 'Like оноо',
  likesPerSecCap: 'Like/сек хязгаар', roseBonus: 'Rose бонус', pointsPerDiamond: 'Оноо / 💎',
  smallGiftMax: 'Жижиг gift ≤ 💎', growthBoostSec: 'Өсөлт boost (сек)', powerSec: 'Хүч boost (сек)',
  powerMult: 'Хүч ×', lives: 'Амь', baseSpeed: 'Хурд', pushStrength: 'Түлхэх хүч', edgeGrip: 'Захын барьц',
  lobbySec: 'Хүлээлт (сек)', lateJoinSec: 'Хожуу нэгдэх (сек)', shrinkStartSec: 'Арен багасах (сек)',
  roundMaxSec: 'Раундын урт (сек)', maxPlayers: 'Дээд тоглогч', killScore: 'Шахалтын оноо', winScore: 'Ялалтын оноо',
};
let CFG = loadConfig();
function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch {} }

// ───────────────────────────── 2. Utilities ─────────────────────────────
const W = 1080, H = 1920;
const ARENA = { x: 420, y: 880, R0: 385 };
const SIDE = { x: 822, w: 244 };                // right column
const SAFE = { top: 140, bottom: 1300 };       // TikTok UI zones (approximate)
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => performance.now() / 1000;
const wall = () => Date.now() / 1000;
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));

let hueSeed = Math.random() * 360;
function nextColor() { hueSeed = (hueSeed + 137.508) % 360; return { h: Math.round(hueSeed), s: 82, l: 58 }; }
const hsl = (c, dl = 0, a = 1) => `hsla(${c.h},${c.s}%,${clamp(c.l + dl, 0, 100)}%,${a})`;
const GOLD = { h: 45, s: 100, l: 60 }, RED = { h: 350, s: 95, l: 62 }, CYAN = { h: 178, s: 90, l: 55 }, GREEN = { h: 140, s: 85, l: 55 };

const avatarCache = new Map();
function getAvatar(url) {
  if (!url) return null;
  let rec = avatarCache.get(url);
  if (!rec) {
    rec = { img: new Image(), ok: false };
    rec.img.referrerPolicy = 'no-referrer';
    rec.img.onload = () => { rec.ok = true; };
    rec.img.src = url;
    avatarCache.set(url, rec);
  }
  return rec.ok ? rec.img : null;
}

class SeenSet {
  constructor(max = 5000) { this.max = max; this.set = new Set(); this.q = []; }
  has(k) { return this.set.has(k); }
  add(k) { if (this.set.has(k)) return; this.set.add(k); this.q.push(k); if (this.q.length > this.max) this.set.delete(this.q.shift()); }
}

// ───────────────────────────── 3. Player ─────────────────────────────
class Player {
  constructor(user) {
    this.id = user.id;
    this.name = user.nickname || user.uniqueId || user.id;
    this.avatar = user.avatar || '';
    this.color = nextColor();
    this.score = 0; this.giftDiamonds = 0; this.roundsWon = 0; this.kills = 0;
    this.lastActive = wall();
    this.likeTokens = CFG.likeBurst; this.likeTokenAt = now(); this.pendingLikes = 0;
    this.inArena = false; this.alive = false; this.queued = false;
    this.resetForRound();
  }
  resetForRound() {
    this.points = CFG.basePoints;
    this.r = CFG.baseRadius;
    this.x = ARENA.x; this.y = ARENA.y; this.vx = 0; this.vy = 0;
    this.health = 100; this.lives = CFG.lives; this.respawnAt = 0; this.ghostUntil = 0;
    this.boostUntil = 0; this.powerUntil = 0;
    this.squash = 0; this.squashV = 0; this.squashAng = 0;
    this.wander = rand(0, TAU); this.targetId = null; this.retargetAt = 0;
    this.lastHitBy = null; this.lastHitAt = 0;
    this.dyingT = 0; this.spawnT = 0; this.onRim = false;
    this.roundSurvive = 0;
  }
  get targetR() { return Math.min(CFG.maxRadius, Math.sqrt(CFG.baseRadius ** 2 + Math.max(0, this.points) * CFG.areaPerPoint)); }
  get mass() { return this.r * this.r; }
  get boosted() { return game.t < this.boostUntil; }
  get powered() { return game.t < this.powerUntil; }
  get ghost() { return game.t < this.ghostUntil; }
  get inPlay() { return this.alive || this.respawnAt > 0; }
  get pushForce() { return (1 + (this.r - CFG.baseRadius) / CFG.baseRadius * 0.5) * (this.powered ? CFG.powerMult : 1); }
  get maxSpeed() { return CFG.baseSpeed * Math.pow(CFG.baseRadius / this.r, 0.45) * (this.powered ? 1.15 : 1); }
  get rankValue() { return this.score + (this.alive ? this.r * 3 : 0); }
}

// ───────────────────────────── 4. Game ─────────────────────────────
const STATE = { LOBBY: 'LOBBY', BATTLE: 'BATTLE', WINNER: 'WINNER' };

const game = {
  t: 0, state: STATE.LOBBY, stateT: 0, round: 1,
  arenaR: ARENA.R0,
  players: new Map(), arena: [],
  winner: null, viewers: 0, totalDiamonds: 0, totalLikes: 0,
  feed: [], floaters: [], particles: [],
  banners: [], banner: null,          // big centre announcements
  flash: {},                          // how-to strip highlight per action
  flags: new Set(),                   // one-shot per-round triggers
  leader: null, leaderAnnouncedAt: -99, lastNag: -30, lastBeep: 0, shake: 0,
  seen: new SeenSet(),

  // ── event entry point (simulator + TikTok bridge both call this) ──
  handleEvent(ev) {
    if (ev.msgId) { if (this.seen.has(ev.msgId)) return; this.seen.add(ev.msgId); }
    switch (ev.type) {
      case 'viewers': this.viewers = ev.count | 0; return;
      case 'follow': return this.onFollow(ev.user);
      case 'like': return this.onLike(ev.user, ev.count || 1);
      case 'gift': return this.onGift(ev.user, ev.gift || {});
      case 'comment': return this.onComment(ev.user, String(ev.text || ''));
      case 'share': { const p = this.players.get(ev.user?.id); if (p) this.addPoints(p, 5, '🔁 +5'); return; }
    }
  },

  player(user, allowJoin) {
    if (!user || !user.id) return null;
    let p = this.players.get(user.id);
    if (p) {
      if (user.avatar) p.avatar = user.avatar;
      if (user.nickname) p.name = user.nickname;
      p.lastActive = wall();
      return p;
    }
    if (!allowJoin) return null;
    p = new Player(user); p.actT = this.t;
    this.players.set(p.id, p);
    return p;
  },

  onFollow(user) {
    const p = this.player(user, true);
    if (!p) return;
    this.flash.follow = this.t;
    this.tryEnter(p);
  },

  onLike(user, count) {
    const p = this.player(user, !!user?.isFollower);
    this.totalLikes += count;
    this.flash.like = this.t;
    if (!p) return;
    if (!p.inArena) this.tryEnter(p);
    p.pendingLikes = Math.min(p.pendingLikes + count, 500);
  },

  onGift(user, gift) {
    const p = this.player(user, true); // a gift is a strong participation signal: auto-register
    const count = Math.max(1, gift.count | 0);
    const dia = Math.max(1, gift.diamonds | 0);
    const value = dia * count;
    this.totalDiamonds += value;
    if (!p) return;
    p.giftDiamonds += value;
    const name = gift.name || 'Gift';
    const isRose = /rose/i.test(name) || dia === 1;
    if (!p.inArena) this.tryEnter(p, isRose);
    p.actT = this.t;
    if (isRose) {
      this.flash.rose = this.t;
      this.addPoints(p, CFG.roseBonus * count, `🌹 +${CFG.roseBonus * count}`);
      this.pushFeed(`🌹 ${p.name}`, p.color);
      audio.play('rose');
    } else if (dia <= CFG.smallGiftMax) {
      this.flash.gift = this.t;
      this.addPoints(p, value * CFG.pointsPerDiamond, `🎁 +${value * CFG.pointsPerDiamond}`);
      p.boostUntil = Math.max(p.boostUntil, this.t) + CFG.growthBoostSec;
      this.pushFeed(`🎁 ${p.name} · ${name}`, p.color);
      this.announce({ icon: '🎁', text: `${p.name}`, sub: `${name} илгээлээ · ӨСӨЛТ ×${CFG.growthBoostMult}`, color: GREEN, dur: 2, prio: 1,
        voice: pick([`${p.name} ${name} илгээлээ! Өсөлт хоёр дахин!`, `Баярлалаа ${p.name}! Хурдан томорч байна!`]), vprio: 2 });
      audio.play('gift');
    } else {
      this.flash.gift = this.t;
      this.addPoints(p, value * CFG.pointsPerDiamond, `💥 +${value * CFG.pointsPerDiamond}`);
      p.boostUntil = Math.max(p.boostUntil, this.t) + CFG.growthBoostSec;
      p.powerUntil = Math.max(p.powerUntil, this.t) + CFG.powerSec;
      p.health = 100;
      this.pushFeed(`💎 ${p.name} · ${name}`, GOLD);
      this.announce({ icon: '💎', text: `${p.name}`, sub: `${name} ×${count} · ХҮЧ ×${CFG.powerMult}!`, color: GOLD, dur: 3, prio: 3, avatar: p,
        voice: pick([`Гайхалтай! ${p.name} ${name} илгээж хүчээ нэмлээ!`, `Ухаан алдмаар! ${p.name} одоо хамгийн хүчтэй нь!`, `${p.name} ${name} илгээлээ! Бүгд болгоомжтой!`]), vprio: 3 });
      this.burst(p.x, p.y, p.color, 40, 1.4);
      this.shake = 0.4;
      audio.play('big');
    }
  },

  onComment(user, text) {
    const cmd = text.trim().toLowerCase();
    const isJoin = /^!(join|play|rejoin|орох|тоглох)/.test(cmd);
    const p = this.player(user, !!user?.isFollower && isJoin);
    if (!p) return;
    if (isJoin) { this.tryEnter(p); return; }
    if (cmd.startsWith('!stats') || cmd.startsWith('!оноо')) {
      const rank = this.ranking().indexOf(p) + 1;
      this.pushFeed(`📊 ${p.name} #${rank || '-'} · ${fmt(p.score)}`, p.color);
    }
  },

  addPoints(p, pts, label) {
    p.points += pts; p.score += pts;
    if (label && p.alive) this.floaters.push({ x: p.x, y: p.y - p.r, text: label, color: p.color, t: 0 });
  },

  aliveCount() { let n = 0; for (const p of this.arena) if (p.inPlay) n++; return n; },

  /** Put a player into the arena if rules allow, else queue for next round.
   *  A Rose (`viaRose`) lets a newcomer or eliminated player enter mid-battle. */
  tryEnter(p, viaRose = false) {
    if (p.inArena) return;
    const alive = this.aliveCount();
    const battleOpen = this.state === STATE.BATTLE && (
      this.stateT < CFG.lateJoinSec ||
      (viaRose && alive >= 2 && this.stateT < CFG.roundMaxSec - CFG.reviveCutoffSec));
    if ((this.state === STATE.LOBBY || battleOpen) && alive < CFG.maxPlayers) {
      const returning = p.roundSurvive > 0;
      this.spawn(p, this.state === STATE.BATTLE);
      if (this.state === STATE.BATTLE && this.stateT >= CFG.lateJoinSec) p.lives = 1;
      if (viaRose && returning) {
        this.announce({ icon: '🌹', text: p.name, sub: 'Сарнайгаар буцаж орлоо!', color: RED, dur: 2, prio: 2,
          voice: pick([`${p.name} сарнайгаар тулаанд буцаж орлоо!`, `${p.name} эргээд ирлээ!`]), vprio: 2 });
      } else {
        this.pushFeed(`➕ ${p.name}`, p.color);
        commentator.say(pick([`${p.name} тулаанд орлоо!`, `Тавтай морил, ${p.name}!`, `${p.name} нэгдлээ!`]), 1);
      }
    } else if (!p.queued) {
      p.queued = true;
      const canRose = this.state === STATE.BATTLE && this.stateT < CFG.roundMaxSec - CFG.reviveCutoffSec;
      this.pushFeed(canRose ? `⏳ ${p.name} · 🌹 = одоо орох` : `⏳ ${p.name} · дараагийн раунд`, p.color);
    }
  },

  spawn(p, keepPoints) {
    const pts = keepPoints ? p.points * (p.roundSurvive > 0 ? 0.5 : 1) : null;
    p.resetForRound();
    if (pts != null && p.points < pts) p.points = pts;
    this.place(p, 0.72);
    p.r = CFG.baseRadius * 0.2; p.spawnT = 0;
    p.inArena = true; p.alive = true; p.queued = false; p.actT = this.t;
    if (!this.arena.includes(p)) this.arena.push(p);
    this.burst(p.x, p.y, p.color, 14, 0.7);
    audio.play('join');
  },

  place(p, frac) {
    let best = null, bestD = -Infinity;
    for (let i = 0; i < 24; i++) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * this.arenaR * frac;
      const x = ARENA.x + Math.cos(a) * d, y = ARENA.y + Math.sin(a) * d;
      let minD = Infinity;
      for (const q of this.arena) if (q.alive && q !== p) minD = Math.min(minD, Math.hypot(q.x - x, q.y - y) - q.r);
      if (minD > bestD) { bestD = minD; best = { x, y }; }
      if (minD > 100) break;
    }
    p.x = best.x; p.y = best.y; p.vx = 0; p.vy = 0;
  },

  respawn(p) {
    p.points *= CFG.respawnKeep;
    p.r = Math.max(CFG.baseRadius * 0.5, p.r * 0.5);
    this.place(p, 0.35);
    p.alive = true; p.respawnAt = 0; p.dyingT = 0; p.spawnT = 0;
    p.health = 100; p.ghostUntil = this.t + CFG.ghostSec;
    this.burst(p.x, p.y, p.color, 16, 0.6);
    audio.play('join');
  },

  eliminate(p) {
    if (!p.alive) return;
    p.alive = false; p.dyingT = 0.0001;
    p.lives--;
    const killer = (p.lastHitBy && this.t - p.lastHitAt < 3) ? this.players.get(p.lastHitBy) : null;
    const credited = killer && killer.alive && killer !== p;
    if (credited) {
      killer.kills++; killer.score += CFG.killScore;
      this.floaters.push({ x: killer.x, y: killer.y - killer.r, text: `⚔ +${CFG.killScore}`, color: killer.color, t: 0 });
    }
    this.burst(p.x, p.y, p.color, 34, 1.2);
    if (p.lives > 0) {
      p.respawnAt = this.t + CFG.respawnDelay;
      this.pushFeed(credited ? `⚔ ${killer.name} ▸ ${p.name}` : `💔 ${p.name} · ${p.lives}❤`, credited ? killer.color : p.color);
      if (credited) commentator.say(pick([`${killer.name} ${p.name}-г шахаж гаргалаа!`, `Хүчтэй түлхэлт, ${killer.name}!`, `${p.name} нэг амиа алдлаа!`]), 1);
      audio.play('lifeLost');
    } else {
      p.respawnAt = 0;
      this.pushFeed(credited ? `☠ ${killer.name} ▸ ${p.name}` : `☠ ${p.name} хасагдлаа`, credited ? killer.color : p.color);
      this.announce({ icon: '☠', text: p.name, sub: credited ? `${killer.name} шахаж хаслаа!` : 'Тулаанаас хасагдлаа', color: RED, dur: 1.6, prio: 1,
        voice: credited ? pick([`${killer.name} ${p.name}-г тулаанаас хаслаа!`, `${p.name} хасагдлаа! ${killer.name} маш хүчтэй байна!`]) : `${p.name} хасагдлаа!`, vprio: 2 });
      audio.play('elim');
      this.shake = 0.25;
      const left = this.aliveCount();
      if (this.state === STATE.BATTLE && (left === 3 || left === 2) && !this.flags.has('final' + left)) {
        this.flags.add('final' + left);
        this.announce({ icon: '🔥', text: left === 3 ? 'СҮҮЛИЙН 3!' : 'СҮҮЛИЙН 2!', sub: 'Хэн нь ялах вэ?', color: GOLD, dur: 2.2, prio: 2,
          voice: left === 3 ? 'Сүүлийн гурван тоглогч үлдлээ!' : 'Сүүлийн хоёр! Хэн нь ялах вэ?', vprio: 3 });
      }
    }
  },

  ranking() { return [...this.players.values()].sort((a, b) => b.rankValue - a.rankValue); },

  pushFeed(text, color) {
    this.feed.unshift({ text, color, t: this.t });
    if (this.feed.length > 6) this.feed.length = 6;
  },

  /** Big centre banner + optional voice line. prio 3 jumps ahead, prio 1 is dropped if busy. */
  announce(b) {
    if (b.voice) commentator.say(b.voice, b.vprio ?? 2);
    const item = { dur: 2, prio: 2, ...b, t: 0 };
    if (item.prio <= 1 && (this.banners.length >= 1)) return;
    if (item.prio >= 3) this.banners.unshift(item); else this.banners.push(item);
    if (this.banners.length > 4) this.banners.length = 4;
  },

  burst(x, y, color, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(80, 420) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1.1), t: 0, r: rand(3, 9), color });
    }
  },

  setState(s) {
    this.state = s; this.stateT = 0;
    audio.intensity = s === STATE.BATTLE ? 1 : 0;
    if (s === STATE.BATTLE) {
      this.announce({ icon: '⚔', text: 'ТУЛААН ЭХЭЛЛЭЭ!', sub: 'Бусдаа талбайгаас шахаж гарга!', color: GOLD, dur: 2.4, prio: 3,
        voice: pick(['Тулаан эхэллээ! Бусдаа талбайгаас шахаж гарга!', 'Эхэллээ! Хамгийн сүүлд үлдсэн нь ялна!']), vprio: 3 });
      audio.play('go');
    }
  },

  endRound(winner) {
    this.winner = winner || null;
    if (winner) {
      winner.roundsWon++; winner.score += CFG.winScore;
      this.pushFeed(`👑 ${winner.name}`, GOLD);
      commentator.say(pick([`${winner.name} ялагч боллоо! Баяр хүргэе!`, `Ялагч бол ${winner.name}! Гайхалтай тулаан!`]), 3);
      for (let i = 0; i < 6; i++) this.burst(rand(100, 800), rand(500, 1200), nextColor(), 30, 1.5);
      audio.play('win');
    }
    this.banners = []; this.banner = null;
    this.setState(STATE.WINNER);
  },

  newRound() {
    this.round++;
    this.arenaR = ARENA.R0;
    this.winner = null; this.leader = null;
    this.arena = []; this.flags.clear();
    const cutoff = wall() - 600; // idle >10 min players are not auto-respawned
    const ps = [...this.players.values()]
      .filter(p => p.lastActive > cutoff || p.queued)
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, CFG.maxPlayers);
    for (const p of this.players.values()) { p.inArena = false; p.alive = false; p.roundSurvive = 0; }
    for (const p of ps) this.spawn(p, false);
    this.setState(STATE.LOBBY);
    commentator.say(`${this.round}-р раунд! Follow дараад тоглоомд ороорой!`, 2);
  },

  // ── main step ──
  update(dt) {
    this.t += dt; this.stateT += dt;
    this.shake = Math.max(0, this.shake - dt);
    const alive = this.aliveCount();

    if (this.state === STATE.LOBBY) {
      if (alive < CFG.minPlayers) {
        this.stateT = 0;
        if (this.t - this.lastNag > 35) {
          this.lastNag = this.t;
          this.announce({ icon: '➕', text: 'FOLLOW дараад тогло!', sub: 'Like = томрох · Gift = хүч', color: CYAN, dur: 3, prio: 2,
            voice: pick(['Follow дараад тоглоомд ороорой! Like дарвал бөмбөлөг чинь томорно!', 'Тоглогч хүлээж байна! Follow дараад нэгдээрэй!']), vprio: 2 });
        }
      } else {
        const n = Math.ceil(CFG.lobbySec - this.stateT);
        if (n <= 3 && n >= 1 && n !== this.lastBeep) { this.lastBeep = n; audio.play('beep'); }
        if (n === 5 && !this.flags.has('soon')) { this.flags.add('soon'); commentator.say('Тулаан удахгүй эхэлнэ! Like дараад томор!', 2); }
        if (this.stateT >= CFG.lobbySec) { this.lastBeep = 0; this.setState(STATE.BATTLE); }
      }
    } else if (this.state === STATE.BATTLE) {
      for (const p of this.arena) if (p.alive) { p.score += CFG.scorePerSec * dt; p.roundSurvive += dt; }
      const s = clamp((this.stateT - CFG.shrinkStartSec) / CFG.shrinkDurSec, 0, 1);
      this.arenaR = lerp(ARENA.R0, ARENA.R0 * CFG.arenaMinFrac, s * s * (3 - 2 * s));
      if (this.stateT > CFG.shrinkStartSec && !this.flags.has('shrink')) {
        this.flags.add('shrink'); audio.play('alarm'); audio.intensity = 2;
        this.announce({ icon: '⚠', text: 'ТАЛБАЙ БАГАСАЖ БАЙНА!', sub: 'Зах руу бүү ойрт!', color: RED, dur: 2.4, prio: 3, voice: 'Анхаар! Талбай багасаж байна!', vprio: 3 });
      }
      const left = CFG.roundMaxSec - this.stateT;
      if (left < 30 && !this.flags.has('30s')) { this.flags.add('30s'); commentator.say('Гучин секунд үлдлээ!', 2); }
      if (left < 10 && left > 0) { const n = Math.ceil(left); if (n !== this.lastBeep) { this.lastBeep = n; audio.play('tick'); } }
      // leader commentary
      let lead = null; for (const p of this.arena) if (p.alive && (!lead || p.r > lead.r)) lead = p;
      if (lead && lead !== this.leader && this.stateT > 6 && this.t - this.leaderAnnouncedAt > 14 && lead.r > CFG.baseRadius * 1.6) {
        this.leaderAnnouncedAt = this.t;
        commentator.say(pick([`${lead.name} хамгийн том бөмбөлөг боллоо!`, `Одоо ${lead.name} тэргүүлж байна!`]), 1);
      }
      this.leader = lead;
      if (alive <= 1 && this.stateT > 2) this.endRound(this.arena.find(p => p.inPlay));
      else if (left <= 0) this.endRound(this.arena.filter(p => p.alive).sort((a, b) => b.r - a.r)[0]);
    } else if (this.state === STATE.WINNER) {
      if (this.stateT >= CFG.winnerSec) this.newRound();
    }

    // likes → growth through a per-user token bucket (anti-flood)
    const tNow = now();
    for (const p of this.players.values()) {
      p.likeTokens = Math.min(CFG.likeBurst, p.likeTokens + (tNow - p.likeTokenAt) * CFG.likesPerSecCap);
      p.likeTokenAt = tNow;
      if (p.pendingLikes > 0 && p.inArena) {
        const take = Math.min(p.pendingLikes, Math.floor(p.likeTokens));
        if (take > 0) {
          p.pendingLikes -= take; p.likeTokens -= take;
          const pts = take * CFG.likePoints * (p.boosted ? CFG.growthBoostMult : 1);
          p.points += pts; p.score += pts;
          if (p.alive && Math.random() < 0.35) this.floaters.push({ x: p.x + rand(-p.r, p.r) * 0.5, y: p.y - p.r, text: '❤', color: RED, t: 0, small: true });
          audio.play('like');
        }
        if (p.pendingLikes > CFG.likeBurst * 3) p.pendingLikes = CFG.likeBurst * 3;
      }
    }

    const steps = 3, h = dt / steps;
    for (let i = 0; i < steps; i++) this.physics(h);

    for (const p of this.arena) {
      if (!p.alive && p.dyingT > 0) p.dyingT += dt;
      if (!p.alive && p.respawnAt > 0 && this.t >= p.respawnAt) {
        if (this.state === STATE.BATTLE) this.respawn(p); else p.respawnAt = 0;
      }
    }
    this.arena = this.arena.filter(p => p.alive || p.respawnAt > 0 || p.dyingT < 0.8);
    const inSet = new Set(this.arena);
    for (const p of this.players.values()) p.inArena = inSet.has(p);

    // banners
    if (!this.banner && this.banners.length) this.banner = this.banners.shift();
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }

    for (const f of this.floaters) { f.t += dt; f.y -= 60 * dt; }
    this.floaters = this.floaters.filter(f => f.t < 1.3);
    for (const q of this.particles) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 2.2 * dt; q.vy *= 1 - 2.2 * dt; }
    this.particles = this.particles.filter(q => q.t < q.life);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  },

  physics(dt) {
    const ps = this.arena.filter(p => p.alive);
    const R = this.arenaR;
    const calm = this.state !== STATE.BATTLE;

    for (const p of ps) {
      p.spawnT += dt;
      p.r += (p.targetR - p.r) * Math.min(1, dt * 4);
      // AI steering
      if (this.t > p.retargetAt) {
        p.retargetAt = this.t + rand(0.8, 2.2);
        let best = null, bestS = -Infinity;
        for (const q of ps) {
          if (q === p || q.ghost) continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          const edge = Math.hypot(q.x - ARENA.x, q.y - ARENA.y) / R;
          const s = -d / 170 + edge * 1.5 + (p.r / q.r > 1 ? 1 : -1.2 * (q.r / p.r - 1)) + rand(0, 0.8);
          if (s > bestS) { bestS = s; best = q; }
        }
        p.targetId = best && Math.hypot(best.x - p.x, best.y - p.y) < 260 + p.r * 2 ? best.id : null;
        const wa = rand(0, TAU), wd = Math.sqrt(Math.random()) * R * 0.6;
        p.roamX = ARENA.x + Math.cos(wa) * wd; p.roamY = ARENA.y + Math.sin(wa) * wd;
      }
      let ax = 0, ay = 0;
      if (p.roamX !== undefined) {
        const dx = p.roamX - p.x, dy = p.roamY - p.y, dl = Math.hypot(dx, dy) || 1;
        const w = p.targetId && !calm ? 0.25 : 0.7;
        ax += dx / dl * w; ay += dy / dl * w;
      }
      const tgt = p.targetId && this.players.get(p.targetId);
      if (tgt && tgt.alive && !calm && !p.ghost) {
        const ox = tgt.x - ARENA.x, oy = tgt.y - ARENA.y, ol = Math.hypot(ox, oy) || 1;
        const gx = tgt.x - ox / ol * (tgt.r * 0.6), gy = tgt.y - oy / ol * (tgt.r * 0.6);
        const dx = gx - p.x, dy = gy - p.y, dl = Math.hypot(dx, dy) || 1;
        ax += dx / dl; ay += dy / dl;
      }
      for (const q of ps) {
        if (q === p) continue;
        if (q.r < p.r * 1.35) {   // mild personal space so a crowd spreads out instead of piling up
          const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1, near = (p.r + q.r) * 1.9;
          if (d < near) { const w = 1.1 * (1 - d / near); ax += dx / d * w; ay += dy / d * w; }
          continue;
        }
        const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1;
        if (d < q.r * 2.6 + p.r) { const w = 1.6 * (1 - d / (q.r * 2.6 + p.r)); ax += dx / d * w; ay += dy / d * w; }
      }
      const cx = p.x - ARENA.x, cy = p.y - ARENA.y, cd = Math.hypot(cx, cy) || 1;
      const rim = cd / R;
      if (rim > 0.6) { const w = (rim - 0.6) * 4.5; ax -= cx / cd * w; ay -= cy / cd * w; }
      const al = Math.hypot(ax, ay) || 1, spd = calm ? 0.35 : 1;
      p.vx += ax / al * CFG.accel * spd * dt; p.vy += ay / al * CFG.accel * spd * dt;
      p.vx *= 1 - CFG.friction * dt; p.vy *= 1 - CFG.friction * dt;
      const v = Math.hypot(p.vx, p.vy), mv = p.maxSpeed * (calm ? 0.5 : 1);
      if (v > mv) { p.vx *= mv / v; p.vy *= mv / v; }
    }

    // collisions
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (a.ghost || b.ghost) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d, overlap = rr - d;
        const ima = 1 / a.mass, imb = 1 / b.mass, ims = ima + imb;
        const corr = overlap * 0.6 / ims;
        a.x -= nx * corr * ima; a.y -= ny * corr * ima;
        b.x += nx * corr * imb; b.y += ny * corr * imb;
        const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vrel < 0) {
          const jimp = -(1 + CFG.restitution) * vrel / ims;
          a.vx -= jimp * ima * nx; a.vy -= jimp * ima * ny;
          b.vx += jimp * imb * nx; b.vy += jimp * imb * ny;
          const hit = Math.min(0.32, -vrel / 900);
          if (hit > 0.02) {
            a.squashV += hit * 18 * (b.mass / (a.mass + b.mass)); a.squashAng = Math.atan2(ny, nx);
            b.squashV += hit * 18 * (a.mass / (a.mass + b.mass)); b.squashAng = Math.atan2(ny, nx);
          }
          if (-vrel > 180) audio.play('bump', clamp(-vrel / 700, 0, 1) * clamp((a.r + b.r) / 120, 0.4, 1));
        }
        if (!calm) {
          const share = 2 / (a.mass + b.mass);
          const pa = CFG.pushStrength * a.pushForce * a.mass * share;
          const pb = CFG.pushStrength * b.pushForce * b.mass * share;
          b.vx += nx * pa * dt * 0.5; b.vy += ny * pa * dt * 0.5;
          a.vx -= nx * pb * dt * 0.5; a.vy -= ny * pb * dt * 0.5;
          if (pa > pb * 0.8) { b.lastHitBy = a.id; b.lastHitAt = this.t; }
          if (pb > pa * 0.8) { a.lastHitBy = b.id; a.lastHitAt = this.t; }
        }
      }
    }

    for (const p of ps) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const cx = p.x - ARENA.x, cy = p.y - ARENA.y, cd = Math.hypot(cx, cy) || 1;
      if (calm || p.ghost) {
        if (cd + p.r > R) {
          p.x = ARENA.x + cx / cd * (R - p.r); p.y = ARENA.y + cy / cd * (R - p.r);
          const vn = p.vx * cx / cd + p.vy * cy / cd;
          if (vn > 0) { p.vx -= 1.6 * vn * cx / cd; p.vy -= 1.6 * vn * cy / cd; }
        }
        p.onRim = false;
      } else {
        p.onRim = cd + p.r * 0.35 > R;
        if (p.onRim) {
          p.health = Math.max(0, p.health - CFG.healthDrain * dt * (p.powered ? 0.4 : 1));
          const grip = CFG.edgeGrip * (0.25 + 0.75 * p.health / 100);
          p.vx -= cx / cd * grip * dt; p.vy -= cy / cd * grip * dt;
        } else p.health = Math.min(100, p.health + CFG.healthRegen * dt);
        if (cd > R) this.eliminate(p);
      }
      p.squashV += (-140 * p.squash - 9 * p.squashV) * dt;
      p.squash = clamp(p.squash + p.squashV * dt, -0.3, 0.38);
    }
  },
};

// session persistence (scores survive a page reload)
const SESSION_KEY = 'lbl.session.v1';
function saveSession() {
  try {
    const players = [...game.players.values()].map(p => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color,
      score: Math.round(p.score), giftDiamonds: p.giftDiamonds, roundsWon: p.roundsWon, kills: p.kills, lastActive: p.lastActive }));
    localStorage.setItem(SESSION_KEY, JSON.stringify({ round: game.round, totalDiamonds: game.totalDiamonds, totalLikes: game.totalLikes, players }));
  } catch {}
}
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!s) return;
    game.round = s.round || 1; game.totalDiamonds = s.totalDiamonds || 0; game.totalLikes = s.totalLikes || 0;
    for (const d of s.players || []) {
      const p = new Player({ id: d.id, nickname: d.name, avatar: d.avatar });
      Object.assign(p, { color: d.color || p.color, score: d.score || 0, giftDiamonds: d.giftDiamonds || 0, roundsWon: d.roundsWon || 0, kills: d.kills || 0, lastActive: d.lastActive || 0 });
      game.players.set(p.id, p);
    }
  } catch {}
}

// ───────────────────────────── 5. Renderer ─────────────────────────────
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Noto Sans", sans-serif';
let showSafe = false;

function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function text(str, x, y, size, color = '#fff', align = 'center', weight = 800, stroke = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(10,5,25,.88)'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function fitText(str, maxW, size, weight = 800) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  if (ctx.measureText(str).width <= maxW) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function drawAvatar(p, x, y, r) {
  const img = getAvatar(p.avatar);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.closePath();
  if (img) { ctx.clip(); ctx.drawImage(img, x - r, y - r, r * 2, r * 2); }
  else {
    ctx.fillStyle = hsl(p.color, -22); ctx.fill();
    text((p.name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase(), x, y + r * 0.05, r * 1.1, '#fff', 'center', 900);
  }
  ctx.restore();
}
const pulse = (speed = 4) => 0.5 + 0.5 * Math.sin(game.t * speed);

let bgGrad;
function drawBackground() {
  if (!bgGrad) {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#1a0b3d'); bgGrad.addColorStop(0.55, '#0e0826'); bgGrad.addColorStop(1, '#05030f');
  }
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    const x = 540 + Math.cos(game.t * 0.13 + i * 2.1) * 380, y = 850 + Math.sin(game.t * 0.11 + i * 1.7) * 450;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 420);
    g.addColorStop(0, ['rgba(255,61,127,.15)', 'rgba(37,244,238,.11)', 'rgba(140,90,255,.15)'][i]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function drawArena() {
  const { x, y } = ARENA, R = game.arenaR;
  ctx.beginPath(); ctx.arc(x, y, ARENA.R0 + 6, 0, TAU);
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.save();
  ctx.shadowColor = 'rgba(120,80,255,.55)'; ctx.shadowBlur = 60;
  const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.35, R * 0.1, x, y, R);
  g.addColorStop(0, '#3a2a7a'); g.addColorStop(0.7, '#241a55'); g.addColorStop(1, '#170f3d');
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 2;
  for (let rr = 70; rr < R; rr += 70) { ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke(); }
  for (let a = 0; a < 12; a++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a * TAU / 12) * R, y + Math.sin(a * TAU / 12) * R); ctx.stroke(); }
  // danger band near the rim
  if (game.state === STATE.BATTLE) {
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.arc(x, y, R - 26, 0, TAU, true);
    ctx.fillStyle = `rgba(255,45,85,${0.12 + 0.1 * pulse(5)})`; ctx.fill();
  }
  ctx.restore();
  const shrinking = game.flags.has('shrink') && game.state === STATE.BATTLE;
  const pu = shrinking ? pulse(8) : 0;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU);
  ctx.lineWidth = 14;
  const rg = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
  rg.addColorStop(0, shrinking ? `rgb(255,${80 - pu * 60},${100 - pu * 60})` : '#25f4ee');
  rg.addColorStop(1, shrinking ? '#ff2d55' : '#ff3d7f');
  ctx.strokeStyle = rg; ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke();
}

function drawBall(p) {
  let r = p.r, alpha = 1;
  if (!p.alive) { if (p.dyingT <= 0) return; const k = Math.min(1, p.dyingT / 0.8); r *= 1 + k * 0.6; alpha = 1 - k; }
  if (alpha <= 0) return;
  if (p.ghost) alpha *= 0.45 + 0.35 * pulse(14);
  const pop = Math.min(1, p.spawnT / 0.35);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  if (p.powered && p.alive) {
    ctx.save(); ctx.rotate(game.t * 2);
    ctx.setLineDash([14, 10]); ctx.lineWidth = 6;
    ctx.strokeStyle = `hsla(45,100%,60%,${0.6 + 0.3 * Math.sin(game.t * 10)})`;
    ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, TAU); ctx.stroke(); ctx.restore();
  }
  if (p.boosted && p.alive) {
    ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, TAU);
    ctx.strokeStyle = `hsla(140,90%,60%,${0.35 + 0.25 * Math.sin(game.t * 6)})`; ctx.lineWidth = 4; ctx.stroke();
  }
  const s = p.squash + Math.sin(game.t * 5 + p.color.h) * 0.025;
  ctx.rotate(p.squashAng); ctx.scale((1 - s) * pop, (1 + s * 0.8) * pop); ctx.rotate(-p.squashAng);
  ctx.beginPath(); ctx.ellipse(r * 0.12, r * 0.18, r, r * 0.96, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, hsl(p.color, 26)); g.addColorStop(0.55, hsl(p.color, 0)); g.addColorStop(1, hsl(p.color, -20));
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
  // red warning outline when on the rim
  if (p.onRim && p.alive) { ctx.lineWidth = Math.max(4, r * 0.08); ctx.strokeStyle = `rgba(255,60,90,${0.5 + 0.5 * pulse(16)})`; }
  else { ctx.lineWidth = Math.max(2, r * 0.05); ctx.strokeStyle = hsl(p.color, 18, 0.9); }
  ctx.stroke();
  if (r > 14) {
    const ar = r * 0.58;
    ctx.beginPath(); ctx.arc(0, 0, ar + Math.max(2, r * 0.04), 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
    drawAvatar(p, 0, 0, ar);
  }
  ctx.beginPath(); ctx.ellipse(-r * 0.34, -r * 0.45, r * 0.36, r * 0.2, -0.6, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.fill();
  ctx.restore();
}

let labelSet = new Set();
/** Decide whose names to show: with a crowd, tiny anonymous balls stay unlabeled unless they just acted. */
function computeLabels() {
  const alive = game.arena.filter(p => p.alive);
  labelSet = new Set();
  if (alive.length <= 12) { alive.forEach(p => labelSet.add(p)); return; }
  const top = game.ranking().slice(0, 5);
  for (const p of alive) {
    if (p.r > 40 || top.includes(p) || game.t - (p.actT ?? -9) < 4 || p === game.leader || p.powered) labelSet.add(p);
  }
}
function drawBallLabel(p) {
  if (!p.alive || !labelSet.has(p)) return;
  const size = clamp(p.r * 0.36, 22, 34);
  const name = fitText(p.name, Math.max(130, p.r * 2.4), size);
  const y = p.y - p.r - size * 0.7 - 4;
  text(name, p.x, y, size, '#fff', 'center', 800, Math.max(6, size * 0.3));
  if (p === game.leader && game.state === STATE.BATTLE) text('👑', p.x, y - size * 0.95, size * 1.1, '#fff', 'center', 400);
  if (game.state !== STATE.BATTLE) return;
  // lives as hearts under the ball
  const hs = clamp(p.r * 0.3, 16, 24), by = p.y + p.r + hs * 0.75;
  const total = Math.max(CFG.lives, p.lives);
  for (let i = 0; i < total; i++) {
    const hx = p.x + (i - (total - 1) / 2) * hs * 1.1;
    text(i < p.lives ? '❤' : '♡', hx, by, hs, i < p.lives ? '#ff4d6d' : 'rgba(255,255,255,.4)', 'center', 900, 4);
  }
  if (p.health < 99) {
    const w = clamp(p.r * 1.3, 46, 130), bx = p.x - w / 2, hy = by + hs * 0.7;
    roundRect(bx, hy, w, 8, 4); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
    roundRect(bx, hy, w * p.health / 100, 8, 4);
    ctx.fillStyle = p.health > 50 ? '#6dffb0' : p.health > 25 ? '#ffd166' : '#ff4d6d'; ctx.fill();
  }
}

function drawHeader() {
  // title
  const ty = 186;
  text('ГАЗРЫН ТУЛААН', 34, ty, 54, '#fff', 'left', 900, 10);
  ctx.font = `900 54px ${FONT}`;
  const tw = ctx.measureText('ГАЗРЫН ТУЛААН').width;
  // round pill
  const px = 34 + tw + 18;
  roundRect(px, ty - 26, 170, 52, 26);
  ctx.fillStyle = game.state === STATE.BATTLE ? '#ff2d55' : 'rgba(255,255,255,.14)'; ctx.fill();
  text(`РАУНД ${game.round}`, px + 85, ty + 1, 26, '#fff', 'center', 900);
  // stats (right)
  text(`💎 ${fmt(game.totalDiamonds)}   ❤ ${fmt(game.totalLikes)}`, W - 30, ty, 24, 'rgba(255,255,255,.85)', 'right', 800, 5);

  // HOW TO PLAY strip — always visible, the action that just happened lights up
  const cards = [
    ['follow', '➕', 'FOLLOW', 'Тоглоомд орох', CYAN],
    ['like', '❤', 'LIKE', 'Томрох', RED],
    ['rose', '🌹', 'ROSE', 'Буцаж орох', { h: 330, s: 90, l: 62 }],
    ['gift', '🎁', 'GIFT', 'Хүч ×2', GOLD],
  ];
  const cw = 252, ch = 92, cy = 236, gap = 8;
  cards.forEach(([key, ic, title, desc, col], i) => {
    const cx = 30 + i * (cw + gap);
    const lit = clamp(1 - (game.t - (game.flash[key] ?? -9)) / 0.7, 0, 1);
    roundRect(cx, cy, cw, ch, 20);
    ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.14 * lit})`; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = hsl(col, 0, 0.35 + 0.65 * lit); ctx.stroke();
    text(ic, cx + 42, cy + ch / 2, 40 + 8 * lit, '#fff', 'center', 400);
    text(title, cx + 78, cy + 30, 26, hsl(col, 10), 'left', 900);
    text(fitText(desc, cw - 86, 22, 700), cx + 78, cy + 64, 22, '#fff', 'left', 700);
  });

  // status line
  const sy = 372;
  let status, color = '#25f4ee';
  const alive = game.aliveCount();
  if (game.state === STATE.LOBBY) {
    status = alive < CFG.minPlayers ? `⏳ Тоглогч хүлээж байна  ${alive}/${CFG.minPlayers}` : `⏳ ${Math.ceil(CFG.lobbySec - game.stateT)} секундийн дараа эхэлнэ · ${alive} тоглогч`;
  } else if (game.state === STATE.BATTLE) {
    const left = Math.max(0, CFG.roundMaxSec - game.stateT);
    status = `⚔ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}   👥 ${alive} үлдсэн`;
    color = left < 10 ? (pulse(10) > 0.5 ? '#ff4d6d' : '#fff') : '#ffd166';
    if (game.stateT < CFG.lateJoinSec) status += `   ➕ Нэгдэх ${Math.ceil(CFG.lateJoinSec - game.stateT)}с`;
  } else status = `👑 Раунд ${game.round} дууслаа`;
  text(status, 34, sy, 32, color, 'left', 900, 7);
}

const MEDALS = [
  { fill: ['#ffe27a', '#d4a017'], text: '#3a2a00' },
  { fill: ['#f2f4f8', '#9aa3b5'], text: '#1d2230' },
  { fill: ['#f0b27a', '#a8592a'], text: '#2e1405' },
];
function drawSide() {
  const x = SIDE.x, w = SIDE.w, y = 420, rowH = 40;
  const list = game.ranking().slice(0, 10);
  const hgt = 56 + Math.max(1, list.length) * rowH + 8;
  roundRect(x, y, w, hgt, 20);
  ctx.fillStyle = 'rgba(14,8,34,.75)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; ctx.stroke();
  text('🏆 ШИЛДЭГ 10', x + w / 2, y + 29, 24, '#fff', 'center', 900);
  if (!list.length) text('Follow дарж ор!', x + w / 2, y + 78, 19, 'rgba(255,255,255,.6)', 'center', 700);
  list.forEach((p, i) => {
    const ry = y + 52 + i * rowH;
    if (i < 3) {
      const g = ctx.createLinearGradient(x + 6, ry, x + w - 6, ry);
      g.addColorStop(0, MEDALS[i].fill[0]); g.addColorStop(1, MEDALS[i].fill[1]);
      roundRect(x + 6, ry + 2, w - 12, rowH - 4, 12); ctx.fillStyle = g; ctx.fill();
    }
    const tc = i < 3 ? MEDALS[i].text : (p.inPlay ? '#fff' : 'rgba(255,255,255,.5)');
    const cy = ry + rowH / 2;
    text(String(i + 1), x + 22, cy, 20, tc, 'center', 900);
    ctx.beginPath(); ctx.arc(x + 54, cy, 15, 0, TAU); ctx.fillStyle = hsl(p.color); ctx.fill();
    drawAvatar(p, x + 54, cy, 13);
    text(fitText(p.name, 104, 18, 700), x + 76, cy, 18, tc, 'left', 700);
    text(fmt(p.rankValue), x + w - 14, cy, 18, tc, 'right', 900);
  });

  // top supporter card
  let sup = null; for (const p of game.players.values()) if (p.giftDiamonds > 0 && (!sup || p.giftDiamonds > sup.giftDiamonds)) sup = p;
  let fy = y + hgt + 12;
  if (sup) {
    roundRect(x, fy, w, 74, 18);
    const g = ctx.createLinearGradient(x, fy, x + w, fy + 74);
    g.addColorStop(0, 'rgba(255,209,102,.30)'); g.addColorStop(1, 'rgba(255,61,127,.25)');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(x + 38, fy + 37, 25, 0, TAU); ctx.fillStyle = '#ffd166'; ctx.fill();
    drawAvatar(sup, x + 38, fy + 37, 22);
    text('ШИЛДЭГ ДЭМЖИГЧ', x + 72, fy + 20, 15, '#ffd166', 'left', 900);
    text(fitText(sup.name, w - 84, 20, 800), x + 72, fy + 43, 20, '#fff', 'left', 800);
    text(`${fmt(sup.giftDiamonds)} 💎`, x + 72, fy + 64, 15, 'rgba(255,255,255,.75)', 'left', 700);
    fy += 86;
  }
  // compact event feed (stops above TikTok's comment area)
  game.feed.forEach((f, i) => {
    const ry = fy + i * 38;
    if (ry + 34 > SAFE.bottom) return;
    const age = game.t - f.t;
    const a = clamp(1 - (age - 10) / 3, 0, 1);
    if (a <= 0) return;
    ctx.globalAlpha = a * (1 - i * 0.08);
    roundRect(x, ry, w, 32, 10); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
    roundRect(x, ry, 6, 32, 3); ctx.fillStyle = hsl(f.color); ctx.fill();
    text(fitText(f.text, w - 22, 17, 700), x + 14, ry + 17, 17, '#fff', 'left', 700);
    ctx.globalAlpha = 1;
  });
}

function drawBanner() {
  const b = game.banner;
  if (!b) return;
  const t = b.t, inK = clamp(t / 0.22, 0, 1), outK = clamp((b.dur - t) / 0.3, 0, 1);
  const s = (0.6 + 0.4 * (1 - Math.pow(1 - inK, 3))) * (outK < 1 ? 0.9 + 0.1 * outK : 1);
  ctx.save();
  ctx.globalAlpha = Math.min(inK * 1.5, outK);
  ctx.translate(ARENA.x, ARENA.y + ARENA.R0 - 100); ctx.scale(s, s);
  const w = 740, h = b.sub ? 132 : 96;
  roundRect(-w / 2, -h / 2, w, h, 30);
  ctx.fillStyle = 'rgba(12,6,30,.8)'; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = hsl(b.color); ctx.stroke();
  let tx = 0;
  if (b.avatar) {
    ctx.beginPath(); ctx.arc(-w / 2 + 70, 0, 50, 0, TAU); ctx.fillStyle = hsl(b.color); ctx.fill();
    drawAvatar(b.avatar, -w / 2 + 70, 0, 45); tx = 60;
  } else text(b.icon || '', -w / 2 + 62, 0, 56, '#fff', 'center', 400);
  text(fitText(b.text, w - 200, 46, 900), tx + 20, b.sub ? -22 : 0, 46, hsl(b.color, 15), 'center', 900, 8);
  if (b.sub) text(fitText(b.sub, w - 160, 28, 800), tx + 20, 32, 28, '#fff', 'center', 800, 6);
  ctx.restore();
}

function drawLobbyOverlay() {
  if (game.state !== STATE.LOBBY) return;
  const alive = game.aliveCount();
  if (alive >= CFG.minPlayers) {
    const rem = CFG.lobbySec - game.stateT, n = Math.ceil(rem), k = 1 + 0.25 * (rem % 1);
    text(String(n), ARENA.x, ARENA.y + 20, 150 * k, n <= 3 ? '#ff4d6d' : '#ffd166', 'center', 900, 16);
    text('Like дараад томор!', ARENA.x, ARENA.y + 140, 34, '#fff', 'center', 800, 8);
  } else {
    const k = 1 + 0.05 * pulse(4);
    text('➕ FOLLOW', ARENA.x, ARENA.y - 20, 72 * k, '#25f4ee', 'center', 900, 14);
    text('дараад тоглоомд ор!', ARENA.x, ARENA.y + 50, 40, '#fff', 'center', 800, 9);
  }
}

function drawWinner() {
  if (game.state !== STATE.WINNER) return;
  const t = game.stateT, e = 1 - Math.pow(1 - clamp(t / 0.5, 0, 1), 3);
  ctx.fillStyle = `rgba(5,2,15,${0.6 * e})`; ctx.fillRect(0, SAFE.top, W, SAFE.bottom - SAFE.top);
  const cx = 540, cy = 760;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.4);
  for (let i = 0; i < 16; i++) {
    ctx.rotate(TAU / 16);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-60, -800); ctx.lineTo(60, -800); ctx.closePath();
    ctx.fillStyle = `rgba(255,209,102,${0.07 * e})`; ctx.fill();
  }
  ctx.restore();
  const p = game.winner;
  if (!p) { text('Ялагч алга', cx, cy, 70, '#fff', 'center', 900, 12); return; }
  const r = 150 * e;
  ctx.save(); ctx.shadowColor = hsl(p.color); ctx.shadowBlur = 80;
  ctx.beginPath(); ctx.arc(cx, cy, r + 14, 0, TAU); ctx.fillStyle = hsl(p.color); ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
  if (r > 4) drawAvatar(p, cx, cy, r);
  text('👑', cx, cy - r - 60 + Math.sin(t * 4) * 8, 110 * e, '#fff', 'center', 400);
  text(`РАУНД ${game.round}-ЫН ЯЛАГЧ`, cx, 990, 50 * e, '#ffd166', 'center', 900, 12);
  text(fitText(p.name, 960, 80), cx, 1075, 80 * e, '#fff', 'center', 900, 14);
  text(`${fmt(p.score)} оноо · ${p.kills} шахалт · ${p.roundsWon} ялалт`, cx, 1150, 32 * e, '#25f4ee', 'center', 800, 8);
  text(`Дараагийн раунд ${Math.ceil(CFG.winnerSec - t)}…`, cx, 1215, 30, 'rgba(255,255,255,.8)', 'center', 700, 6);
  if (Math.random() < 0.7) game.particles.push({ x: rand(0, W), y: SAFE.top, vx: rand(-60, 60), vy: rand(250, 520), life: 2.5, t: 0, r: rand(5, 11), color: nextColor(), confetti: true });
}

function drawSafeZones() {
  if (!showSafe) return;
  ctx.fillStyle = 'rgba(255,0,60,.22)';
  ctx.fillRect(0, 0, W, SAFE.top); ctx.fillRect(0, SAFE.bottom, W, H - SAFE.bottom);
  text('TikTok UI (хөтлөгч, үзэгчид)', 540, SAFE.top / 2, 30, '#fff', 'center', 800, 6);
  text('TikTok UI (comment, gift товч)', 540, (SAFE.bottom + H) / 2, 34, '#fff', 'center', 800, 6);
}

let audioHint = false;
function render() {
  ctx.save();
  if (game.shake > 0) ctx.translate(rand(-1, 1) * game.shake * 18, rand(-1, 1) * game.shake * 18);
  drawBackground();
  drawArena();
  const sorted = [...game.arena].sort((a, b) => a.r - b.r);
  for (const p of sorted) drawBall(p);
  computeLabels();
  for (const p of sorted) drawBallLabel(p);
  for (const q of game.particles) {
    const a = 1 - q.t / q.life;
    ctx.globalAlpha = a; ctx.fillStyle = hsl(q.color, 10);
    if (q.confetti) { ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.t * 6 + q.r); ctx.fillRect(-q.r, -q.r / 2, q.r * 2, q.r); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(q.x, q.y, q.r * a, 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  for (const f of game.floaters) {
    ctx.globalAlpha = clamp(1.3 - f.t, 0, 1);
    text(f.text, f.x, f.y, f.small ? 26 : 36, f.small ? '#ff4d8d' : hsl(f.color, 20), 'center', 900, f.small ? 0 : 7);
  }
  ctx.globalAlpha = 1;
  drawLobbyOverlay();
  ctx.restore();
  drawHeader();
  drawSide();
  drawBanner();
  drawWinner();
  drawSafeZones();
  if (audioHint && !audio.running) {
    roundRect(330, 1220, 420, 60, 30); ctx.fillStyle = 'rgba(255,45,85,.9)'; ctx.fill();
    text('🔊 Дуу асаахын тулд дарна уу', 540, 1251, 24, '#fff', 'center', 800);
  }
}

// ───────────────────────────── 6. Event input ─────────────────────────────
const NAMES = ['bataa_99', 'saraa.mn', 'tuguldur', 'anu_x', 'khulan', 'temka', 'zola.ub', 'boldoo', 'misheel', 'nomin',
  'ganzo', 'oyunaa', 'tsogoo', 'enkhjin', 'dulmaa', 'azaa_7', 'bilguun', 'naraa', 'khuslen', 'erdene', 'munkh', 'solongo',
  'jaga', 'ariuka', 'unurmaa', 'tamir', 'sukhee', 'gerel', 'ochiroo', 'zaya'];
let simMsg = 0;
const simUser = (name) => ({ id: 'sim_' + name, uniqueId: name, nickname: name, avatar: '', isFollower: true });
function sim(type, name, extra = {}) { game.handleEvent({ type, user: simUser(name), msgId: 'sim' + (++simMsg), ...extra }); }
const SIM_GIFTS = {
  rose: { name: 'Rose', diamonds: 1, count: 1 },
  small: { name: 'Heart Me', diamonds: 5, count: 1 },
  small2: { name: 'Doughnut', diamonds: 30, count: 1 },
  big: { name: 'Lion', diamonds: 299, count: 1 },
  huge: { name: 'Galaxy', diamonds: 1000, count: 1 },
};

let autoSim = false, autoAcc = 0;
function autoSimTick(dt) {
  if (!autoSim) return;
  autoAcc += dt;
  game.viewers = Math.max(game.viewers, 120);
  while (autoAcc > 0.1) {
    autoAcc -= 0.1;
    const name = pick(NAMES), r = Math.random();
    if (r < 0.03) sim('follow', name);
    else if (r < 0.75) sim('like', name, { count: 1 + Math.floor(Math.random() * 5) });
    else if (r < 0.79) sim('gift', name, { gift: SIM_GIFTS.rose });
    else if (r < 0.80) sim('gift', name, { gift: SIM_GIFTS.small });
    else if (r < 0.803) sim('gift', name, { gift: Math.random() < 0.7 ? SIM_GIFTS.big : SIM_GIFTS.huge });
  }
}

const bridge = {
  ws: null, url: '', lastSeq: 0, boot: '', retry: 0, timer: null, wanted: false,
  connect(url) { this.url = url; this.wanted = true; this.retry = 0; commentator.ttsBase = httpBase(url); this.open(); },
  disconnect() { this.wanted = false; clearTimeout(this.timer); if (this.ws) this.ws.close(); setStatus('Салгасан (симуляц горим)', 'off'); },
  open() {
    clearTimeout(this.timer);
    try { this.ws = new WebSocket(this.url); } catch { return this.schedule(); }
    setStatus('Холбогдож байна…', 'warn');
    this.ws.onopen = () => { this.retry = 0; this.ws.send(JSON.stringify({ type: 'hello', lastSeq: this.lastSeq })); setStatus('Bridge-тэй холбогдлоо', 'ok'); };
    this.ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'status') {
        if (msg.boot && msg.boot !== this.boot) { if (this.boot) this.lastSeq = 0; this.boot = msg.boot; }
        setStatus(msg.text, msg.level || 'ok');
        if (typeof msg.viewers === 'number') game.viewers = msg.viewers;
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
    game.handleEvent(ev);
  },
  schedule() {
    const delay = Math.min(30, 1.5 * 2 ** this.retry++);
    setStatus(`Холболт тасарлаа · ${Math.round(delay)}с-ийн дараа дахин оролдоно`, 'warn');
    this.timer = setTimeout(() => this.open(), delay * 1000);
  },
};
function httpBase(wsUrl) { try { const u = new URL(wsUrl); return `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`; } catch { return ''; } }

// ───────────────────────────── 7. UI + boot ─────────────────────────────
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

  // audio: OBS/LIVE Studio browser sources usually allow autoplay; normal browsers need one click
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
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const name = $('simUser').value.trim() || 'guest', act = b.dataset.act;
    if (act === 'follow') sim('follow', name);
    else if (act === 'like1') sim('like', name, { count: 1 });
    else if (act === 'like15') sim('like', name, { count: 15 });
    else sim('gift', name, { gift: SIM_GIFTS[act] });
  });
  const send = () => { const v = $('simComment').value; if (!v) return; sim('comment', $('simUser').value.trim() || 'guest', { text: v }); $('simComment').value = ''; };
  $('simSend').onclick = send;
  $('simComment').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  $('addBots').onclick = () => addBots(10);
  $('autoSim').onclick = () => { autoSim = !autoSim; $('autoSim').classList.toggle('on', autoSim); };
  $('autoSim').classList.toggle('on', autoSim);
  $('forceEnd').onclick = () => {
    if (game.state === STATE.BATTLE) game.endRound(game.arena.filter(p => p.alive).sort((a, b) => b.r - a.r)[0]);
    else if (game.state === STATE.LOBBY) game.stateT = CFG.lobbySec;
  };
  $('resetAll').onclick = () => {
    game.players.clear(); game.arena = []; game.feed = []; game.round = 0; game.totalDiamonds = 0; game.totalLikes = 0;
    game.seen = new SeenSet(); try { localStorage.removeItem(SESSION_KEY); } catch {}
    game.newRound();
  };
  $('safeZone').onclick = () => { showSafe = !showSafe; $('safeZone').classList.toggle('on', showSafe); };
  $('safeZone').classList.toggle('on', showSafe);
  initAudioPanel();
  buildBalance();
}

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
  $('voiceTest').onclick = () => { audio.unlock(); commentator.stop(); commentator.say('Сайн байна уу! Газрын тулаанд тавтай морил. Follow дараад тоглоомд ороорой!', 3); };
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

let botN = 0;
function addBots(n) {
  for (let i = 0; i < n; i++) {
    const name = NAMES[botN % NAMES.length] + (botN >= NAMES.length ? '_' + Math.floor(botN / NAMES.length) : '');
    botN++;
    sim('follow', name);
    sim('like', name, { count: Math.floor(rand(0, 40)) });
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

let last = performance.now();
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
  autoSimTick(dt);
  game.update(dt);
  render();
  requestAnimationFrame(frame);
}

loadSession();
initPanel();
setInterval(saveSession, 5000);
requestAnimationFrame(frame);
window.LBL = { game, bridge, sim, audio, commentator, CFG: () => CFG };
})();
