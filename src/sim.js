import { buildLevel } from './level.js';
import { makeObstacles } from './obstacles.js';

/** Deterministic PRNG. Same seed -> same run, always. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextBallId = 1;
function makeBall(cfg, x, y, angle, speed) {
  const id = nextBallId++;
  // tint is cosmetic, but it is derived here so a run always looks identical.
  return { id, tint: id - 1, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: cfg.ball.r, speed };
}

export function createState(cfg) {
  const rng = mulberry32(cfg.seed);
  nextBallId = 1; // ids must not leak between runs, or --scan and --render diverge
  const { bricks, solids: walls, layout, gaps, groups, mapRows } = buildLevel(cfg, rng);
  const { field } = cfg;
  const paddleY = cfg.paddleRow * cfg.cell;
  const paddleW = cfg.paddle.cols * cfg.cell;
  const solids = [...walls, ...makeObstacles(cfg, rng)];
  const cx = field.x + field.w / 2, cy = paddleY - cfg.ball.r - 2;

  const balls = [];
  for (let i = 0; i < cfg.ball.startCount; i++) {
    const angle = -Math.PI / 2 + (rng() - 0.5) * 1.3;
    balls.push(makeBall(cfg, cx + (i - (cfg.ball.startCount - 1) / 2) * 40, cy, angle, cfg.ball.speed));
  }

  return {
    cfg, rng, t: 0,
    over: false, missed: false, cleared: false, clearedAt: null,
    destroyed: 0,
    total: bricks.length,          // destructible only; solids never count
    bricks: [...bricks, ...solids],
    drops: [],
    // Each timed effect is just a deadline on the clock.
    pierceUntil: -1, wideUntil: -1, freezeUntil: -1, wrapUntil: -1,
    paddleBaseW: paddleW,
    splitsLeft: [...cfg.ball.splitAt],
    balls, layout, gaps, groups, mapRows,
    solidCells: new Set(solids.map((b) => b.row * 4096 + b.col)),
    aim: null, aimAge: 0,
    paddle: { x: cx, y: paddleY, w: paddleW, h: cfg.paddle.h },
    phase: rng() * Math.PI * 2, // per-seed personality for the paddle's weaving
  };
}

/** Where will this ball cross the paddle line? Folds wall bounces analytically. */
function predict(state, ball, targetY) {
  const { field } = state.cfg;
  if (ball.vy <= 0) return null;
  const tti = (targetY - ball.y) / ball.vy;
  if (tti < 0) return null;
  const lo = field.x + ball.r, hi = field.x + field.w - ball.r, span = hi - lo;
  let p = (ball.x + ball.vx * tti) - lo;
  p = ((p % (2 * span)) + 2 * span) % (2 * span);
  if (p > span) p = 2 * span - p;
  return { x: lo + p, tti };
}

// --- moving groups -------------------------------------------------------
// Adjacent movers travel as one body. A group advances a whole cell at a time:
// while it is mid-cell nothing can be in its way, and the check happens only at
// the moment it is grid-aligned. That keeps "reverse on contact" exact -- a
// group never overlaps what it bounced off.

function occupancy(state) {
  const m = new Map();
  for (const b of state.bricks) if (b.alive) m.set(b.row * 4096 + b.col, b);
  return m;
}

function canStep(state, occ, g) {
  const dr = g.axis === 'v' ? g.dir : 0;
  const dc = g.axis === 'h' ? g.dir : 0;
  const mine = new Set(g.members.map((m) => m.row * 4096 + m.col));
  for (const m of g.members) {
    const r = m.row + dr, c = m.col + dc;
    if (c < 0 || c >= state.cfg.cols) return false;      // side walls
    if (r < 0 || r >= state.mapRows) return false;       // top, and the paddle clearance
    const k = r * 4096 + c;
    if (!mine.has(k) && occ.has(k)) return false;        // another piece is there
  }
  return true;
}

function placeGroup(state, g) {
  const { cell, brickGap } = state.cfg;
  const half = brickGap / 2;
  for (const m of g.members) {
    m.x = m.col * cell + half + (g.axis === 'h' ? g.dir * g.off : 0);
    m.y = m.row * cell + half + (g.axis === 'v' ? g.dir * g.off : 0);
  }
}

function stepGroups(state, dt) {
  if (!state.groups.length || frozen(state)) return;
  const occ = occupancy(state);
  const { cell } = state.cfg;
  for (const g of state.groups) {
    if (!g.members.length) continue;
    if (g.off === 0 && !canStep(state, occ, g)) {
      g.dir = -g.dir;
      if (!canStep(state, occ, g)) { placeGroup(state, g); continue; }   // boxed in on both sides
    }
    g.off += state.cfg.moveSpeed * dt;
    if (g.off >= cell) {
      const dr = g.axis === 'v' ? g.dir : 0, dc = g.axis === 'h' ? g.dir : 0;
      for (const m of g.members) { m.row += dr; m.col += dc; }
      g.off = 0;
    }
    placeGroup(state, g);
  }
}

/** Breaking a brick can cut a group in two; the halves carry on independently. */
function leaveGroup(state, brick) {
  const g = brick.group;
  if (!g) return;
  brick.group = null;
  g.members = g.members.filter((m) => m !== brick);
  if (!g.members.length) { state.groups = state.groups.filter((x) => x !== g); return; }

  const pool = new Map(g.members.map((m) => [m.row * 4096 + m.col, m]));
  const seen = new Set();
  const comps = [];
  for (const [key] of pool) {
    if (seen.has(key)) continue;
    const comp = [], stack = [key];
    seen.add(key);
    while (stack.length) {
      const k = stack.pop(), p = pool.get(k);
      comp.push(p);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nk = (p.row + dr) * 4096 + (p.col + dc);
        if (pool.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    comps.push(comp);
  }
  if (comps.length === 1) { g.members = comps[0]; return; }

  state.groups = state.groups.filter((x) => x !== g);
  for (const comp of comps) {
    const ng = { axis: g.axis, dir: g.dir, off: g.off, members: comp };
    for (const m of comp) m.group = ng;
    state.groups.push(ng);
  }
}

/** Is the straight line from a to b interrupted by an indestructible cell? */
function blocked(state, x0, y0, x1, y1) {
  const { cell } = state.cfg;
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (cell * 0.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const c = Math.floor((x0 + (x1 - x0) * t) / cell);
    const r = Math.floor((y0 + (y1 - y0) * t) / cell);
    if (state.solidCells.has(r * 4096 + c)) return true;
  }
  return false;
}

/**
 * Choose the contact offset to return the ball on. The exit angle depends only on
 * where the ball meets the paddle, so the paddle can genuinely aim.
 *
 * Preference order: a brick it has a clear shot at, else a doorway that leads
 * inside, else nothing (the caller falls back to weaving). Aiming only at
 * doorways is not enough -- once the vault is nearly empty the ball has to be
 * pointed at the last brick, not at a hole.
 */
function aimOffset(state, landing) {
  const py = state.paddle.y;
  const REL_MAX = 0.88;                       // beyond this the paddle cannot make the shot
  const relTo = (x, y) => (Math.atan2(y - py, x - landing.x) + Math.PI / 2) / (Math.PI / 3);

  const shots = [];
  for (const b of state.bricks) {
    if (!b.alive || b.solid) continue;
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    if (y >= py) continue;
    const rel = relTo(x, y);
    if (Math.abs(rel) > REL_MAX) continue;
    shots.push({ x, y, rel, d: Math.hypot(x - landing.x, y - py) });
  }
  shots.sort((a, b) => a.d - b.d);
  for (const sh of shots.slice(0, 24))        // raycast only the nearest handful
    if (!blocked(state, landing.x, py, sh.x, sh.y)) return sh.rel;

  let door = null;
  for (const g of state.gaps) {
    if (g.y >= py) continue;
    const rel = relTo(g.x, g.y);
    if (Math.abs(rel) > REL_MAX) continue;
    const d = Math.hypot(g.x - landing.x, g.y - py);
    if ((!door || d < door.d) && !blocked(state, landing.x, py, g.x, g.y)) door = { rel, d };
  }
  return door ? door.rel : null;
}

function movePaddle(state, dt) {
  const { cfg, paddle } = state, { field } = cfg;
  paddle.w = state.paddleBaseW * (widened(state) ? cfg.paddle.wideFactor : 1);
  const half = paddle.w / 2;

  // Commit to whichever ball lands soonest; the rest are the floor's problem.
  let best = null;
  for (const b of state.balls) {
    const p = predict(state, b, paddle.y - b.r);
    if (p && (!best || p.tti < best.tti)) best = p;
  }

  let target;
  if (!best) {
    target = field.x + field.w / 2 + Math.sin(state.t * 1.3 + state.phase) * field.w * 0.18;
  } else {
    // Recomputing every frame is wasted work; the approach lasts far longer.
    if (state.aimAge-- <= 0) { state.aim = aimOffset(state, best); state.aimAge = 6; }
    if (state.aim !== null) {
      // Send it at the chosen target, with just enough wobble to look human.
      const wobble = Math.sin(state.t * 2.7 + state.phase) * 0.14 * cfg.paddle.sloppiness;
      target = best.x - (state.aim + wobble) * half;
    } else {
      // Aim off-centre early for drama, then commit to an edge save at the last moment.
      const drama = Math.sin(state.t * 2.7 + state.phase);
      const lateness = Math.min(1, best.tti / 0.45);
      target = best.x + drama * half * 0.42 * (cfg.paddle.sloppiness * lateness + (1 - lateness) * 0.62);
    }
  }

  // Detour for a falling pickup only when no ball needs the paddle sooner.
  // Widening this margin when only one ball is left measures WORSE: skipping
  // pickups means skipping splits, so the run stays on one ball and loses it.
  let drop = null;
  for (const d of state.drops) {
    const tti = (paddle.y - d.y) / cfg.drops.speed;
    if (tti >= 0 && (!drop || tti < drop.tti)) drop = { x: d.x, tti };
  }
  if (drop && (!best || drop.tti < best.tti - 0.15)) target = drop.x;

  target = Math.max(field.x + half, Math.min(field.x + field.w - half, target));
  const max = cfg.paddle.speed * dt;
  paddle.x += Math.max(-max, Math.min(max, target - paddle.x));
}

function reflectOffPaddle(state, ball, events) {
  const { paddle } = state;
  // Classic breakout: contact point on the paddle sets the exit angle.
  const rel = Math.max(-1, Math.min(1, (ball.x - paddle.x) / (paddle.w / 2)));
  const angle = -Math.PI / 2 + rel * (Math.PI / 3);
  ball.y = paddle.y - ball.r - 0.01;
  ball.vx = Math.cos(angle) * ball.speed;
  ball.vy = Math.sin(angle) * ball.speed;
  events.push({ type: 'paddle', x: ball.x, y: paddle.y, rel });
}

/** Fan a new ball off an existing one; `nth` widens the fan for a triple. */
function splitBall(state, ball, events, nth = 0) {
  const a = Math.atan2(ball.vy, ball.vx), spread = 0.5 + nth * 0.45;
  if (nth === 0) {
    ball.vx = Math.cos(a - spread) * ball.speed;
    ball.vy = Math.sin(a - spread) * ball.speed;
  }
  state.balls.push(makeBall(state.cfg, ball.x, ball.y, a + spread, ball.speed));
  events.push({ type: 'split', x: ball.x, y: ball.y });
}

/** Safety-net splits on a fixed schedule, so a run always converges. */
function maybeSplit(state, ball, events) {
  const frac = 1 - state.destroyed / state.total;
  if (!state.splitsLeft.length || frac > state.splitsLeft[0]) return;
  state.splitsLeft.shift();
  if (state.balls.length >= state.cfg.ball.maxCount) return;
  splitBall(state, ball, events);
}

const DROP_KINDS = ['split', 'triple', 'pierce', 'wide', 'freeze', 'wrap'];

function pickKind(cfg, rng) {
  const w = cfg.drops.weights;
  let total = 0;
  for (const k of DROP_KINDS) total += w[k] ?? 0;
  let r = rng() * total;
  for (const k of DROP_KINDS) { r -= w[k] ?? 0; if (r <= 0) return k; }
  return DROP_KINDS[0];
}

function applyDrop(state, d, events) {
  const { cfg } = state;
  const until = (k) => state.t + cfg.drops.duration[k];
  events.push({ type: 'pickup', kind: d.kind, x: d.x, y: d.y });

  if (d.kind === 'split' || d.kind === 'triple') {
    // Every ball in play divides, up to the cap.
    const extra = d.kind === 'triple' ? 2 : 1;
    for (const b of [...state.balls]) {
      for (let i = 0; i < extra; i++) {
        if (state.balls.length >= cfg.ball.maxCount) break;
        splitBall(state, b, events, i);
      }
    }
  } else if (d.kind === 'pierce') state.pierceUntil = until('pierce');
  else if (d.kind === 'wide')     state.wideUntil   = until('wide');
  else if (d.kind === 'freeze')   state.freezeUntil = until('freeze');
  else if (d.kind === 'wrap')     state.wrapUntil   = until('wrap');
}

function updateDrops(state, dt, events) {
  const { cfg, paddle: p } = state, { field } = cfg;
  const floor = field.y + field.h;
  const keep = [];
  for (const d of state.drops) {
    d.y += cfg.drops.speed * dt;
    const onPaddle = d.y + d.h / 2 >= p.y && d.y - d.h / 2 <= p.y + p.h &&
                     d.x >= p.x - p.w / 2 - d.w / 2 && d.x <= p.x + p.w / 2 + d.w / 2;
    if (onPaddle) { applyDrop(state, d, events); continue; }
    if (d.y - d.h / 2 > floor) { events.push({ type: 'dropmiss', x: d.x, y: floor }); continue; }
    keep.push(d);
  }
  state.drops = keep;
}

export const piercing = (state) => state.t < state.pierceUntil;
export const widened  = (state) => state.t < state.wideUntil;
export const frozen   = (state) => state.t < state.freezeUntil;
export const wrapping = (state) => state.t < state.wrapUntil;

/** Effects that are running, with how much of each is left, for the HUD. */
export function activeEffects(state) {
  const d = state.cfg.drops.duration;
  return [
    ['pierce', state.pierceUntil, d.pierce],
    ['wide', state.wideUntil, d.wide],
    ['freeze', state.freezeUntil, d.freeze],
    ['wrap', state.wrapUntil, d.wrap],
  ].filter(([, until]) => state.t < until)
   .map(([kind, until, span]) => ({ kind, left: (until - state.t) / span }));
}

function hitBrick(state, ball, brick, events) {
  const { cfg } = state;
  const cx = brick.x + brick.w / 2, cy = brick.y + brick.h / 2;

  // Pierce ploughs straight through destructible bricks. Obstacles still deflect --
  // they are the one thing in the field that nothing gets through.
  const goesThrough = !brick.solid && piercing(state);

  if (!brick.solid) {
    brick.alive = false;
    leaveGroup(state, brick);
    state.destroyed++;
    ball.speed = Math.min(cfg.ball.speedMax, ball.speed * cfg.ball.speedGain);
  }

  if (!goesThrough) {
    // Reflect on the axis with the shallower overlap (i.e. the face we came through).
    const ox = brick.w / 2 + ball.r - Math.abs(ball.x - cx);
    const oy = brick.h / 2 + ball.r - Math.abs(ball.y - cy);
    if (ox < oy) { ball.vx = -ball.vx; ball.x += Math.sign(ball.x - cx) * ox; }
    else         { ball.vy = -ball.vy; ball.y += Math.sign(ball.y - cy) * oy; }
  }

  const m = Math.hypot(ball.vx, ball.vy) || 1;
  ball.vx = (ball.vx / m) * ball.speed;
  ball.vy = (ball.vy / m) * ball.speed;

  if (brick.solid) {
    events.push({ type: 'solid', brick, x: cx, y: cy });
    return;
  }

  events.push({ type: 'brick', brick, x: cx, y: cy, pierced: goesThrough, remaining: state.total - state.destroyed });

  if (cfg.drops.enabled && state.drops.length < cfg.drops.maxActive && state.rng() < cfg.drops.chance) {
    const kind = pickKind(cfg, state.rng);
    state.drops.push({ x: cx, y: cy, kind, w: cfg.drops.w, h: cfg.drops.h });
    events.push({ type: 'drop', kind, x: cx, y: cy });
  }

  if (state.destroyed === state.total) {
    state.cleared = true;
    state.clearedAt = state.t;
    events.push({ type: 'clear', x: cx, y: cy });
  } else {
    maybeSplit(state, ball, events);
  }
}

function substepBall(state, ball, dt, events) {
  const { cfg } = state, { field } = cfg;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // While wrapping, an edge is a doorway to the opposite edge: the ball keeps
  // its heading and reappears on the far side. Measured on the centre, so it
  // reads as leaving one wall and arriving at the other.
  if (wrapping(state)) {
    if (ball.x < field.x)                  { ball.x += field.w; events.push({ type: 'wrap', x: ball.x, y: ball.y }); }
    else if (ball.x > field.x + field.w)   { ball.x -= field.w; events.push({ type: 'wrap', x: ball.x, y: ball.y }); }
    if (ball.y < field.y)                  { ball.y += field.h; events.push({ type: 'wrap', x: ball.x, y: ball.y }); }
  } else {
    if (ball.x - ball.r < field.x)           { ball.x = field.x + ball.r; ball.vx = Math.abs(ball.vx); events.push({ type: 'wall', x: ball.x, y: ball.y }); }
    if (ball.x + ball.r > field.x + field.w) { ball.x = field.x + field.w - ball.r; ball.vx = -Math.abs(ball.vx); events.push({ type: 'wall', x: ball.x, y: ball.y }); }
    if (ball.y - ball.r < field.y)           { ball.y = field.y + ball.r; ball.vy = Math.abs(ball.vy); events.push({ type: 'wall', x: ball.x, y: ball.y }); }
  }

  const p = state.paddle;
  if (ball.vy > 0 && ball.y + ball.r >= p.y && ball.y - ball.r <= p.y + p.h &&
      ball.x >= p.x - p.w / 2 - ball.r && ball.x <= p.x + p.w / 2 + ball.r) {
    reflectOffPaddle(state, ball, events);
  }

  const floor = field.y + field.h;
  if (wrapping(state)) {
    // Past the bottom it comes back in at the top, so nothing is lost while
    // this is running.
    if (ball.y > floor) { ball.y -= field.h; events.push({ type: 'wrap', x: ball.x, y: ball.y }); }
  } else if (ball.y + ball.r > floor) {
    if (!cfg.floorBounce) {
      // Missed. The ball is gone; the run continues on whatever is still up.
      ball.dead = true;
      events.push({ type: 'lost', x: ball.x, y: floor });
      return;
    }
    if (cfg.floorBounce) {
      ball.y = floor - ball.r; ball.vy = -Math.abs(ball.vy);
      // Nudge the angle. The floor is not a real surface anyway, and a perfectly
      // elastic one lets a ball settle into a cycle that never reaches the paddle
      // or a gap -- a run can then make no progress for its entire length.
      const a = Math.atan2(ball.vy, ball.vx) + (state.rng() - 0.5) * cfg.floorScatter;
      ball.vx = Math.cos(a) * ball.speed;
      ball.vy = -Math.abs(Math.sin(a) * ball.speed);
      events.push({ type: 'floor', x: ball.x, y: floor });
    }
  }

  for (const b of state.bricks) {
    if (!b.alive) continue;
    if (ball.x + ball.r < b.x || ball.x - ball.r > b.x + b.w ||
        ball.y + ball.r < b.y || ball.y - ball.r > b.y + b.h) continue;
    hitBrick(state, ball, b, events);
    break;
  }
}

/** Advance the world by dt. Mutates state (fast, still fully deterministic). */
export function step(state, dt) {
  const events = [];
  if (state.over) return events;
  movePaddle(state, dt);
  stepGroups(state, dt);
  const subs = 8;
  for (let i = 0; i < subs; i++)
    for (const ball of state.balls) if (!ball.dead) substepBall(state, ball, dt / subs, events);

  if (state.balls.some((b) => b.dead)) {
    state.balls = state.balls.filter((b) => !b.dead);
    if (!state.balls.length) { state.over = true; state.missed = true; }
  }

  updateDrops(state, dt, events);
  state.t += dt;
  return events;
}

/**
 * Time dilation for the final brick. Only engages once a ball is genuinely
 * closing in, so the payoff is a short beat rather than a slow wander.
 */
export function slowFactor(state) {
  const { cfg } = state;
  if (!cfg.slowmo || state.cleared) return 1;
  if (state.total - state.destroyed !== 1) return 1;
  const b = state.bricks.find((x) => x.alive && !x.solid);
  if (!b) return 1;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let near = Infinity;
  for (const ball of state.balls) near = Math.min(near, Math.hypot(ball.x - cx, ball.y - cy));
  return near < cfg.slowmoRadius ? cfg.slowmoFactor : 1;
}

/**
 * One output frame of the movie. Scanning and rendering both go through here,
 * so the duration --scan reports is exactly the duration of the rendered file.
 */
export function* runFrames(state) {
  const { cfg } = state;
  const frameDt = 1 / cfg.fps;
  const cap = Math.round(cfg.maxDuration * cfg.fps);
  let outro = 0;
  for (let f = 0; f < cap; f++) {
    const dt = frameDt / slowFactor(state);
    const events = step(state, dt);
    yield { frame: f + 1, events, dt };
    if (state.cleared && ++outro >= cfg.outro * cfg.fps) return;
  }
}
