/* LAND BATTLE LIVE — TikTok LIVE interactive physics battle (MVP)
 * Pure canvas, no dependencies. Logical resolution 1080x1920 (9:16).
 *
 * Sections:
 *   1. Config (balance, editable + saved to localStorage)
 *   2. Utilities
 *   3. Player
 *   4. Game (rounds, physics, scoring, events)
 *   5. Renderer
 *   6. Event input: simulator + bridge WebSocket client
 *   7. UI panel + boot
 */
(() => {
'use strict';

// ───────────────────────────── 1. Config ─────────────────────────────
const DEFAULT_CONFIG = {
  // Growth
  basePoints: 0,          // points every player starts a round with
  baseRadius: 26,         // px radius at 0 points
  areaPerPoint: 10,       // px² of area added per growth point
  maxRadius: 118,         // radius cap
  likePoints: 1,          // points per (accepted) like
  likesPerSecCap: 10,     // anti-spam: likes/sec counted per user (token refill)
  likeBurst: 40,          // anti-spam: max burst of likes per user
  roseBonus: 20,          // points per Rose
  pointsPerDiamond: 4,    // gift points per diamond (non-Rose gifts)
  smallGiftMax: 99,       // gifts up to this diamond value are "small"
  growthBoostSec: 15,     // small gift: likes multiplied for N seconds
  growthBoostMult: 2,     // like multiplier while boosted
  powerSec: 12,           // big gift: push-force power-up seconds
  powerMult: 2.2,         // push multiplier while powered
  // Physics
  baseSpeed: 230,         // max speed of a base-size ball (px/s)
  accel: 520,             // AI steering acceleration
  friction: 1.6,          // velocity damping per second
  pushStrength: 900,      // contact push acceleration
  restitution: 0.55,      // bounciness
  edgeGrip: 520,          // inward force at the rim (scaled by health)
  healthDrain: 28,        // health lost per second while on the rim
  healthRegen: 10,        // health regained per second inside
  // Rounds
  minPlayers: 2,
  maxPlayers: 40,
  lobbySec: 12,
  lateJoinSec: 25,        // players may still join this long after battle start
  shrinkStartSec: 40,
  shrinkDurSec: 70,
  arenaMinFrac: 0.38,
  roundMaxSec: 150,
  winnerSec: 7,
  // Scoring
  scorePerSec: 1,
  killScore: 50,
  winScore: 250,
};
const CFG_KEY = 'lbl.config.v1';
const CONFIG_LABELS = {
  areaPerPoint: 'Оноо → хэмжээ (px²)', maxRadius: 'Хамгийн их радиус', likePoints: 'Like оноо',
  likesPerSecCap: 'Like/сек хязгаар', likeBurst: 'Like burst', roseBonus: 'Rose bonus',
  pointsPerDiamond: 'Оноо / 💎', smallGiftMax: 'Жижиг gift ≤ 💎', growthBoostSec: 'Өсөлт boost (сек)',
  growthBoostMult: 'Өсөлт boost ×', powerSec: 'Хүч boost (сек)', powerMult: 'Хүч boost ×',
  baseSpeed: 'Үндсэн хурд', pushStrength: 'Түлхэх хүч', restitution: 'Үсрэлт', edgeGrip: 'Захын барьц',
  healthDrain: 'Health алдагдал/с', lobbySec: 'Lobby (сек)', lateJoinSec: 'Хожуу нэгдэх (сек)',
  shrinkStartSec: 'Арен багасах эхлэл', roundMaxSec: 'Раундын дээд (сек)', maxPlayers: 'Дээд тоглогч',
  killScore: 'Ялалт оноо (kill)', winScore: 'Раунд ялалтын оноо',
};
let CFG = loadConfig();
function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig() { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch {} }

// ───────────────────────────── 2. Utilities ─────────────────────────────
const W = 1080, H = 1920;
const ARENA = { x: 540, y: 1085, R0: 490 };
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const now = () => performance.now() / 1000;
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));

let hueSeed = Math.random() * 360;
function nextColor() {             // golden-angle hue → each player gets a distinct colour
  hueSeed = (hueSeed + 137.508) % 360;
  return { h: hueSeed, s: 82, l: 58 };
}
const hsl = (c, dl = 0, a = 1) => `hsla(${c.h},${c.s}%,${clamp(c.l + dl, 0, 100)}%,${a})`;

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

/** Bounded set for de-duplicating event ids (event recovery may replay). */
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
    this.handle = user.uniqueId || this.name;
    this.avatar = user.avatar || '';
    this.color = nextColor();
    this.score = 0;           // session score (persists across rounds)
    this.giftDiamonds = 0;    // total gift value (persists)
    this.roundsWon = 0;
    this.kills = 0;
    this.lastActive = now();
    this.likeTokens = CFG.likeBurst;
    this.likeTokenAt = now();
    this.pendingLikes = 0;
    this.inArena = false;
    this.alive = false;
    this.queued = false;
    this.resetForRound();
  }
  resetForRound() {
    this.points = CFG.basePoints;
    this.r = CFG.baseRadius;
    this.x = ARENA.x; this.y = ARENA.y; this.vx = 0; this.vy = 0;
    this.health = 100;
    this.boostUntil = 0; this.powerUntil = 0;
    this.squash = 0; this.squashV = 0; this.squashAng = 0;
    this.wander = rand(0, TAU); this.targetId = null; this.retargetAt = 0;
    this.lastHitBy = null; this.lastHitAt = 0;
    this.dyingT = 0; this.spawnT = 0;
    this.roundSurvive = 0;
  }
  get targetR() { return Math.min(CFG.maxRadius, Math.sqrt(CFG.baseRadius ** 2 + Math.max(0, this.points) * CFG.areaPerPoint)); }
  get mass() { return this.r * this.r; }
  get boosted() { return game.t < this.boostUntil; }
  get powered() { return game.t < this.powerUntil; }
  get pushForce() { return (1 + (this.r - CFG.baseRadius) / CFG.baseRadius * 0.5) * (this.powered ? CFG.powerMult : 1); }
  get maxSpeed() { return CFG.baseSpeed * Math.pow(CFG.baseRadius / this.r, 0.45) * (this.powered ? 1.15 : 1); }
  get rankValue() { return this.score + (this.alive ? this.r * 3 : 0); }
}

// ───────────────────────────── 4. Game ─────────────────────────────
const STATE = { LOBBY: 'LOBBY', BATTLE: 'BATTLE', WINNER: 'WINNER' };

const game = {
  t: 0,
  state: STATE.LOBBY,
  stateT: 0,              // seconds in current state
  round: 1,
  arenaR: ARENA.R0,
  players: new Map(),     // id → Player (all registered players)
  arena: [],              // players currently in the arena (alive or dying)
  winner: null,
  viewers: 0,
  totalDiamonds: 0,
  totalLikes: 0,
  feed: [],               // bottom ticker
  floaters: [],           // floating "+20" texts
  particles: [],
  seen: new SeenSet(),
  lobbyCountdownStarted: false,

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

  /** Return existing player; when `allowJoin` and the user follows, register them. */
  player(user, allowJoin) {
    if (!user || !user.id) return null;
    let p = this.players.get(user.id);
    if (p) {
      if (user.avatar) p.avatar = user.avatar;
      if (user.nickname) p.name = user.nickname;
      p.lastActive = now();
      return p;
    }
    if (!allowJoin) return null;
    p = new Player(user);
    this.players.set(p.id, p);
    return p;
  },

  onFollow(user) {
    const p = this.player(user, true);
    if (!p) return;
    this.pushFeed(`➕ ${p.name} нэгдлээ`, p.color);
    this.tryEnter(p);
  },

  // Likes are queued per player and drained through a token bucket each frame
  // so a single user tapping fast can't flood the game.
  onLike(user, count) {
    const p = this.player(user, !!user?.isFollower);
    this.totalLikes += count;
    if (!p) return;
    if (!p.inArena) this.tryEnter(p);
    p.pendingLikes = Math.min(p.pendingLikes + count, 500);
  },

  onGift(user, gift) {
    const p = this.player(user, true); // a gift is a strong signal of participation: auto-register
    const count = Math.max(1, gift.count | 0);
    const dia = Math.max(1, gift.diamonds | 0);
    const value = dia * count;
    this.totalDiamonds += value;
    if (!p) return;
    p.giftDiamonds += value;
    if (!p.inArena) this.tryEnter(p);
    const name = gift.name || 'Gift';
    if (/rose/i.test(name) || dia === 1) {
      this.addPoints(p, CFG.roseBonus * count, `🌹 +${CFG.roseBonus * count}`);
      this.pushFeed(`🌹 ${p.name} → Rose ×${count}`, p.color);
    } else if (dia <= CFG.smallGiftMax) {
      this.addPoints(p, value * CFG.pointsPerDiamond, `🎁 +${value * CFG.pointsPerDiamond}`);
      p.boostUntil = Math.max(p.boostUntil, this.t) + CFG.growthBoostSec;
      this.pushFeed(`🎁 ${p.name} → ${name} ×${count} · өсөлт ×${CFG.growthBoostMult}`, p.color);
    } else {
      this.addPoints(p, value * CFG.pointsPerDiamond, `💥 +${value * CFG.pointsPerDiamond}`);
      p.boostUntil = Math.max(p.boostUntil, this.t) + CFG.growthBoostSec;
      p.powerUntil = Math.max(p.powerUntil, this.t) + CFG.powerSec;
      p.health = 100;
      this.pushFeed(`💎 ${p.name} → ${name} ×${count} · ХҮЧ!`, p.color, true);
      this.burst(p.x, p.y, p.color, 40, 1.4);
    }
  },

  onComment(user, text) {
    const cmd = text.trim().toLowerCase();
    const p = this.player(user, !!user?.isFollower && /^!(join|play|rejoin)/.test(cmd));
    if (!p) return;
    if (/^!(join|play|rejoin)/.test(cmd)) { this.tryEnter(p); return; }
    if (cmd.startsWith('!stats')) {
      const rank = this.ranking().indexOf(p) + 1;
      this.pushFeed(`📊 ${p.name}: #${rank || '-'} · ${fmt(p.score)} оноо · ${p.roundsWon} ялалт · ${fmt(p.giftDiamonds)}💎`, p.color);
      return;
    }
    if (text.length) this.pushFeed(`💬 ${p.name}: ${text.slice(0, 40)}`, p.color);
  },

  addPoints(p, pts, label) {
    p.points += pts;
    p.score += pts;
    if (label && p.alive) this.floaters.push({ x: p.x, y: p.y - p.r, text: label, color: p.color, t: 0 });
  },

  /** Put a player into the arena now if rules allow, otherwise queue for next round. */
  tryEnter(p) {
    if (p.inArena) return;
    const aliveCount = this.arena.filter(q => q.alive).length;
    const canNow = this.state === STATE.LOBBY ||
                   (this.state === STATE.BATTLE && this.stateT < CFG.lateJoinSec);
    if (canNow && aliveCount < CFG.maxPlayers) this.spawn(p, this.state === STATE.BATTLE);
    else if (!p.queued) { p.queued = true; this.pushFeed(`⏳ ${p.name} дараагийн раундад орно`, p.color); }
  },

  spawn(p, keepPoints) {
    // late joiners keep points gathered while waiting; a re-joiner after elimination keeps half
    const pts = keepPoints ? p.points * (p.roundSurvive > 0 ? 0.5 : 1) : null;
    p.resetForRound();
    if (pts != null && p.points < pts) p.points = pts;
    // find a free spot
    let best = null, bestD = -1;
    for (let i = 0; i < 24; i++) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * this.arenaR * 0.72;
      const x = ARENA.x + Math.cos(a) * d, y = ARENA.y + Math.sin(a) * d;
      let minD = Infinity;
      for (const q of this.arena) if (q.alive) minD = Math.min(minD, Math.hypot(q.x - x, q.y - y) - q.r);
      if (minD > bestD) { bestD = minD; best = { x, y }; }
      if (minD > 120) break;
    }
    p.x = best.x; p.y = best.y;
    p.r = CFG.baseRadius * 0.2; p.spawnT = 0;
    p.inArena = true; p.alive = true; p.queued = false;
    this.arena.push(p);
    this.burst(p.x, p.y, p.color, 14, 0.7);
  },

  eliminate(p) {
    if (!p.alive) return;
    p.alive = false; p.dyingT = 0.0001;
    const killer = (p.lastHitBy && this.t - p.lastHitAt < 3) ? this.players.get(p.lastHitBy) : null;
    if (killer && killer.alive && killer !== p) {
      killer.kills++; killer.score += CFG.killScore;
      this.floaters.push({ x: killer.x, y: killer.y - killer.r, text: `⚔ +${CFG.killScore}`, color: killer.color, t: 0 });
      this.pushFeed(`⚔ ${killer.name} → ${p.name}-г шахаж гаргалаа`, killer.color);
    } else {
      this.pushFeed(`💨 ${p.name} талбайгаас гарлаа`, p.color);
    }
    this.burst(p.x, p.y, p.color, 34, 1.2);
  },

  ranking() {
    return [...this.players.values()].sort((a, b) => b.rankValue - a.rankValue);
  },

  pushFeed(text, color, big = false) {
    this.feed.unshift({ text, color, t: this.t, big });
    if (this.feed.length > 6) this.feed.length = 6;
  },

  burst(x, y, color, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(80, 420) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1.1), t: 0, r: rand(3, 9), color });
    }
  },

  setState(s) {
    this.state = s; this.stateT = 0;
    if (s === STATE.BATTLE) this.pushFeed(`⚔ Раунд ${this.round} эхэллээ!`, { h: 50, s: 100, l: 60 }, true);
  },

  endRound(winner) {
    this.winner = winner || null;
    if (winner) {
      winner.roundsWon++; winner.score += CFG.winScore;
      this.pushFeed(`👑 ${winner.name} раунд ${this.round}-ын ялагч!`, winner.color, true);
      for (let i = 0; i < 6; i++) this.burst(rand(150, 930), rand(400, 1500), nextColor(), 30, 1.5);
    }
    this.setState(STATE.WINNER);
  },

  newRound() {
    this.round++;
    this.arenaR = ARENA.R0;
    this.winner = null;
    this.arena = [];
    const cutoff = now() - 600; // players idle >10 min are not auto-respawned
    const ps = [...this.players.values()]
      .filter(p => p.lastActive > cutoff || p.queued)
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, CFG.maxPlayers);
    for (const p of this.players.values()) { p.inArena = false; p.alive = false; }
    for (const p of ps) this.spawn(p, false);
    this.setState(STATE.LOBBY);
  },

  // ── main simulation step ──
  update(dt) {
    this.t += dt; this.stateT += dt;
    const alive = this.arena.filter(p => p.alive);

    // round state machine
    if (this.state === STATE.LOBBY) {
      if (alive.length < CFG.minPlayers) this.stateT = 0; // wait for players
      else if (this.stateT >= CFG.lobbySec) this.setState(STATE.BATTLE);
    } else if (this.state === STATE.BATTLE) {
      for (const p of alive) { p.score += CFG.scorePerSec * dt; p.roundSurvive += dt; }
      const s = clamp((this.stateT - CFG.shrinkStartSec) / CFG.shrinkDurSec, 0, 1);
      this.arenaR = lerp(ARENA.R0, ARENA.R0 * CFG.arenaMinFrac, s * s * (3 - 2 * s));
      if (alive.length <= 1 && this.stateT > 2) this.endRound(alive[0]);
      else if (this.stateT >= CFG.roundMaxSec) this.endRound(alive.sort((a, b) => b.r - a.r)[0]);
    } else if (this.state === STATE.WINNER) {
      if (this.stateT >= CFG.winnerSec) this.newRound();
    }

    // drain likes through per-user token bucket
    for (const p of this.players.values()) {
      const tNow = now();
      p.likeTokens = Math.min(CFG.likeBurst, p.likeTokens + (tNow - p.likeTokenAt) * CFG.likesPerSecCap);
      p.likeTokenAt = tNow;
      if (p.pendingLikes > 0 && p.inArena) {
        const take = Math.min(p.pendingLikes, Math.floor(p.likeTokens));
        if (take > 0) {
          p.pendingLikes -= take; p.likeTokens -= take;
          const pts = take * CFG.likePoints * (p.boosted ? CFG.growthBoostMult : 1);
          p.points += pts; p.score += pts;
          if (p.alive && Math.random() < 0.35) this.floaters.push({ x: p.x + rand(-p.r, p.r) * 0.5, y: p.y - p.r, text: '❤', color: { h: 345, s: 95, l: 62 }, t: 0, small: true });
        }
        // anything over a reasonable backlog is dropped (anti-flood)
        if (p.pendingLikes > CFG.likeBurst * 3) p.pendingLikes = CFG.likeBurst * 3;
      }
    }

    // physics in fixed sub-steps for stable collisions
    const steps = 3, h = dt / steps;
    for (let i = 0; i < steps; i++) this.physics(h);

    // dying animations
    for (const p of this.arena) if (!p.alive && p.dyingT > 0) p.dyingT += dt;
    this.arena = this.arena.filter(p => p.alive || p.dyingT < 0.8);
    for (const p of this.players.values()) if (!this.arena.includes(p)) p.inArena = false;

    // fx
    for (const f of this.floaters) { f.t += dt; f.y -= 60 * dt; }
    this.floaters = this.floaters.filter(f => f.t < 1.3);
    for (const q of this.particles) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 2.2 * dt; q.vy *= 1 - 2.2 * dt; }
    this.particles = this.particles.filter(q => q.t < q.life);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  },

  physics(dt) {
    const ps = this.arena.filter(p => p.alive);
    const R = this.arenaR;
    const lobby = this.state !== STATE.BATTLE;

    for (const p of ps) {
      // grow / spawn ease
      p.spawnT += dt;
      p.r += (p.targetR - p.r) * Math.min(1, dt * 4);

      // ── AI steering ──
      if (this.t > p.retargetAt) {
        p.retargetAt = this.t + rand(0.8, 2.2);
        let best = null, bestS = -Infinity;
        for (const q of ps) {
          if (q === p) continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          // prefer close targets that are near the edge and not much bigger
          const edge = Math.hypot(q.x - ARENA.x, q.y - ARENA.y) / R;
          const s = -d / 300 + edge * 1.5 + (p.r / q.r > 1 ? 1 : -1.2 * (q.r / p.r - 1)) + rand(0, 0.8);
          if (s > bestS) { bestS = s; best = q; }
        }
        p.targetId = best ? best.id : null;
        p.wander += rand(-1.2, 1.2);
      }
      let ax = Math.cos(p.wander) * 0.3, ay = Math.sin(p.wander) * 0.3;
      const tgt = p.targetId && this.players.get(p.targetId);
      if (tgt && tgt.alive && !lobby) {
        // aim slightly "behind" the target relative to the centre so we push it outward
        const ox = tgt.x - ARENA.x, oy = tgt.y - ARENA.y, ol = Math.hypot(ox, oy) || 1;
        const gx = tgt.x - ox / ol * (tgt.r * 0.6), gy = tgt.y - oy / ol * (tgt.r * 0.6);
        const dx = gx - p.x, dy = gy - p.y, dl = Math.hypot(dx, dy) || 1;
        ax += dx / dl; ay += dy / dl;
      }
      // flee from much bigger neighbours (small balls are nimble)
      for (const q of ps) {
        if (q === p || q.r < p.r * 1.35) continue;
        const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1;
        if (d < q.r * 2.6 + p.r) { const w = 1.6 * (1 - d / (q.r * 2.6 + p.r)); ax += dx / d * w; ay += dy / d * w; }
      }
      // stay away from the rim
      const cx = p.x - ARENA.x, cy = p.y - ARENA.y, cd = Math.hypot(cx, cy) || 1;
      const rim = cd / R;
      if (rim > 0.6) { const w = (rim - 0.6) * 4.5; ax -= cx / cd * w; ay -= cy / cd * w; }
      const al = Math.hypot(ax, ay) || 1;
      const spd = lobby ? 0.35 : 1;
      p.vx += ax / al * CFG.accel * spd * dt;
      p.vy += ay / al * CFG.accel * spd * dt;
      p.vx *= 1 - CFG.friction * dt; p.vy *= 1 - CFG.friction * dt;
      const v = Math.hypot(p.vx, p.vy), mv = p.maxSpeed * (lobby ? 0.5 : 1);
      if (v > mv) { p.vx *= mv / v; p.vy *= mv / v; }
    }

    // ── collisions ──
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d;
        const overlap = rr - d;
        const ima = 1 / a.mass, imb = 1 / b.mass, ims = ima + imb;
        // soft positional correction (jelly balls compress a bit)
        const corr = overlap * 0.6 / ims;
        a.x -= nx * corr * ima; a.y -= ny * corr * ima;
        b.x += nx * corr * imb; b.y += ny * corr * imb;
        // impact impulse
        const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vrel < 0) {
          const jimp = -(1 + CFG.restitution) * vrel / ims;
          a.vx -= jimp * ima * nx; a.vy -= jimp * ima * ny;
          b.vx += jimp * imb * nx; b.vy += jimp * imb * ny;
          const hit = Math.min(0.32, -vrel / 900);
          if (hit > 0.02) {
            a.squashV += hit * 9 * (b.mass / (a.mass + b.mass)) * 2; a.squashAng = Math.atan2(ny, nx);
            b.squashV += hit * 9 * (a.mass / (a.mass + b.mass)) * 2; b.squashAng = Math.atan2(ny, nx);
          }
        }
        // continuous push: bigger / powered balls shove harder
        if (!lobby) {
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

    // ── integrate, rim, jelly spring ──
    for (const p of ps) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      const cx = p.x - ARENA.x, cy = p.y - ARENA.y, cd = Math.hypot(cx, cy) || 1;
      if (lobby) {
        // lobby: soft wall, no eliminations
        if (cd + p.r > R) {
          p.x = ARENA.x + cx / cd * (R - p.r); p.y = ARENA.y + cy / cd * (R - p.r);
          const vn = p.vx * cx / cd + p.vy * cy / cd;
          if (vn > 0) { p.vx -= 1.6 * vn * cx / cd; p.vy -= 1.6 * vn * cy / cd; }
        }
      } else {
        const onRim = cd + p.r * 0.35 > R;
        if (onRim) {
          p.health = Math.max(0, p.health - CFG.healthDrain * dt * (p.powered ? 0.4 : 1));
          const grip = CFG.edgeGrip * (0.25 + 0.75 * p.health / 100);
          p.vx -= cx / cd * grip * dt; p.vy -= cy / cd * grip * dt;
        } else {
          p.health = Math.min(100, p.health + CFG.healthRegen * dt);
        }
        if (cd > R) this.eliminate(p);
      }
      // damped spring for squash & stretch
      p.squashV += (-140 * p.squash - 9 * p.squashV) * dt;
      p.squash = clamp(p.squash + p.squashV * dt, -0.3, 0.38);
    }
  },
};

// ───────────────────────────── 5. Renderer ─────────────────────────────
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}
function text(str, x, y, size, color = '#fff', align = 'center', weight = 800, stroke = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(10,5,25,.85)'; ctx.strokeText(str, x, y); }
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

let bgGrad;
function drawBackground() {
  if (!bgGrad) {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#1a0b3d'); bgGrad.addColorStop(0.5, '#0e0826'); bgGrad.addColorStop(1, '#05030f');
  }
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  // soft light blobs
  const t = game.t;
  for (let i = 0; i < 3; i++) {
    const x = 540 + Math.cos(t * 0.13 + i * 2.1) * 380, y = 1000 + Math.sin(t * 0.11 + i * 1.7) * 600;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 420);
    g.addColorStop(0, ['rgba(255,61,127,.16)', 'rgba(37,244,238,.12)', 'rgba(140,90,255,.16)'][i]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function drawArena() {
  const { x, y } = ARENA, R = game.arenaR;
  // outer glow ring at original size (shows how far it shrank)
  ctx.beginPath(); ctx.arc(x, y, ARENA.R0 + 6, 0, TAU);
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 3; ctx.stroke();
  // shadow
  ctx.save();
  ctx.shadowColor = 'rgba(120,80,255,.55)'; ctx.shadowBlur = 60;
  const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.35, R * 0.1, x, y, R);
  g.addColorStop(0, '#3a2a7a'); g.addColorStop(0.7, '#241a55'); g.addColorStop(1, '#170f3d');
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  // grid rings
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 2;
  for (let rr = 80; rr < R; rr += 80) { ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke(); }
  for (let a = 0; a < 12; a++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a * TAU / 12) * R, y + Math.sin(a * TAU / 12) * R); ctx.stroke(); }
  ctx.restore();
  // rim — pulses red while shrinking
  const shrinking = game.state === STATE.BATTLE && game.stateT > CFG.shrinkStartSec;
  const pulse = shrinking ? 0.5 + 0.5 * Math.sin(game.t * 8) : 0;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU);
  ctx.lineWidth = 14;
  const rg = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
  rg.addColorStop(0, shrinking ? `rgba(255,${80 - pulse * 60},${100 - pulse * 60},1)` : '#25f4ee');
  rg.addColorStop(1, shrinking ? '#ff2d55' : '#ff3d7f');
  ctx.strokeStyle = rg; ctx.stroke();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.stroke();
}

function drawBall(p) {
  let r = p.r;
  let alpha = 1;
  if (!p.alive) { const k = p.dyingT / 0.8; r *= 1 + k * 0.6; alpha = 1 - k; }
  if (alpha <= 0) return;
  const pop = Math.min(1, p.spawnT / 0.35);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  // aura for power-up
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
  // jelly deformation along last impact normal + idle wobble
  const wob = Math.sin(game.t * 5 + p.color.h) * 0.025;
  const s = p.squash + wob;
  ctx.rotate(p.squashAng);
  ctx.scale((1 - s) * pop, (1 + s * 0.8) * pop);
  ctx.rotate(-p.squashAng);
  // drop shadow
  ctx.beginPath(); ctx.ellipse(r * 0.12, r * 0.18, r, r * 0.96, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
  // body
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, hsl(p.color, 26)); g.addColorStop(0.55, hsl(p.color, 0)); g.addColorStop(1, hsl(p.color, -20));
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.05); ctx.strokeStyle = hsl(p.color, 18, 0.9); ctx.stroke();
  // avatar inside
  if (r > 16) {
    const ar = r * 0.56;
    ctx.beginPath(); ctx.arc(0, 0, ar + Math.max(2, r * 0.04), 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
    drawAvatar(p, 0, 0, ar);
  }
  // gloss
  ctx.beginPath(); ctx.ellipse(-r * 0.34, -r * 0.45, r * 0.36, r * 0.2, -0.6, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.42, r * 0.38, r * 0.07, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
  ctx.restore();
}

function drawBallLabel(p) {
  if (!p.alive) return;
  const size = clamp(p.r * 0.34, 20, 36);
  const name = fitText(p.name, Math.max(140, p.r * 2.6), size);
  const y = p.y - p.r - size * 0.75 - 4;
  text(name, p.x, y, size, '#fff', 'center', 800, Math.max(5, size * 0.28));
  // health bar when hurt
  if (game.state === STATE.BATTLE && p.health < 99) {
    const w = clamp(p.r * 1.4, 50, 150), bx = p.x - w / 2, by = p.y + p.r + 10;
    roundRect(bx, by, w, 9, 5); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
    roundRect(bx, by, w * p.health / 100, 9, 5);
    ctx.fillStyle = p.health > 50 ? '#6dffb0' : p.health > 25 ? '#ffd166' : '#ff4d6d'; ctx.fill();
  }
  // crown for current leader
  if (p === leaderInArena) text('👑', p.x, y - size * 0.95, size * 1.1, '#fff', 'center', 400);
}

let leaderInArena = null;

function drawTopBar() {
  // title
  text('LAND BATTLE', 40, 70, 58, '#fff', 'left', 900, 10);
  const tw = (ctx.font = `900 58px ${FONT}`, ctx.measureText('LAND BATTLE ').width);
  roundRect(40 + tw, 42, 120, 56, 14); ctx.fillStyle = '#ff2d55'; ctx.fill();
  text('LIVE', 40 + tw + 60, 71, 40, '#fff', 'center', 900);
  // stats chips
  const chips = [
    ['👁', fmt(game.viewers), 'Үзэгч'],
    ['💎', fmt(game.totalDiamonds), 'Gift'],
    ['❤', fmt(game.totalLikes), 'Like'],
    ['👥', String(game.arena.filter(p => p.alive).length), 'Тоглогч'],
  ];
  let x = 40;
  for (const [ic, val, lab] of chips) {
    const w = 160;
    roundRect(x, 125, w, 66, 18); ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill();
    text(ic, x + 32, 158, 30, '#fff', 'center', 400);
    text(val, x + 60, 148, 28, '#fff', 'left', 900);
    text(lab, x + 60, 176, 17, 'rgba(255,255,255,.6)', 'left', 600);
    x += w + 10;
  }
  // round status line
  let status;
  if (game.state === STATE.LOBBY) {
    const alive = game.arena.filter(p => p.alive).length;
    status = alive < CFG.minPlayers ? `РАУНД ${game.round} · Тоглогч хүлээж байна (${alive}/${CFG.minPlayers})`
      : `РАУНД ${game.round} · ${Math.ceil(CFG.lobbySec - game.stateT)} сек-ийн дараа эхэлнэ`;
  } else if (game.state === STATE.BATTLE) {
    const left = Math.max(0, CFG.roundMaxSec - game.stateT);
    const join = game.stateT < CFG.lateJoinSec ? ` · Нэгдэх: ${Math.ceil(CFG.lateJoinSec - game.stateT)}с` : '';
    status = `⚔ РАУНД ${game.round} · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}${join}`;
  } else status = `👑 РАУНД ${game.round} дууслаа`;
  text(status, 40, 232, 30, game.state === STATE.BATTLE ? '#ffd166' : '#25f4ee', 'left', 800, 6);
  if (game.state === STATE.BATTLE && game.stateT > CFG.shrinkStartSec && game.arenaR > ARENA.R0 * CFG.arenaMinFrac + 1)
    text('⚠ АРЕН БАГАСАЖ БАЙНА', 40, 272, 24, '#ff4d6d', 'left', 800, 5);
}

const MEDALS = [
  { fill: ['#ffe27a', '#d4a017'], text: '#3a2a00' },
  { fill: ['#f2f4f8', '#9aa3b5'], text: '#1d2230' },
  { fill: ['#f0b27a', '#a8592a'], text: '#2e1405' },
];
function drawRanking() {
  const x = 760, y = 118, w = 300, rowH = 42;
  const list = game.ranking().slice(0, 10);
  roundRect(x, y, w, 64 + Math.max(1, list.length) * rowH + 10, 22);
  ctx.fillStyle = 'rgba(14,8,34,.72)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; ctx.stroke();
  text('🏆 TOP 10', x + w / 2, y + 32, 26, '#fff', 'center', 900);
  if (!list.length) text('Follow дарж нэгдээрэй', x + w / 2, y + 90, 19, 'rgba(255,255,255,.6)', 'center', 600);
  list.forEach((p, i) => {
    const ry = y + 64 + i * rowH;
    if (i < 3) {
      const g = ctx.createLinearGradient(x + 8, ry, x + w - 8, ry);
      g.addColorStop(0, MEDALS[i].fill[0]); g.addColorStop(1, MEDALS[i].fill[1]);
      roundRect(x + 8, ry + 3, w - 16, rowH - 6, 14); ctx.fillStyle = g; ctx.fill();
    }
    const tc = i < 3 ? MEDALS[i].text : '#fff';
    text(String(i + 1), x + 30, ry + rowH / 2, 22, tc, 'center', 900);
    ctx.save(); ctx.beginPath(); ctx.arc(x + 66, ry + rowH / 2, 17, 0, TAU);
    ctx.fillStyle = hsl(p.color); ctx.fill(); ctx.restore();
    drawAvatar(p, x + 66, ry + rowH / 2, 15);
    text(fitText(p.name, 120, 19, 700), x + 92, ry + rowH / 2 - 1, 19, tc, 'left', 700);
    text(fmt(p.rankValue), x + w - 18, ry + rowH / 2, 19, tc, 'right', 900);
    if (!p.alive) { ctx.globalAlpha = 0.5; text('✖', x + 52, ry + 14, 14, '#ff4d6d', 'center', 900); ctx.globalAlpha = 1; }
  });
}

function drawFeed() {
  const x = 30, y0 = 1625;
  text('LIVE EVENTS', x, y0, 20, 'rgba(255,255,255,.5)', 'left', 800);
  game.feed.forEach((f, i) => {
    const age = game.t - f.t;
    const a = clamp(1 - (age - 12) / 3, 0, 1) * (1 - i * 0.1);
    if (a <= 0) return;
    const y = y0 + 34 + i * 46;
    const slide = clamp(age / 0.25, 0, 1);
    ctx.globalAlpha = a;
    roundRect(x - 20 * (1 - slide), y - 19, 1020, 40, 14);
    ctx.fillStyle = f.big ? 'rgba(255,209,102,.18)' : 'rgba(255,255,255,.07)'; ctx.fill();
    ctx.fillStyle = hsl(f.color); roundRect(x - 20 * (1 - slide), y - 19, 8, 40, 4); ctx.fill();
    text(fitText(f.text, 980, 23, 700), x + 22, y + 1, 23, f.big ? '#ffd166' : '#fff', 'left', 700);
    ctx.globalAlpha = 1;
  });
}

function drawLobbyOverlay() {
  if (game.state !== STATE.LOBBY) return;
  const alive = game.arena.filter(p => p.alive).length;
  ctx.globalAlpha = 0.9;
  text('➕ FOLLOW = Нэгдэх', 540, ARENA.y - 60, 46, '#fff', 'center', 900, 10);
  text('❤ LIKE = Томрох   🎁 GIFT = Хүч', 540, ARENA.y + 2, 34, '#25f4ee', 'center', 800, 8);
  if (alive >= CFG.minPlayers) {
    const n = Math.ceil(CFG.lobbySec - game.stateT);
    const k = 1 + 0.15 * (1 - (CFG.lobbySec - game.stateT) % 1);
    text(String(n), 540, ARENA.y + 110, 110 * k, '#ffd166', 'center', 900, 14);
  }
  ctx.globalAlpha = 1;
}

function drawWinner() {
  if (game.state !== STATE.WINNER) return;
  const t = game.stateT, k = clamp(t / 0.5, 0, 1), e = 1 - Math.pow(1 - k, 3);
  ctx.fillStyle = `rgba(5,2,15,${0.55 * e})`; ctx.fillRect(0, 0, W, H);
  // rays
  ctx.save(); ctx.translate(540, 900); ctx.rotate(t * 0.4);
  for (let i = 0; i < 16; i++) {
    ctx.rotate(TAU / 16);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-60, -900); ctx.lineTo(60, -900); ctx.closePath();
    ctx.fillStyle = `rgba(255,209,102,${0.07 * e})`; ctx.fill();
  }
  ctx.restore();
  const p = game.winner;
  if (!p) { text('Ялагч алга', 540, 900, 70, '#fff', 'center', 900, 12); return; }
  const r = 170 * e;
  ctx.save(); ctx.shadowColor = hsl(p.color); ctx.shadowBlur = 80;
  ctx.beginPath(); ctx.arc(540, 900, r + 14, 0, TAU); ctx.fillStyle = hsl(p.color); ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.arc(540, 900, r + 4, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
  if (r > 4) drawAvatar(p, 540, 900, r);
  text('👑', 540, 900 - r - 70 + Math.sin(t * 4) * 8, 120 * e, '#fff', 'center', 400);
  text(`РАУНД ${game.round} ЯЛАГЧ`, 540, 1170, 52 * e, '#ffd166', 'center', 900, 12);
  text(fitText(p.name, 960, 84), 540, 1260, 84 * e, '#fff', 'center', 900, 14);
  text(`${fmt(p.score)} оноо · ${p.kills} kill · ${p.roundsWon} ялалт`, 540, 1340, 34 * e, '#25f4ee', 'center', 800, 8);
  text(`Дараагийн раунд ${Math.ceil(CFG.winnerSec - t)}...`, 540, 1420, 30, 'rgba(255,255,255,.75)', 'center', 700, 6);
  // confetti
  if (Math.random() < 0.7) game.particles.push({ x: rand(0, W), y: -20, vx: rand(-60, 60), vy: rand(250, 520), life: 4, t: 0, r: rand(5, 11), color: nextColor(), confetti: true });
}

function render() {
  drawBackground();
  drawArena();
  // bigger balls drawn later so they overlap smaller ones
  const sorted = [...game.arena].sort((a, b) => a.r - b.r);
  leaderInArena = null;
  for (const p of game.arena) if (p.alive && (!leaderInArena || p.r > leaderInArena.r)) leaderInArena = p;
  for (const p of sorted) drawBall(p);
  for (const p of sorted) drawBallLabel(p);
  for (const q of game.particles) {
    const a = 1 - q.t / q.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = hsl(q.color, 10);
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
  drawTopBar();
  drawRanking();
  drawFeed();
  drawWinner();
}

// ───────────────────────────── 6. Event input ─────────────────────────────
const NAMES = ['bataa_99', 'saraa.mn', 'tuguldur', 'anu_x', 'khulan', 'temka', 'zola.ub', 'boldoo', 'misheel', 'nomin',
  'ganzo', 'oyunaa', 'tsogoo', 'enkhjin', 'dulmaa', 'azaa_7', 'bilguun', 'naraa', 'khuslen', 'erdene', 'munkh', 'solongo',
  'jaga', 'ariuka', 'unurmaa', 'tamir', 'sukhee', 'gerel', 'ochiroo', 'zaya'];
let simMsg = 0;
function simUser(name, follower = true) {
  const id = 'sim_' + name;
  return { id, uniqueId: name, nickname: name, avatar: '', isFollower: follower };
}
function sim(type, name, extra = {}) {
  game.handleEvent({ type, user: simUser(name), msgId: 'sim' + (++simMsg), ...extra });
}
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
  game.viewers = Math.max(game.viewers, 120 + Math.floor(Math.sin(game.t / 20) * 30 + 30));
  while (autoAcc > 0.1) {
    autoAcc -= 0.1;
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const r = Math.random();
    if (r < 0.03) sim('follow', name);
    else if (r < 0.8) sim('like', name, { count: 1 + Math.floor(Math.random() * 6) });
    else if (r < 0.86) sim('gift', name, { gift: SIM_GIFTS.rose });
    else if (r < 0.885) sim('gift', name, { gift: SIM_GIFTS.small });
    else if (r < 0.89) sim('gift', name, { gift: Math.random() < 0.7 ? SIM_GIFTS.big : SIM_GIFTS.huge });
    else if (r < 0.9) sim('comment', name, { text: ['gogo!', '!stats', 'хүчтэй шүү', 'lol'][Math.floor(Math.random() * 4)] });
  }
}

/** WebSocket client for the bridge server, with reconnect + replay from last seq. */
const bridge = {
  ws: null, url: '', lastSeq: 0, boot: '', retry: 0, timer: null, wanted: false,
  connect(url) {
    this.url = url; this.wanted = true; this.retry = 0; this.open();
  },
  disconnect() { this.wanted = false; clearTimeout(this.timer); if (this.ws) this.ws.close(); setStatus('Салгасан (симуляц горим)', 'off'); },
  open() {
    clearTimeout(this.timer);
    try { this.ws = new WebSocket(this.url); } catch (e) { return this.schedule(); }
    setStatus('Холбогдож байна…', 'warn');
    this.ws.onopen = () => {
      this.retry = 0;
      this.ws.send(JSON.stringify({ type: 'hello', lastSeq: this.lastSeq }));
      setStatus('Bridge-тэй холбогдлоо', 'ok');
    };
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

// ───────────────────────────── 7. UI + boot ─────────────────────────────
const $ = (id) => document.getElementById(id);
function setStatus(msg, level) { const el = $('wsStatus'); el.textContent = msg; el.className = 'status ' + level; }

function initPanel() {
  const params = new URLSearchParams(location.search);
  if (params.get('overlay') === '1') document.body.classList.add('overlay');
  if (params.get('ws')) { $('wsUrl').value = params.get('ws') === 'auto' ? `ws://${location.host}` : params.get('ws'); }
  if (params.get('ws') || params.get('connect') === '1') bridge.connect($('wsUrl').value);
  if (params.get('demo') === '1') { autoSim = true; addBots(14); }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide-panel');
  });
  $('wsConnect').onclick = () => {
    if (bridge.wanted) { bridge.disconnect(); $('wsConnect').textContent = 'Холбох'; }
    else { bridge.connect($('wsUrl').value.trim()); $('wsConnect').textContent = 'Салгах'; }
  };
  if (bridge.wanted) $('wsConnect').textContent = 'Салгах';
  $('simRandom').onclick = () => { $('simUser').value = NAMES[Math.floor(Math.random() * NAMES.length)] + '_' + Math.floor(Math.random() * 90 + 10); };
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const name = $('simUser').value.trim() || 'guest';
    const act = b.dataset.act;
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
    game.seen = new SeenSet(); game.newRound();
  };
  buildBalance();
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

initPanel();
requestAnimationFrame(frame);
window.LBL = { game, bridge, sim, CFG: () => CFG }; // debug handle
})();
