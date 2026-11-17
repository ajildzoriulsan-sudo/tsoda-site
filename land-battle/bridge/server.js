/* LAND BATTLE LIVE — TikTok LIVE bridge
 *
 * TikTok LIVE  ──(source adapter)──►  normalize + dedupe + seq  ──(WebSocket)──►  game (browser)
 *
 * Usage:
 *   npm install
 *   node server.js --user=@your_tiktok_name [--port=8787] [--mock]
 *
 * Then open  http://localhost:8787/?ws=auto   (it serves the game too).
 * For OBS / TikTok LIVE Studio browser source:  http://localhost:8787/?ws=auto&overlay=1
 *
 * Event source: the community library `tiktok-live-connector` (unofficial; it reads the
 * public LIVE webcast feed). It is NOT an official TikTok API. Check TikTok's current terms
 * and any official LIVE developer program before using it on a production account; the
 * source is isolated in createTikTokSource() so it can be replaced with an approved provider.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ───────── args ─────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const PORT = Number(args.port || process.env.PORT || 8787);
const USER = String(args.user || process.env.TIKTOK_USER || '').replace(/^@/, '');
const MOCK = !!args.mock;
if (!USER && !MOCK) {
  console.error('Usage: node server.js --user=@tiktok_username   (or --mock for fake events)');
  process.exit(1);
}

// ───────── event log with sequence numbers (for recovery after reconnect) ─────────
const BUFFER_MAX = 2000;
const buffer = [];           // [{seq, ...event}]
let seq = 0;
const BOOT = Date.now().toString(36); // lets clients detect a server restart (seq starts over)
const seenMsg = new Set(); const seenQ = [];
function seen(id) {
  if (!id) return false;
  if (seenMsg.has(id)) return true;
  seenMsg.add(id); seenQ.push(id);
  if (seenQ.length > 10000) seenMsg.delete(seenQ.shift());
  return false;
}
function publish(ev) {
  if (seen(ev.msgId)) return;
  const out = { seq: ++seq, ts: Date.now(), ...ev };
  buffer.push(out);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  broadcast(out);
}

// ───────── like aggregation: one TikTok user can fire many like events ─────────
// Likes are summed per user and flushed every 250 ms, so the game receives at most
// ~4 like messages per user per second regardless of how fast they tap.
const likeAgg = new Map();   // userId → {user, count}
setInterval(() => {
  for (const { user, count } of likeAgg.values()) publish({ type: 'like', user, count });
  likeAgg.clear();
}, 250);

// ───────── gift streaks: TikTok repeats streakable gifts with growing repeatCount ─────────
const streaks = new Map();   // key → last repeatCount
function giftDelta(key, repeatCount, ended) {
  const prev = streaks.get(key) || 0;
  const delta = Math.max(0, repeatCount - prev);
  if (ended) streaks.delete(key); else streaks.set(key, repeatCount);
  if (streaks.size > 5000) streaks.delete(streaks.keys().next().value);
  return delta;
}

// ───────── normalization (tolerates v1 flat and v2 nested shapes) ─────────
function pic(u) {
  const p = u?.profilePicture || u?.profilePictureMedium;
  return (p?.url && p.url[0]) || u?.profilePictureUrl || '';
}
function normUser(d) {
  const u = d.user || d;
  const id = String(u.userId || u.uniqueId || d.userId || d.uniqueId || '');
  const follow = Number(u.followInfo?.followStatus ?? d.followRole ?? 0);
  return {
    id,
    uniqueId: u.uniqueId || d.uniqueId || '',
    nickname: u.nickname || d.nickname || u.uniqueId || '',
    avatar: pic(u) || pic(d),
    isFollower: follow >= 1,
  };
}
const msgId = (d) => d.common?.msgId || d.msgId || undefined;

// ───────── TikTok source ─────────
let viewers = 0;
let liveStatus = { text: 'Эхэлж байна…', level: 'warn' };
function setLive(text, level) { liveStatus = { text, level }; broadcast({ type: 'status', text, level, viewers }); console.log(`[tiktok] ${text}`); }

function createTikTokSource() {
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');
  let conn = null, retry = 0, timer = null;

  function attach(c) {
    c.on(WebcastEvent.FOLLOW, d => publish({ type: 'follow', user: { ...normUser(d), isFollower: true }, msgId: msgId(d) }));
    c.on(WebcastEvent.SHARE, d => publish({ type: 'share', user: normUser(d), msgId: msgId(d) }));
    c.on(WebcastEvent.CHAT, d => publish({ type: 'comment', user: normUser(d), text: d.comment || '', msgId: msgId(d) }));
    c.on(WebcastEvent.LIKE, d => {
      const user = normUser(d); if (!user.id) return;
      const cur = likeAgg.get(user.id) || { user, count: 0 };
      cur.count += Number(d.likeCount || 1);
      likeAgg.set(user.id, cur);
    });
    c.on(WebcastEvent.GIFT, d => {
      const user = normUser(d);
      const g = d.giftDetails || d;
      const giftId = d.giftId || g.id;
      const streakable = Number(g.giftType ?? d.giftType) === 1;
      const repeat = Number(d.repeatCount || 1);
      const ended = !!(d.repeatEnd);
      const count = streakable ? giftDelta(`${user.id}:${giftId}:${d.groupId || ''}`, repeat, ended) : repeat;
      if (count <= 0) return;
      publish({
        type: 'gift', user, msgId: msgId(d) ? `${msgId(d)}:${repeat}` : undefined,
        gift: { id: giftId, name: g.giftName || d.giftName || 'Gift', diamonds: Number(g.diamondCount ?? d.diamondCount ?? 1), count },
      });
    });
    c.on(WebcastEvent.ROOM_USER, d => { viewers = Number(d.viewerCount || 0); broadcast({ type: 'viewers', count: viewers }); });
    c.on(WebcastEvent.STREAM_END, () => { setLive('LIVE дууссан. Дахин эхлэхийг хүлээж байна…', 'warn'); reconnect(); });
    c.on(ControlEvent.DISCONNECTED, () => { setLive('TikTok-оос салсан', 'warn'); reconnect(); });
    c.on(ControlEvent.ERROR, e => console.warn('[tiktok] error:', e?.info || e?.message || String(e)));
  }

  function connect() {
    clearTimeout(timer);
    conn = new TikTokLiveConnection(USER, { enableExtendedGiftInfo: true, processInitialData: false });
    attach(conn);
    setLive(`@${USER} LIVE-д холбогдож байна…`, 'warn');
    conn.connect().then(state => {
      retry = 0;
      setLive(`@${USER} LIVE-тэй холбогдлоо (room ${state.roomId})`, 'ok');
    }).catch(err => {
      setLive(`Холбогдож чадсангүй: ${err?.message || err}`, 'warn');
      reconnect();
    });
  }
  function reconnect() {
    if (timer) return;
    try { conn && conn.removeAllListeners && conn.removeAllListeners(); conn && conn.disconnect(); } catch {}
    const delay = Math.min(60, 5 * 2 ** retry++);
    console.log(`[tiktok] reconnect in ${delay}s`);
    timer = setTimeout(() => { timer = null; connect(); }, delay * 1000);
  }
  connect();
}

// ───────── mock source (no TikTok) ─────────
function createMockSource() {
  const names = ['bataa', 'saraa', 'anu', 'temka', 'zola', 'nomin', 'ganzo', 'khulan', 'tamir', 'gerel', 'misheel', 'boldoo'];
  const user = n => ({ id: 'mock_' + n, uniqueId: n, nickname: n, avatar: '', isFollower: true });
  setLive('MOCK горим: хуурамч event үүсгэж байна', 'ok');
  let i = 0;
  setInterval(() => {
    const n = names[Math.floor(Math.random() * names.length)];
    const r = Math.random();
    if (i++ < names.length) publish({ type: 'follow', user: user(names[i - 1]) });
    else if (r < 0.45) { const c = likeAgg.get('mock_' + n) || { user: user(n), count: 0 }; c.count += 1 + (Math.random() * 5 | 0); likeAgg.set('mock_' + n, c); }
    else if (r < 0.5) publish({ type: 'gift', user: user(n), gift: { name: 'Rose', diamonds: 1, count: 1 } });
    else if (r < 0.505) publish({ type: 'gift', user: user(n), gift: { name: 'Lion', diamonds: 299, count: 1 } });
    viewers = 100 + (Math.random() * 20 | 0);
  }, 150);
  setInterval(() => broadcast({ type: 'viewers', count: viewers }), 3000);
}

// ───────── HTTP (serves the game folder) + WebSocket ─────────
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.resolve(ROOT, '.' + (url === '/' ? '/index.html' : url));
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}bridge${path.sep}`)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'status', ...liveStatus, viewers, boot: BOOT }));
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'hello') {
      // event recovery: replay everything the client missed while disconnected
      const last = Number(m.lastSeq || 0);
      const missed = last > 0 ? buffer.filter(e => e.seq > last) : [];
      if (missed.length) ws.send(JSON.stringify({ type: 'events', events: missed }));
      console.log(`[ws] client connected (lastSeq=${last}, replayed ${missed.length})`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`LAND BATTLE LIVE bridge → http://localhost:${PORT}/?ws=auto`);
  if (MOCK) createMockSource(); else createTikTokSource();
});
