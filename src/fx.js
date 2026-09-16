import { mulberry32 } from './sim.js';

/** Purely cosmetic state: trails, debris, shake, flash. Seeded, so still deterministic. */
export function createFx(seed) {
  return { rng: mulberry32(seed ^ 0x9E3779B9), trails: new Map(), parts: [], shake: 0, flash: 0, clearGlow: 0 };
}

const TRAIL_LEN = 16;

function burst(fx, x, y, color, n, power, S = 1) {
  for (let i = 0; i < n; i++) {
    const a = fx.rng() * Math.PI * 2, s = (0.35 + fx.rng() * 0.65) * power * S;
    fx.parts.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - power * S * 0.25,
      life: 1, decay: 0.9 + fx.rng() * 1.5, size: (3 + fx.rng() * 7) * S,
      rot: fx.rng() * Math.PI, spin: (fx.rng() - 0.5) * 12, color,
    });
  }
}

export function updateFx(fx, state, events, dt) {
  const S = state.cfg.scale ?? 1;
  const k = (state.cfg.shake ?? 1) * S;
  const bump = (amount, cap) => { fx.shake = Math.min(cap * k, fx.shake + amount * k); };
  for (const e of events) {
    if (e.type === 'brick') {
      burst(fx, e.x, e.y, e.brick.color, 9, 340, S);
      bump(3.2, 14);
      fx.flash = Math.min(1, fx.flash + 0.16);
    } else if (e.type === 'paddle') {
      burst(fx, e.x, e.y, '#FFFFFF', 5, 200, S);
      bump(2.0, 14);
    } else if (e.type === 'solid') {
      // Struck metal: a few cold sparks, no colour, no flash.
      burst(fx, e.x, e.y, '#AFC4FF', 6, 260, S);
      bump(2.6, 14);
    } else if (e.type === 'pickup') {
      const col = state.cfg.drops.colors[e.kind] ?? '#FFFFFF';
      burst(fx, e.x, e.y, col, 26, 420, S);
      bump(6, 18);
      fx.flash = Math.min(1, fx.flash + 0.35);
    } else if (e.type === 'split') {
      burst(fx, e.x, e.y, '#FFFFFF', 22, 460, S);
      bump(7, 18);
      fx.flash = Math.min(1, fx.flash + 0.4);
    } else if (e.type === 'clear') {
      burst(fx, e.x, e.y, '#FFFFFF', 90, 900, S);
      fx.shake = 24 * k; fx.flash = 1; fx.clearGlow = 1;
    } else if (e.type === 'lost') {
      // A dim fizzle downward, so a miss reads as a loss and not as a hit.
      burst(fx, e.x, e.y, '#6E7BA8', 14, 210, S);
    } else if (e.type === 'wall' || e.type === 'floor') {
      bump(1.1, 14);
    }
  }

  // Trails follow live balls; drop the entry when a ball disappears.
  const live = new Set(state.balls.map((b) => b.id));
  for (const id of fx.trails.keys()) if (!live.has(id)) fx.trails.delete(id);
  for (const b of state.balls) {
    let t = fx.trails.get(b.id);
    if (!t) fx.trails.set(b.id, (t = []));
    t.unshift({ x: b.x, y: b.y });
    if (t.length > TRAIL_LEN) t.length = TRAIL_LEN;
  }

  for (const p of fx.parts) {
    p.life -= p.decay * dt;
    p.vy += 1400 * S * dt;      // debris falls
    p.vx *= 1 - 1.4 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }
  fx.parts = fx.parts.filter((p) => p.life > 0);
  if (fx.parts.length > 900) fx.parts.length = 900;

  fx.shake *= Math.pow(0.02, dt);
  fx.flash *= Math.pow(0.008, dt);
  fx.clearGlow *= Math.pow(0.25, dt);
  return fx;
}
