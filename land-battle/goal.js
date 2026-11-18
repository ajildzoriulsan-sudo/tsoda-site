/* Donation goal bar shared by every game (and goal.html).
 * The bridge counts gifts (so nothing is counted twice) and pushes {type:'goal'} over the
 * WebSocket; pages also poll /api/goal. Exposes window.LBLGoal.
 */
(() => {
'use strict';
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Noto Sans", sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now() / 1000;
const fmtN = (n) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const imgs = new Map();
function avatar(url) {
  if (!url) return null;
  let r = imgs.get(url);
  if (!r) { r = { img: new Image(), ok: false }; r.img.referrerPolicy = 'no-referrer'; r.img.onload = () => { r.ok = true; }; r.img.src = url; imgs.set(url, r); }
  return r.ok ? r.img : null;
}

const goal = {
  data: null, base: '', shown: 0, flashT: -9, pops: [], listeners: [],
  get active() { return !!(this.data && this.data.config && this.data.config.enabled); },
  get frac() { return this.data ? clamp(this.data.total / Math.max(1, this.data.config.target), 0, 1) : 0; },

  update(g) {
    if (!g || !g.config) return;
    const prev = this.data;
    if (prev && g.total > prev.total) {
      this.flashT = now();
      const r = g.recent && g.recent[0];
      this.pops.push({ text: `+${fmtN(g.total - prev.total)} 💎`, name: r ? r.name : '', avatar: r ? r.avatar : '', t: now() });
      if (this.pops.length > 4) this.pops.shift();
      // milestone every 25 %
      const m0 = Math.floor(prev.total / prev.config.target * 4), m1 = Math.floor(g.total / g.config.target * 4);
      if (m1 > m0) this.listeners.forEach(fn => fn({ type: 'milestone', pct: Math.min(100, m1 * 25), goal: g }));
      this.listeners.forEach(fn => fn({ type: 'donation', recent: r, goal: g }));
    }
    if (!prev) this.shown = g.total;
    this.data = g;
  },
  on(fn) { this.listeners.push(fn); },
  start(base) {
    this.base = base || '';
    if (!this.base) return;
    const poll = () => fetch(`${this.base}/api/goal`).then(r => r.ok ? r.json() : null).then(g => g && this.update(g)).catch(() => {});
    poll(); clearInterval(this.timer); this.timer = setInterval(poll, 10000);
  },

  /** Draw the compact bar into a 2D context (logical units). */
  draw(ctx, x, y, w, h) {
    if (!this.data) return;
    const g = this.data, c = g.config, t = now();
    this.shown += (g.total - this.shown) * 0.08;
    const frac = clamp(this.shown / Math.max(1, c.target), 0, 1);
    const flash = clamp(1 - (t - this.flashT) / 1.2, 0, 1);
    const rr = (X, Y, W, H, R) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(X, Y, W, H, R) : ctx.rect(X, Y, W, H); };
    const txt = (s, X, Y, size, col, align = 'left', weight = 800, stroke = 0) => {
      ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
      if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(10,5,25,.85)'; ctx.strokeText(s, X, Y); }
      ctx.fillStyle = col; ctx.fillText(s, X, Y);
    };
    const fit = (s, maxW, size, weight = 800) => { ctx.font = `${weight} ${size}px ${FONT}`; if (ctx.measureText(s).width <= maxW) return s; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; };
    ctx.save();
    // card
    rr(x, y, w, h, 20); ctx.fillStyle = 'rgba(12,8,30,.82)'; ctx.fill();
    ctx.lineWidth = 3 + flash * 3; ctx.strokeStyle = `rgba(255,209,102,${0.55 + 0.45 * flash})`; ctx.stroke();
    // title
    txt(fit(`🐑 ${c.title}`, w - 260, 24, 900), x + 18, y + 22, 24, '#ffd166', 'left', 900);
    txt(`${fmtN(g.total)} / ${fmtN(c.target)} 💎`, x + w - 16, y + 22, 22, '#fff', 'right', 900);
    // bar
    const bx = x + 16, by = y + 40, bw = w - 32, bh = h - 52;
    rr(bx, by, bw, bh, bh / 2); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
    if (frac > 0) {
      const gr = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      gr.addColorStop(0, '#ff8a3d'); gr.addColorStop(0.5, '#ffd166'); gr.addColorStop(1, '#6dffb0');
      rr(bx, by, Math.max(bh, bw * frac), bh, bh / 2); ctx.fillStyle = gr; ctx.fill();
      // moving shine
      ctx.save(); rr(bx, by, Math.max(bh, bw * frac), bh, bh / 2); ctx.clip();
      const sx = bx + ((t * 260) % (bw + 200)) - 100;
      const sh = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
      sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.45)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh; ctx.fillRect(sx - 60, by, 120, bh); ctx.restore();
    }
    // 25 % ticks
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    for (let k = 1; k < 4; k++) ctx.fillRect(bx + bw * k / 4 - 1, by + 3, 2, bh - 6);
    txt(`${Math.floor(frac * 100)}% · ${g.count} дэмжигч`, bx + 14, by + bh / 2 + 1, Math.min(18, bh - 6), '#fff', 'left', 900, 4);
    ctx.restore();
    // floating "+N 💎 name"
    for (const p of this.pops) {
      const age = t - p.t; if (age > 2.4) continue;
      const a = clamp(Math.min(age / 0.2, (2.4 - age) / 0.5), 0, 1);
      ctx.save(); ctx.globalAlpha = a;
      const py = y + 40 + (h - 52) / 2, label = fit(`${p.name ? p.name + ' ' : ''}${p.text}`, 360, 20);
      ctx.font = `900 20px ${FONT}`; const lw = ctx.measureText(label).width + 50, px = x + w - lw - 20 - age * 10;
      rr(px, py - 16, lw, 32, 16); ctx.fillStyle = 'rgba(255,209,102,.95)'; ctx.fill();
      const im = avatar(p.avatar);
      ctx.beginPath(); ctx.arc(px + 18, py, 12, 0, TAU); ctx.fillStyle = '#7b3fe4'; ctx.fill();
      if (im) { ctx.save(); ctx.beginPath(); ctx.arc(px + 18, py, 11, 0, TAU); ctx.clip(); ctx.drawImage(im, px + 7, py - 11, 22, 22); ctx.restore(); }
      txt(label, px + 36, py + 1, 20, '#1a0f33', 'left', 900);
      ctx.restore();
    }
    this.pops = this.pops.filter(p => t - p.t < 2.4);
  },
};
window.LBLGoal = goal;
})();
