/* LAND BATTLE LIVE — sound effects, music and AI commentator voice.
 * Everything is synthesized with WebAudio (no audio files needed).
 * Exposes window.LBLAudio = { audio, commentator }.
 */
(() => {
'use strict';

const SETTINGS_KEY = 'lbl.audio.v1';
const DEFAULTS = { sfxVol: 0.7, musicVol: 0.35, music: true, voiceMode: 'browser', voiceName: '', voiceVol: 1, voiceRate: 1.0, voiceChatty: 1, useRecorded: true };
let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch {}
function save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch {} }

// ───────────────────────────── Sound engine ─────────────────────────────
const audio = {
  ctx: null, master: null, sfxBus: null, musicBus: null, noiseBuf: null,
  last: {},                 // name → time last played (rate limiting)
  musicTimer: null, nextBeat: 0, beat: 0, intensity: 0,

  get settings() { return S; },
  save,
  get running() { return !!this.ctx && this.ctx.state === 'running'; },

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain(); this.master.gain.value = 1; this.master.connect(comp);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
    this.applyVolumes();
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ctx.onstatechange = () => this.onState && this.onState(this.ctx.state);
  },
  unlock() {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (!this.musicTimer) this.startMusic();
  },
  applyVolumes() {
    if (!this.ctx) return;
    this.sfxBus.gain.value = S.sfxVol;
    this.musicBus.gain.value = S.music ? S.musicVol * 0.5 : 0;
  },
  /** Lower music + sfx while the commentator speaks. */
  duck(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime((S.music ? S.musicVol * 0.5 : 0) * (on ? 0.35 : 1), t, 0.12);
    this.sfxBus.gain.setTargetAtTime(S.sfxVol * (on ? 0.6 : 1), t, 0.12);
  },

  tone(freq, dur, o = {}) {
    const c = this.ctx, t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    const vol = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.bus || this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  },
  noise(dur, o = {}) {
    const c = this.ctx, t = c.currentTime + (o.at || 0);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.from || 1000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q || 1;
    const g = c.createGain(), vol = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || this.sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },

  /** Play a named effect. `k` (0..1) scales intensity where it applies. */
  play(name, k = 1) {
    if (!this.running) return;
    const gap = { bump: 0.07, like: 0.11, join: 0.15, tick: 0.2, vote: 0.08, gallop: 0.18, splash: 0.2, land: 0.1 }[name] || 0.04;
    const now = this.ctx.currentTime;
    if (now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    const fx = SFX[name];
    if (fx) fx(this, clamp01(k));
  },

  // ── crowd ambience (Naadam spectators): filtered noise bed, level 0..1 ──
  crowdGain: null,
  setCrowd(level) {
    if (!this.ctx) return;
    if (!this.crowdGain) {
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.7;
      const lfo = this.ctx.createOscillator(), lfoG = this.ctx.createGain(); lfo.frequency.value = 0.23; lfoG.gain.value = 250;
      lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start();
      this.crowdGain = this.ctx.createGain(); this.crowdGain.gain.value = 0;
      src.connect(bp); bp.connect(this.crowdGain); this.crowdGain.connect(this.sfxBus); src.start();
    }
    this.crowdGain.gain.setTargetAtTime(0.09 * Math.max(0, level), this.ctx.currentTime, 0.8);
  },

  // ── tiny procedural music loop; gets busier during battle ──
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 50);
  },
  scheduleMusic() {
    if (!this.running) return;
    const spb = 60 / (this.intensity >= 2 ? 128 : 112) / 2; // eighth notes
    const bass = [55, 55, 43.65, 43.65, 65.41, 65.41, 49, 49];      // A1 F1 C2 G1
    const arp = [440, 523.25, 659.25, 523.25, 349.23, 440, 523.25, 440, 523.25, 659.25, 783.99, 659.25, 392, 493.88, 587.33, 493.88];
    while (this.nextBeat < this.ctx.currentTime + 0.2) {
      const at = this.nextBeat - this.ctx.currentTime, b = this.beat, bus = this.musicBus;
      const bar = Math.floor(b / 8) % 8;
      if (b % 4 === 0) this.tone(140, 0.22, { to: 45, vol: 0.55, at, bus });                                   // kick
      if (this.intensity >= 1 && b % 2 === 1) this.noise(0.05, { type: 'highpass', from: 7000, vol: 0.12, at, bus }); // hat
      if (this.intensity >= 1 && b % 8 === 4) this.noise(0.14, { type: 'bandpass', from: 1800, vol: 0.18, at, bus });  // snare
      if (b % 2 === 0) this.tone(bass[bar] * 2, spb * 1.8, { type: 'square', vol: 0.12, lp: 500, at, bus });
      if (this.intensity >= 2) this.tone(arp[b % 16] , spb * 0.9, { type: 'triangle', vol: 0.06, at, bus });
      else if (b % 4 === 2) this.tone(arp[b % 16], spb * 1.5, { type: 'sine', vol: 0.05, at, bus });
      this.nextBeat += spb; this.beat++;
    }
  },
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const SFX = {
  join: (a) => { a.tone(420, 0.16, { to: 900, vol: 0.25 }); a.tone(1320, 0.12, { vol: 0.12, at: 0.08 }); },
  like: (a) => a.tone(1100 + Math.random() * 300, 0.06, { to: 1600, vol: 0.05 }),
  bump: (a, k) => { a.tone(120 + 80 * k, 0.14, { to: 50, type: 'triangle', vol: 0.15 + 0.35 * k }); a.noise(0.06, { from: 900, vol: 0.06 + 0.12 * k }); },
  rose: (a) => { a.tone(784, 0.18, { type: 'triangle', vol: 0.2 }); a.tone(1175, 0.25, { type: 'triangle', vol: 0.16, at: 0.08 }); },
  gift: (a) => [523, 659, 784, 1046].forEach((f, i) => a.tone(f, 0.18, { type: 'triangle', vol: 0.2, at: i * 0.06 })),
  big: (a) => {
    a.noise(0.7, { type: 'bandpass', from: 200, to: 5000, q: 2, vol: 0.35 });
    [196, 247, 294].forEach(f => a.tone(f, 0.7, { type: 'sawtooth', vol: 0.09, lp: 1800, at: 0.2 }));
    [523, 659, 784, 1046, 1318].forEach((f, i) => a.tone(f, 0.22, { type: 'square', vol: 0.08, lp: 3000, at: 0.25 + i * 0.07 }));
  },
  lifeLost: (a) => { a.tone(440, 0.12, { type: 'square', vol: 0.12, lp: 2000 }); a.tone(330, 0.2, { type: 'square', vol: 0.12, lp: 2000, at: 0.12 }); },
  elim: (a) => { a.tone(700, 0.5, { to: 70, type: 'sawtooth', vol: 0.2, lp: 2200 }); a.noise(0.5, { from: 3000, to: 200, vol: 0.2 }); },
  beep: (a) => a.tone(880, 0.13, { type: 'square', vol: 0.15, lp: 3000 }),
  go: (a) => { [523, 659, 784, 1046].forEach(f => a.tone(f, 0.6, { type: 'sawtooth', vol: 0.08, lp: 2500 })); a.noise(0.4, { from: 400, to: 6000, vol: 0.2 }); },
  alarm: (a) => [0, 0.25, 0.5].forEach(t => { a.tone(760, 0.12, { type: 'square', vol: 0.1, lp: 2500, at: t }); a.tone(560, 0.12, { type: 'square', vol: 0.1, lp: 2500, at: t + 0.12 }); }),
  win: (a) => {
    const mel = [[523, 0], [659, .15], [784, .3], [1046, .45], [784, .65], [1046, .8]];
    mel.forEach(([f, t]) => { a.tone(f, 0.3, { type: 'square', vol: 0.12, lp: 3500, at: t }); a.tone(f / 2, 0.3, { type: 'triangle', vol: 0.12, at: t }); });
    a.noise(1.2, { type: 'highpass', from: 5000, vol: 0.08, at: 0.8 });
  },
  tick: (a) => a.tone(1500, 0.03, { type: 'square', vol: 0.05 }),
  // three-beat gallop of hooves on the steppe
  gallop: (a) => [0, 0.07, 0.13].forEach((t, i) => { a.tone(95 - i * 8, 0.07, { to: 55, type: 'triangle', vol: 0.22, at: t }); a.noise(0.05, { from: 700, vol: 0.07, at: t }); }),
  whoosh: (a) => { a.noise(0.55, { type: 'bandpass', from: 300, to: 3500, q: 1.5, vol: 0.3 }); a.tone(300, 0.5, { to: 900, type: 'sine', vol: 0.08 }); },
  land: (a) => { a.tone(110, 0.2, { to: 45, type: 'triangle', vol: 0.35 }); a.noise(0.2, { from: 600, to: 150, vol: 0.18 }); },
  splash: (a) => a.noise(0.25, { type: 'bandpass', from: 1800, to: 700, q: 0.8, vol: 0.12 }),
  stumble: (a) => { a.tone(500, 0.35, { to: 140, type: 'square', vol: 0.09, lp: 1500 }); a.noise(0.15, { from: 900, vol: 0.15 }); },
  photo: (a) => { a.noise(0.03, { type: 'highpass', from: 3000, vol: 0.35 }); a.noise(0.05, { type: 'highpass', from: 2000, vol: 0.25, at: 0.07 }); },
  // big crowd cheer: swelling filtered noise + a few "hey!" formants
  cheer: (a) => {
    a.noise(2.2, { type: 'bandpass', from: 500, to: 1400, q: 0.6, vol: 0.45, attack: 0.25 });
    for (let i = 0; i < 6; i++) a.tone(220 + Math.random() * 260, 0.25, { to: 160, type: 'sawtooth', vol: 0.03, lp: 1200, at: 0.1 + Math.random() * 0.9 });
  },
  // sad "wah-wah-wah-waaah" (descending, with a wobble on the last note)
  sad: (a) => {
    const notes = [[392, 0, 0.42], [370, 0.45, 0.42], [349, 0.9, 0.42], [330, 1.35, 1.4]];
    for (const [f, at, d] of notes) {
      a.tone(f, d, { type: 'sawtooth', vol: 0.16, lp: 900, at, attack: 0.04 });
      a.tone(f / 2, d, { type: 'triangle', vol: 0.1, at });
    }
    for (let k = 0; k < 7; k++) a.tone(330 - (k % 2) * 14, 0.18, { type: 'sawtooth', vol: 0.05, lp: 700, at: 1.45 + k * 0.17 });
  },
  // short disappointed "өө…"
  sigh: (a) => { a.tone(330, 0.35, { to: 262, type: 'triangle', vol: 0.2 }); a.tone(262, 0.6, { to: 196, type: 'triangle', vol: 0.18, at: 0.35 }); },
  // deep "пал" of money dropping into the pit
  drop: (a) => {
    a.tone(90, 0.7, { to: 32, type: 'sine', vol: 0.75 });
    a.tone(180, 0.25, { to: 60, type: 'triangle', vol: 0.3 });
    a.noise(0.35, { from: 900, to: 120, vol: 0.4 });
    a.noise(0.9, { type: 'lowpass', from: 300, to: 60, vol: 0.18, at: 0.1 });
  },
  // suspense drum roll (~1.5 s)
  drumroll: (a) => { for (let i = 0; i < 26; i++) a.noise(0.06, { type: 'bandpass', from: 220 + i * 6, q: 1.2, vol: 0.12 + i * 0.008, at: i * 0.055 }); a.tone(70, 0.3, { to: 50, vol: 0.4, at: 1.45 }); },
  box: (a) => [880, 1175, 1568, 2093].forEach((f, i) => a.tone(f, 0.12, { type: 'sine', vol: 0.1, at: i * 0.05 })),
  vote: (a) => { a.tone(660, 0.08, { type: 'triangle', vol: 0.15 }); a.tone(990, 0.1, { type: 'triangle', vol: 0.12, at: 0.06 }); },
};

// ───────────────────────────── Recorded voice lines ─────────────────────────────
/* Phrases a streamer can record in their own voice (panel → "Хоолой бичих").
 * Names are never in a recording: the name is shown on screen instead. */
const VOICE_LINES = [
  ['start',      'Тулаан эхлэх',          'Тулаан эхэллээ! Бусдаа талбайгаас шахаж гарга!'],
  ['soon',       'Удахгүй эхлэх',         'Тулаан удахгүй эхэлнэ! Like дараад томор!'],
  ['lobby',      'Тоглогч урих',          'Follow дараад тоглоомд ороорой! Like дарвал томорно!'],
  ['newround',   'Шинэ раунд',            'Шинэ раунд эхэллээ! Follow дараад нэгдээрэй!'],
  ['join',       'Тоглогч нэгдэх',        'Шинэ тоглогч орлоо!'],
  ['gift_small', 'Жижиг gift',            'Баярлалаа! Өсөлт хоёр дахин!'],
  ['gift_big',   'Том gift',              'Гайхалтай! Хүч нэмэгдлээ! Бүгд болгоомжтой!'],
  ['rose_back',  'Rose-оор буцах',        'Сарнайгаар тулаанд буцаж орлоо!'],
  ['hit',        'Шахалт',                'Хүчтэй түлхэлт!'],
  ['out',        'Хасагдах',              'Хасагдлаа!'],
  ['leader',     'Тэргүүлэгч солигдох',   'Шинэ тэргүүлэгч гарч ирлээ!'],
  ['shrink',     'Арен багасах',          'Анхаар! Талбай багасаж байна!'],
  ['sec30',      '30 секунд',             'Гучин секунд үлдлээ!'],
  ['final3',     'Сүүлийн 3',             'Сүүлийн гурван тоглогч үлдлээ!'],
  ['final2',     'Сүүлийн 2',             'Сүүлийн хоёр! Хэн нь ялах вэ?'],
  ['goal_info',  'Тоглоомын танилцуулга', 'МАЛЧИН тоглоомын тухай... (өөрийн танилцуулгаа бичнэ)'],
  ['goal_step',  'Зорилгын 25/50/75%',   'Зорилгын нэг хэсэг биеллээ! Баярлалаа!'],
  ['goal_done',  'Зорилго биелэх',       'Зорилго биеллээ! Бүгдэд баярлалаа!'],
  ['win',        'Ялагч',                 'Ялагч тодорлоо! Баяр хүргэе!'],
];

// ───────────────────────────── AI commentator ─────────────────────────────
/* Short Mongolian lines spoken over the game.
 *  - 'browser': Web Speech API (free; picks a Mongolian voice if the OS has one, else Russian/any)
 *  - 'azure'  : neural Mongolian voice (mn-MN) synthesized by the bridge server (/tts)
 *  - 'off'
 * A small priority queue keeps it from talking over itself or lagging behind the action. */
const commentator = {
  queue: [], speaking: false, ttsBase: '', voices: [], lastSpokeAt: 0, audioEl: null, onError: null,
  clips: {},              // key → [file names] recorded by the streamer (served by the bridge)
  lastClip: {},

  get settings() { return S; },
  loadVoices() {
    if (!('speechSynthesis' in window)) return [];
    this.voices = speechSynthesis.getVoices();
    return this.voices;
  },
  pickVoice() {
    const vs = this.voices.length ? this.voices : this.loadVoices();
    return vs.find(v => v.name === S.voiceName) || vs.find(v => /^mn/i.test(v.lang) && /natural|online/i.test(v.name)) || vs.find(v => /^mn/i.test(v.lang)) || vs.find(v => /^ru/i.test(v.lang)) || null;
  },
  hasClip(key) { return !!(S.useRecorded && key && this.clips[key] && this.clips[key].length); },
  async loadClips() {
    if (!this.ttsBase && !location.protocol.startsWith('http')) return this.clips;
    try { const r = await fetch(`${this.ttsBase}/voices`); if (r.ok) this.clips = await r.json(); } catch {}
    return this.clips;
  },
  /** prio: 1 = chatter (dropped when busy), 2 = normal, 3 = important (jumps the queue).
   *  key: id of a recorded line; when the streamer recorded it, the recording is played instead of TTS. */
  say(text, prio = 2, key = '') {
    const clip = this.hasClip(key);
    if (!clip && (S.voiceMode === 'off' || !text)) return;
    if (prio < 3 - S.voiceChatty) return;      // chattiness: 0 = only important, 1 = normal+, 2 = everything
    if (prio <= 1 && (this.speaking || this.queue.length)) return;
    const clean = String(text || key).replace(/[\p{Extended_Pictographic}‍️]/gu, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    this.queue.push({ text: clean, key: clip ? key : '', prio, at: performance.now() });
    this.queue.sort((a, b) => b.prio - a.prio || a.at - b.at);
    if (this.queue.length > 3) this.queue.length = 3;
    this.next();
  },
  stop() {
    this.queue = [];
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.audioEl) { this.audioEl.pause(); this.audioEl = null; }
    this.done();
  },
  next() {
    if (this.speaking) return;
    // drop stale lines (older than 6s) so the voice never lags far behind the game
    const fresh = performance.now() - 6000;
    this.queue = this.queue.filter(q => q.at > fresh || q.prio >= 3);
    const item = this.queue.shift();
    if (!item) return;
    this.speaking = true;
    audio.duck(true);
    if (item.key && this.hasClip(item.key)) this.playClip(item.key);
    else if (S.voiceMode === 'azure') this.speakAzure(item.text);
    else this.speakBrowser(item.text);
  },
  done() {
    this.speaking = false; this.lastSpokeAt = performance.now();
    audio.duck(false);
    setTimeout(() => this.next(), 250);
  },
  playClip(key) {
    const files = this.clips[key];
    let f = files[Math.floor(Math.random() * files.length)];
    if (files.length > 1 && f === this.lastClip[key]) f = files[(files.indexOf(f) + 1) % files.length];
    this.lastClip[key] = f;
    this.playUrl(`${this.ttsBase}/voices/${encodeURIComponent(f)}`, 1);
  },
  playUrl(url, rate, revoke) {
    const el = new Audio(url);
    this.audioEl = el;
    el.volume = S.voiceVol; el.playbackRate = rate;
    const fin = () => { if (revoke) URL.revokeObjectURL(url); if (this.audioEl === el) { this.audioEl = null; this.done(); } };
    el.onended = fin; el.onerror = fin;
    el.play().catch(fin);
  },
  speakBrowser(text) {
    if (!('speechSynthesis' in window)) { this.done(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'mn-MN';
    u.rate = S.voiceRate; u.volume = S.voiceVol; u.pitch = 1;
    let finished = false;
    const fin = () => { if (!finished) { finished = true; this.done(); } };
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, 9000); // safety: some engines never fire onend
    speechSynthesis.speak(u);
  },
  speakAzure(text) {
    const base = this.ttsBase || '';
    fetch(`${base}/tts?text=${encodeURIComponent(text)}`).then(r => {
      if (!r.ok) throw new Error('TTS ' + r.status);
      return r.blob();
    }).then(blob => {
      this.playUrl(URL.createObjectURL(blob), S.voiceRate, true);
    }).catch(err => { if (this.onError) this.onError(err); this.done(); });
  },
};
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => commentator.loadVoices();

window.LBLAudio = { audio, commentator, VOICE_LINES };
})();
