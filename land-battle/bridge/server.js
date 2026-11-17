/* LAND BATTLE LIVE — TikTok LIVE bridge
 *
 * TikTok LIVE  ──(source adapter)──►  normalize + dedupe + seq  ──(WebSocket)──►  game (browser)
 *
 * Usage:
 *   npm install
 *   node server.js --user=@your_tiktok_name [--port=8787] [--mock]
 *   Optional Mongolian AI voice:  AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=eastasia node server.js ...
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

// ───────── AI commentator voice: Azure neural TTS (mn-MN) ─────────
// Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (e.g. eastasia). Voices: mn-MN-BataaNeural (male), mn-MN-YesuiNeural (female).
const AZ_KEY = process.env.AZURE_SPEECH_KEY || '';
const AZ_REGION = process.env.AZURE_SPEECH_REGION || 'eastasia';
const AZ_VOICE = process.env.AZURE_VOICE || 'mn-MN-BataaNeural';
const ttsCache = new Map();          // text → mp3 Buffer (commentary lines repeat a lot)
const xmlEscape = (s) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
async function handleTts(req, res, query) {
  const text = String(query.get('text') || '').slice(0, 300).trim();
  if (!AZ_KEY) { res.writeHead(503, { 'Access-Control-Allow-Origin': '*' }); return res.end('AZURE_SPEECH_KEY not set'); }
  if (!text) { res.writeHead(400); return res.end(); }
  try {
    let mp3 = ttsCache.get(text);
    if (!mp3) {
      const ssml = `<speak version="1.0" xml:lang="mn-MN"><voice name="${AZ_VOICE}"><prosody rate="+8%">${xmlEscape(text)}</prosody></voice></speak>`;
      const r = await fetch(`https://${AZ_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': AZ_KEY, 'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'land-battle-live' },
        body: ssml,
      });
      if (!r.ok) throw new Error(`Azure TTS ${r.status}`);
      mp3 = Buffer.from(await r.arrayBuffer());
      ttsCache.set(text, mp3);
      if (ttsCache.size > 300) ttsCache.delete(ttsCache.keys().next().value);
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400' });
    res.end(mp3);
  } catch (e) {
    console.warn('[tts]', e.message);
    res.writeHead(502, { 'Access-Control-Allow-Origin': '*' }); res.end(e.message);
  }
}

// ───────── Streamer's own recorded voice lines ─────────
// Stored in bridge/voices/<key>_<n>.<ext>. You can also drop your own mp3/wav files here
// named like start_1.mp3, final3_2.wav (keys are listed in audio.js → VOICE_LINES).
const VOICE_DIR = path.join(__dirname, 'voices');
const AUDIO_TYPES = { '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
const CLIP_RE = /^([a-z0-9]+(?:_[a-z0-9]+)*)_(\d+)\.(webm|ogg|mp3|wav|m4a)$/;
function listVoices() {
  const out = {};
  let files = [];
  try { files = fs.readdirSync(VOICE_DIR); } catch {}
  for (const f of files.sort()) { const m = CLIP_RE.exec(f); if (m) (out[m[1]] = out[m[1]] || []).push(f); }
  return out;
}
function handleVoices(req, res, sub) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (!sub && req.method === 'GET') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify(listVoices())); }
  if (req.method === 'GET' && CLIP_RE.test(sub)) {
    return fs.readFile(path.join(VOICE_DIR, sub), (err, data) => {
      if (err) { res.writeHead(404, cors); return res.end(); }
      res.writeHead(200, { ...cors, 'Content-Type': AUDIO_TYPES[path.extname(sub)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  if (req.method === 'DELETE' && CLIP_RE.test(sub)) {
    fs.unlink(path.join(VOICE_DIR, sub), () => { res.writeHead(204, cors); res.end(); });
    return;
  }
  if (req.method === 'POST' && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(sub)) {
    // only accept uploads from this computer
    const ra = req.socket.remoteAddress || '';
    if (!/^(::1|127\.|::ffff:127\.)/.test(ra)) { res.writeHead(403, cors); return res.end(); }
    const ct = String(req.headers['content-type'] || '');
    const ext = ct.includes('ogg') ? 'ogg' : ct.includes('mpeg') ? 'mp3' : ct.includes('wav') ? 'wav' : ct.includes('mp4') ? 'm4a' : 'webm';
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 3e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      fs.mkdirSync(VOICE_DIR, { recursive: true });
      const name = `${sub}_${Date.now()}.${ext}`;
      fs.writeFile(path.join(VOICE_DIR, name), Buffer.concat(chunks), err => {
        res.writeHead(err ? 500 : 200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ file: name }));
      });
    });
    return;
  }
  res.writeHead(400, cors); res.end();
}

// ───────── HTTP (serves the game folder) + WebSocket ─────────
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const [rawPath, qs] = (req.url || '/').split('?');
  if (rawPath === '/tts') return handleTts(req, res, new URLSearchParams(qs || ''));
  if (rawPath === '/voices' || rawPath.startsWith('/voices/')) return handleVoices(req, res, decodeURIComponent(rawPath.slice(8)));
  const url = decodeURIComponent(rawPath);
  const file = path.resolve(ROOT, '.' + (url === '/' ? '/index.html' : url));
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}bridge${path.sep}`)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('error', () => {}); // listen errors are reported by server.on('error')
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

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Порт ${PORT} эзэлсэн байна — bridge аль хэдийн ажиллаж байж магадгүй. Нөгөө цонхыг хаагаад дахин оролдоно уу.`);
  else console.error(e);
  process.exit(1);
});
function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

server.listen(PORT, () => {
  const voice = AZ_KEY ? '&voice=azure' : '';
  console.log('');
  console.log(`  Тоглоом + самбар : http://localhost:${PORT}/?ws=auto${voice}`);
  console.log(`  OBS / LIVE Studio: http://localhost:${PORT}/?ws=auto&overlay=1${voice}   (1080 x 1920)`);
  console.log(`  AI монгол хоолой : ${AZ_KEY ? 'Azure ' + AZ_VOICE : 'браузер TTS (Azure түлхүүр тохируулаагүй)'}`);
  console.log('  Зогсоох: Ctrl+C');
  console.log('');
  if (args.open) openBrowser(`http://localhost:${PORT}/?ws=auto${voice}`);
  if (MOCK) createMockSource(); else createTikTokSource();
});
