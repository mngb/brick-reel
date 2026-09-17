import { playRows } from './level.js';

const K = (r, c) => r * 4096 + c;
const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * A full-screen random map that is still playable.
 *
 * Scattering bricks and walls at random reliably seals parts of the grid off:
 * a pocket of bricks ringed by obstacles can never be reached, and the run
 * cannot finish. So the layout is generated first and then REPAIRED -- flood
 * fill from the bottom, and for every brick that no ball could ever touch,
 * carve the shortest corridor back to the reachable region. Repeat until the
 * fill covers everything.
 */
export function randomMap(cfg, rng, opts = {}) {
  const rows = playRows(cfg), cols = cfg.cols;
  const pBrick = opts.brick ?? 0.60;
  const pWall = opts.wall ?? 0.13;
  const pMove = opts.move ?? 0.55;     // share of pieces that get a direction
  // Room above the paddle zone. Too little and the ball is knocked straight down
  // out of reach: at 2 rows half the seeds ended with every ball lost, at 8 only
  // one in twelve did.
  const openRows = opts.openRows ?? 8;

  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ kind: 'empty' })));
  const axis = () => (rng() < pMove ? (rng() < 0.5 ? 'h' : 'v') : null);

  for (let r = 0; r < rows - openRows; r++)
    for (let c = 0; c < cols; c++) {
      const roll = rng();
      if (roll < pWall) grid[r][c] = { kind: 'obstacle', axis: axis() };
      else if (roll < pWall + pBrick)
        grid[r][c] = { kind: 'brick', axis: axis(), color: hue(rng()) };
    }

  const stats = repair(grid, rows, cols);
  return { grid, stats };
}

function hue(t) {
  const h = t * 360, s = 0.68, l = 0.58;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Cells a ball can eventually get to, from the bottom edge. Bricks do NOT block:
 * they are destroyed on contact, so a brick behind other bricks is reached once
 * those are gone. Only obstacles are permanent.
 */
function reachable(grid, rows, cols) {
  const seen = new Set(), q = [];
  for (let c = 0; c < cols; c++)
    if (grid[rows - 1][c].kind !== 'obstacle') { q.push([rows - 1, c]); seen.add(K(rows - 1, c)); }
  while (q.length) {
    const [r, c] = q.pop();
    for (const [dr, dc] of NB) {
      const nr = r + dr, nc = c + dc, k = K(nr, nc);
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || seen.has(k)) continue;
      if (grid[nr][nc].kind === 'obstacle') continue;
      seen.add(k); q.push([nr, nc]);
    }
  }
  return seen;
}

/** Carve until every brick touches the reachable region. */
function repair(grid, rows, cols) {
  let carved = 0, passes = 0;
  for (;;) {
    passes++;
    const seen = reachable(grid, rows, cols);
    const stranded = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (grid[r][c].kind === 'brick' && !seen.has(K(r, c))) stranded.push([r, c]);
    if (!stranded.length || passes > 200) {
      return { carved, passes, stranded: stranded.length };
    }

    // Shortest route from one stranded brick back to open ground, through
    // anything; every obstacle on it is removed.
    const [sr, sc] = stranded[0];
    const prev = new Map([[K(sr, sc), null]]);
    const q = [[sr, sc]];
    let hit = null;
    while (q.length && !hit) {
      const [r, c] = q.shift();
      for (const [dr, dc] of NB) {
        const nr = r + dr, nc = c + dc, k = K(nr, nc);
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || prev.has(k)) continue;
        prev.set(k, K(r, c));
        if (seen.has(k)) { hit = k; break; }
        q.push([nr, nc]);
      }
    }
    if (hit === null) return { carved, passes, stranded: stranded.length };

    for (let k = hit; k != null && k !== K(sr, sc); k = prev.get(k)) {
      const r = Math.floor(k / 4096), c = k % 4096;
      if (grid[r][c].kind === 'obstacle') { grid[r][c] = { kind: 'empty' }; carved++; }
    }
  }
}
