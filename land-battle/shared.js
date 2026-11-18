/* Shared helpers for the LIVE games: name filter, viewer titles, persistent score board.
 * Exposes window.LBLShared = { cleanName, titleFor, scores }.
 *
 * Scores are kept by the bridge (bridge/data/store.json) so a weekly / all-time board survives
 * restarts and is shared by every window (panel, OBS). Without the bridge they fall back to
 * this browser's localStorage.
 */
(() => {
'use strict';

// ── bad-word filter ──
const norm = (s) => String(s || '').toLowerCase().replace(/[\s._\-*0-9]+/g, '')
  .replace(/[@4]/g, 'a').replace(/[$5]/g, 's').replace(/[!1|]/g, 'i').replace(/0/g, 'o');
function isBad(s) {
  const n = norm(s), raw = String(s || '').toLowerCase();
  return (window.BAD_WORDS || []).some(w => w && (n.includes(norm(w)) || raw.includes(w.toLowerCase())));
}
/** Safe display name: offensive names become "Үзэгч 1234" (stable per user id). */
function cleanName(name, id) {
  if (!isBad(name)) return name;
  let h = 0; for (const c of String(id || name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 'Үзэгч ' + (1000 + h % 9000);
}

// ── Naadam-style titles by all-time points ──
const TITLES = [
  [5000, 'Улсын алдарт уяач', '🥇'],
  [1500, 'Аймгийн алдарт уяач', '🥈'],
  [300, 'Алдарт уяач', '🥉'],
  [0, 'Уяач', ''],
];
function titleFor(pts) { for (const t of TITLES) if ((pts || 0) >= t[0]) return { name: t[1], icon: t[2], min: t[0] }; return null; }

// ── persistent scores (bridge, else localStorage) ──
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
const LOCAL_KEY = 'lbl.store.v1';
function localStore() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; } }
function saveLocal(s) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); } catch {} }
function applyLocal(store, game, entries) {
  const g = store[game] = store[game] || { all: {}, weeks: {} };
  const wk = isoWeek(); const week = g.weeks[wk] = g.weeks[wk] || {};
  const out = { all: {}, week: {} };
  for (const e of entries) {
    for (const [tbl, key] of [[g.all, 'all'], [week, 'week']]) {
      const r = tbl[e.id] = tbl[e.id] || { name: e.name, avatar: e.avatar || '', pts: 0 };
      r.name = e.name; if (e.avatar) r.avatar = e.avatar; r.pts += e.add;
      out[key][e.id] = r.pts;
    }
  }
  return out;
}
const top = (tbl, n) => Object.entries(tbl || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.pts - a.pts).slice(0, n);

const scores = {
  base: '',                        // bridge http base, e.g. http://localhost:8787 ('' = local only)
  /** Add points for many viewers at once. Resolves to { all: {id: pts}, week: {id: pts} }. */
  async add(game, entries) {
    entries = entries.filter(e => e.add > 0);
    if (!entries.length) return { all: {}, week: {} };
    if (this.base) {
      try {
        const r = await fetch(`${this.base}/api/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game, entries }) });
        if (r.ok) return await r.json();
      } catch {}
    }
    const s = localStore(); const out = applyLocal(s, game, entries); saveLocal(s); return out;
  },
  /** { week: [...top], all: [...top] } */
  async board(game, n = 10) {
    if (this.base) {
      try { const r = await fetch(`${this.base}/api/board?game=${encodeURIComponent(game)}&n=${n}`); if (r.ok) return await r.json(); } catch {}
    }
    const g = localStore()[game] || { all: {}, weeks: {} };
    return { week: top(g.weeks[isoWeek()], n), all: top(g.all, n) };
  },
  /** all-time points of some viewers: { id: pts } */
  async lookup(game, ids) {
    if (!ids.length) return {};
    if (this.base) {
      try { const r = await fetch(`${this.base}/api/lookup?game=${encodeURIComponent(game)}&ids=${encodeURIComponent(ids.join(','))}`); if (r.ok) return await r.json(); } catch {}
    }
    const g = localStore()[game] || { all: {} }; const out = {};
    for (const id of ids) if (g.all[id]) out[id] = g.all[id].pts;
    return out;
  },
  /** small key/value documents (e.g. the horse stable) */
  async getDoc(name) {
    if (this.base) { try { const r = await fetch(`${this.base}/api/doc/${name}`); if (r.ok) return await r.json(); } catch {} }
    try { return JSON.parse(localStorage.getItem('lbl.doc.' + name) || 'null'); } catch { return null; }
  },
  async putDoc(name, data) {
    try { localStorage.setItem('lbl.doc.' + name, JSON.stringify(data)); } catch {}
    if (this.base) { try { await fetch(`${this.base}/api/doc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); } catch {} }
  },
};

window.LBLShared = { cleanName, isBad, titleFor, scores, isoWeek };
})();
