import { textGrid } from './font.js';
import { piercing, frozen, wrapping } from './sim.js';
import { PALETTES } from './config.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (w <= 0 || h <= 0) return;   // degenerate at tiny brick sizes; draw nothing
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draw text with the same 5x7 font the bricks use, so the HUD matches the mosaic. */
export function pixelText(ctx, lines, { cx, y, cell, gap = 2, color = '#fff', alpha = 1 }) {
  const g = textGrid(lines);
  const w = g.w * (cell + gap) - gap;
  const x0 = cx - w / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let r = 0; r < g.h; r++)
    for (let c = 0; c < g.w; c++)
      if (g.cells[r][c]) ctx.fillRect(x0 + c * (cell + gap), y + r * (cell + gap), cell, cell);
  ctx.restore();
  return { w, h: g.h * (cell + gap) - gap };
}

function drawBackground(ctx, cfg, state, fx) {
  const { width: W, height: H, field } = cfg;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, cfg.bg);
  g.addColorStop(0.55, '#0D1228');
  g.addColorStop(1, '#06070F');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Warm glow behind the mosaic that fades as the bricks come down.
  const alive = state.total - state.destroyed;
  const heat = 0.16 + 0.34 * (alive / state.total) + fx.clearGlow * 0.5;
  const gy = state.layout.y0 + (state.layout.grid.h * (state.layout.ch + state.layout.gap)) / 2;
  const rg = ctx.createRadialGradient(W / 2, gy, 40, W / 2, gy, 900);
  rg.addColorStop(0, `rgba(120,110,255,${heat.toFixed(3)})`);
  rg.addColorStop(1, 'rgba(120,110,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
}

function drawField(ctx, cfg) {
  if (!cfg.showChrome) return;
  const { field } = cfg;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 2;
  roundRect(ctx, field.x, field.y, field.w, field.h, 18);
  ctx.stroke();
  ctx.restore();
}

function drawHud(ctx, cfg, state, fx) {
  const { width: W, height: H } = cfg;
  const k = cfg.scale ?? 1;
  const pct = state.destroyed / state.total;

  if (cfg.caption)
    pixelText(ctx, cfg.caption, { cx: W / 2, y: 12 * k, cell: 6 * k, gap: 2 * k, color: '#FFFFFF', alpha: 0.32 });

  // The mosaic now runs to the top edge, so the readout lives along the bottom.
  const barH = Math.max(3, Math.round(5 * k));
  const by = H - barH;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, by, W, barH);

  const colors = PALETTES[cfg.palette] ?? PALETTES.sunset;
  const lg = ctx.createLinearGradient(0, 0, W, 0);
  colors.forEach((c, i) => lg.addColorStop(i / (colors.length - 1), c));
  ctx.fillStyle = lg;
  ctx.fillRect(0, by, W * pct, barH);

  if (cfg.watermark)
    pixelText(ctx, [cfg.watermark], { cx: W / 2, y: by - Math.round(46 * k), cell: 4 * k, gap: 1 * k, color: '#FFFFFF', alpha: 0.22 });
}

/** Arrows on a moving piece, so it is obvious which cells travel and along what. */
function drawAxisMark(ctx, b, color) {
  if (!b.axis) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const a = Math.min(b.w, b.h) * 0.19;      // arrow half-height
  const reach = (b.axis === 'h' ? b.w : b.h) * 0.40;
  ctx.save();
  ctx.fillStyle = color;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    if (b.axis === 'h') {
      ctx.moveTo(cx + sign * reach, cy);
      ctx.lineTo(cx + sign * (reach - a * 1.5), cy - a);
      ctx.lineTo(cx + sign * (reach - a * 1.5), cy + a);
    } else {
      ctx.moveTo(cx, cy + sign * reach);
      ctx.lineTo(cx - a, cy + sign * (reach - a * 1.5));
      ctx.lineTo(cx + a, cy + sign * (reach - a * 1.5));
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Obstacles read as heavy machined blocks so nobody waits for them to break. */
function drawSolid(ctx, b, scale) {
  const r = Math.min(9 * scale, b.h * 0.26);
  ctx.fillStyle = b.color;
  roundRect(ctx, b.x, b.y, b.w, b.h, r); ctx.fill();

  ctx.save();
  roundRect(ctx, b.x, b.y, b.w, b.h, r); ctx.clip();
  ctx.strokeStyle = 'rgba(190,210,255,0.17)';
  ctx.lineWidth = 3 * scale;
  for (let x = b.x - b.h; x < b.x + b.w; x += 15 * scale) {
    ctx.beginPath(); ctx.moveTo(x, b.y + b.h); ctx.lineTo(x + b.h, b.y); ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(200,218,255,0.62)';
  ctx.lineWidth = 2 * scale;
  roundRect(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, r); ctx.stroke();

  drawAxisMark(ctx, b, 'rgba(210,226,255,0.72)');
}

/** A cold wash over anything that would be moving, while freeze is running. */
function frostOver(ctx, state) {
  if (!frozen(state)) return;
  const col = state.cfg.drops.colors.freeze;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.22;
  for (const b of state.bricks) {
    if (!b.alive || !b.axis) continue;
    ctx.fillStyle = col;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  ctx.restore();
}

/** While wrapping, the field edges glow: they are doorways, not walls. */
function drawWrapEdges(ctx, cfg, state) {
  if (!wrapping(state)) return;
  const { field } = cfg, col = cfg.drops.colors.wrap;
  const band = Math.max(5, 11 * (cfg.scale ?? 1));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const strip = (x, y, w, h, x2, y2) => {
    const g = ctx.createLinearGradient(x, y, x2, y2);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  strip(field.x, field.y, band, field.h, field.x + band, field.y);
  strip(field.x + field.w - band, field.y, band, field.h, field.x + field.w - band * 2, field.y);
  strip(field.x, field.y, field.w, band, field.x, field.y + band);
  strip(field.x, field.y + field.h - band, field.w, band, field.x, field.y + field.h - band * 2);
  ctx.restore();
}

function drawBricks(ctx, state) {
  const scale = state.cfg.scale ?? 1;
  for (const b of state.bricks) {
    if (!b.alive) continue;
    if (b.solid) { drawSolid(ctx, b, scale); continue; }
    ctx.fillStyle = b.color;
    roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(6, b.h * 0.28));
    ctx.fill();
    // Top highlight gives the flat mosaic a bit of dimension. Insets are a
    // fraction of the brick, so they survive any density/scale combination.
    const inset = Math.min(2 * scale, b.w * 0.12);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, b.x + inset, b.y + inset * 0.75, b.w - inset * 2, b.h * 0.24, 2 * scale);
    ctx.fill();

    drawAxisMark(ctx, b, 'rgba(10,12,24,0.55)');
  }
}

// Icons are drawn knocked out of the capsule, so a drop reads at a glance.
const DROP_ICON = {
  split(ctx, d) {
    const r = d.h * 0.22;
    ctx.beginPath(); ctx.arc(d.x - r * 1.6, d.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(d.x + r * 1.6, d.y, r, 0, Math.PI * 2); ctx.fill();
  },
  triple(ctx, d) {
    const r = d.h * 0.18;
    for (const off of [-2.6, 0, 2.6]) {
      ctx.beginPath(); ctx.arc(d.x + off * r, d.y, r, 0, Math.PI * 2); ctx.fill();
    }
  },
  wide(ctx, d) {                      // a bar reaching for both ends
    const w = d.w * 0.30, t = d.h * 0.16;
    ctx.fillRect(d.x - w, d.y - t / 2, w * 2, t);
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(d.x + sign * (w + t * 1.5), d.y);
      ctx.lineTo(d.x + sign * w, d.y - t * 1.6);
      ctx.lineTo(d.x + sign * w, d.y + t * 1.6);
      ctx.closePath(); ctx.fill();
    }
  },
  freeze(ctx, d) {                    // a pause: everything stands still
    const w = d.h * 0.13, h = d.h * 0.46;
    ctx.fillRect(d.x - w * 2.1, d.y - h / 2, w, h);
    ctx.fillRect(d.x + w * 1.1, d.y - h / 2, w, h);
  },
  wrap(ctx, d) {                      // out one side, in at the other
    const w = d.h * 0.24, h = d.h * 0.2;
    for (const cx of [d.x - d.w * 0.16, d.x + d.w * 0.16]) {
      ctx.beginPath();
      ctx.moveTo(cx + w, d.y);
      ctx.lineTo(cx - w * 0.6, d.y - h);
      ctx.lineTo(cx - w * 0.6, d.y + h);
      ctx.closePath(); ctx.fill();
    }
  },
  pierce(ctx, d) {
    const w = d.h * 0.34, h = d.h * 0.19;
    for (const off of [-h * 1.25, h * 1.25]) {
      ctx.beginPath();
      ctx.moveTo(d.x - w, d.y + off - h);
      ctx.lineTo(d.x, d.y + off + h);
      ctx.lineTo(d.x + w, d.y + off - h);
      ctx.closePath(); ctx.fill();
    }
  },
};

function drawDrops(ctx, state) {
  const scale = state.cfg.scale ?? 1;
  const { colors } = state.cfg.drops;
  for (const d of state.drops) {
    const col = colors[d.kind] ?? '#FFFFFF';
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 24 * scale;
    ctx.fillStyle = col;
    roundRect(ctx, d.x - d.w / 2, d.y - d.h / 2, d.w, d.h, d.h / 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(8,10,20,0.88)';
    (DROP_ICON[d.kind] ?? (() => {}))(ctx, d);
  }
}

function drawParticles(ctx, fx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of fx.parts) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    const s = p.size * (0.4 + p.life * 0.6);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  ctx.restore();
}

function ballTint(cfg, b) {
  const colors = PALETTES[cfg.palette] ?? PALETTES.sunset;
  return colors[b.tint % colors.length];
}

function drawTrails(ctx, state, fx) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of state.balls) {
    const t = fx.trails.get(b.id);
    if (!t || t.length < 2) continue;
    const jump = Math.min(state.cfg.field.w, state.cfg.field.h) * 0.5;
    for (let i = 1; i < t.length; i++) {
      // A wrap puts two consecutive samples on opposite edges; joining them
      // would draw a streak straight across the screen.
      if (Math.hypot(t[i].x - t[i - 1].x, t[i].y - t[i - 1].y) > jump) continue;
      const k = 1 - i / t.length;
      ctx.globalAlpha = k * k * 0.75;
      ctx.lineWidth = b.r * 1.9 * k;
      ctx.strokeStyle = piercing(state) ? state.cfg.drops.colors.pierce : ballTint(state.cfg, b);
      ctx.beginPath();
      ctx.moveTo(t[i - 1].x, t[i - 1].y);
      ctx.lineTo(t[i].x, t[i].y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBalls(ctx, state) {
  const hot = piercing(state);
  const scale = state.cfg.scale ?? 1;
  for (const b of state.balls) {
    if (hot) {
      ctx.save();
      ctx.strokeStyle = state.cfg.drops.colors.pierce;
      ctx.lineWidth = 2.5 * scale;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.85, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = hot ? state.cfg.drops.colors.pierce : ballTint(state.cfg, b);
    ctx.shadowBlur = 38;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(b.x - b.r * 0.28, b.y - b.r * 0.28, b.r * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawPaddle(ctx, state) {
  const p = state.paddle;
  ctx.save();
  ctx.shadowColor = 'rgba(120,170,255,0.8)';
  ctx.shadowBlur = 30;
  const lg = ctx.createLinearGradient(p.x - p.w / 2, 0, p.x + p.w / 2, 0);
  lg.addColorStop(0, '#7CC5FF'); lg.addColorStop(0.5, '#FFFFFF'); lg.addColorStop(1, '#8B7BF5');
  ctx.fillStyle = lg;
  roundRect(ctx, p.x - p.w / 2, p.y, p.w, p.h, p.h / 2);
  ctx.fill();
  ctx.restore();
}

function drawFloor(ctx, cfg) {
  if (!cfg.showChrome) return;
  const { field } = cfg;
  const y = field.y + field.h;
  const lg = ctx.createLinearGradient(field.x, 0, field.x + field.w, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(0.5, 'rgba(255,255,255,0.38)');
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(field.x, y - 2, field.w, 3);
}

/** The closing frame: the field dims and WIN comes up, then the file ends. */
function drawWinCard(ctx, cfg, state) {
  if (!state.cleared) return;
  const k = Math.min(1, (state.t - state.clearedAt) / 0.45);
  if (k <= 0) return;
  const ease = 1 - Math.pow(1 - k, 3);
  const { width: W, height: H } = cfg;
  const s = cfg.scale ?? 1;

  ctx.fillStyle = `rgba(6,8,16,${(0.66 * ease).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);

  const cell = Math.max(4, Math.round(30 * s * (0.84 + 0.16 * ease)));
  const gap = Math.max(2, Math.round(cell * 0.3));
  const h = 7 * (cell + gap) - gap;

  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 48 * s * ease;
  pixelText(ctx, ['WIN'], { cx: W / 2, y: (H - h) / 2, cell, gap, color: '#FFFFFF', alpha: ease });
  ctx.restore();

  // a palette rule under the word, drawn in as it settles
  const rw = W * 0.30 * ease, ry = (H + h) / 2 + Math.round(34 * s);
  const colors = PALETTES[cfg.palette] ?? PALETTES.sunset;
  const lg = ctx.createLinearGradient(W / 2 - rw / 2, 0, W / 2 + rw / 2, 0);
  colors.forEach((c, i) => lg.addColorStop(i / (colors.length - 1), c));
  ctx.globalAlpha = ease;
  ctx.fillStyle = lg;
  ctx.fillRect(W / 2 - rw / 2, ry, rw, Math.max(2, Math.round(4 * s)));
  ctx.globalAlpha = 1;
}

function drawVignette(ctx, cfg) {
  const { width: W, height: H } = cfg;
  const rg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
}

export function draw(ctx, state, fx) {
  const cfg = state.cfg;
  const { width: W, height: H } = cfg;

  drawBackground(ctx, cfg, state, fx);

  ctx.save();
  if (fx.shake > 0.05) {
    // Deterministic wobble: driven by sim time, not a random source.
    ctx.translate(Math.sin(state.t * 71) * fx.shake, Math.cos(state.t * 87) * fx.shake * 0.7);
  }

  drawField(ctx, cfg);
  drawFloor(ctx, cfg);
  drawHud(ctx, cfg, state, fx);
  drawBricks(ctx, state);
  drawTrails(ctx, state, fx);
  drawDrops(ctx, state);
  drawParticles(ctx, fx);
  frostOver(ctx, state);
  drawWrapEdges(ctx, cfg, state);
  drawPaddle(ctx, state);
  drawBalls(ctx, state);

  ctx.restore();

  if (fx.flash > 0.004) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${(fx.flash * 0.30).toFixed(4)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  drawWinCard(ctx, cfg, state);
  drawVignette(ctx, cfg);
}
