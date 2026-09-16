import { textGrid } from './font.js';
import { PALETTES } from './config.js';

/** Subdivide each glyph pixel into d x d bricks: same letterforms, d^2 the bricks. */
function densify(grid, d) {
  if (d <= 1) return grid;
  const w = grid.w * d, h = grid.h * d;
  const cells = Array.from({ length: h }, (_, r) =>
    Array.from({ length: w }, (_, c) => grid.cells[(r / d) | 0][(c / d) | 0]));
  return { w, h, cells };
}

/** One grid cell -> one brick. Every coordinate here is a whole number of cells. */
function cellBrick(cfg, row, col, extra) {
  const { cell, brickGap: gap } = cfg;
  return {
    x: col * cell + gap / 2,
    y: row * cell + gap / 2,
    w: cell - gap, h: cell - gap,
    row, col, alive: true,
    ...extra,
  };
}

/** A vault: a solid ring of obstacles around a block of bricks, with gaps punched in. */
function chamberLevel(cfg, rng) {
  const ch = cfg.chamber;
  const colors = PALETTES[cfg.palette] ?? PALETTES.sunset;
  const col0 = ch.col ?? Math.floor((cfg.cols - ch.w) / 2);
  const row0 = ch.row;
  const wall = Math.max(1, ch.wall);

  if (col0 < 0 || col0 + ch.w > cfg.cols || row0 + ch.h > cfg.rows)
    throw new Error(`chamber ${ch.w}x${ch.h} at (${col0},${row0}) does not fit in ${cfg.cols}x${cfg.rows} cells`);

  // Start with a closed ring, then open it up.
  const open = new Set();
  const punch = (side, size = ch.gapSize) => {
    const along = side === 'top' || side === 'bottom' ? ch.w : ch.h;
    const span = Math.min(size, along - 2 * wall);
    if (span <= 0) return;
    const g = wall + Math.floor(rng() * (along - 2 * wall - span + 1));
    for (let i = 0; i < span; i++) {
      for (let d = 0; d < wall; d++) {
        if (side === 'top')    open.add(`${d},${g + i}`);
        if (side === 'bottom') open.add(`${ch.h - 1 - d},${g + i}`);
        if (side === 'left')   open.add(`${g + i},${d}`);
        if (side === 'right')  open.add(`${g + i},${ch.w - 1 - d}`);
      }
    }
  };
  const [lo, hi] = ch.gapsPerSide;
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    for (let i = 0; i < n; i++) punch(side);
  }
  if (ch.entryGap) punch('bottom', ch.entryGap);

  const bricks = [], solids = [], gaps = [];
  // The layout grid mirrors the brick block, so the end card lines up with it.
  const inner = { w: ch.w - 2 * wall, h: ch.h - 2 * wall };
  const cells = Array.from({ length: inner.h }, () => new Array(inner.w).fill(true));
  const rowColors = Array.from({ length: inner.h }, (_, r) => colors[r % colors.length]);

  for (let r = 0; r < ch.h; r++) {
    for (let c = 0; c < ch.w; c++) {
      const onRing = r < wall || r >= ch.h - wall || c < wall || c >= ch.w - wall;
      if (onRing) {
        if (open.has(`${r},${c}`)) {                      // this is a doorway
          gaps.push({ x: (col0 + c + 0.5) * cfg.cell, y: (row0 + r + 0.5) * cfg.cell });
          continue;
        }
        solids.push(cellBrick(cfg, row0 + r, col0 + c, { solid: true, color: cfg.wallColor }));
      } else {
        bricks.push(cellBrick(cfg, row0 + r, col0 + c, { color: rowColors[r - wall] }));
      }
    }
  }

  const layout = {
    x0: (col0 + wall) * cfg.cell + cfg.brickGap / 2,
    y0: (row0 + wall) * cfg.cell + cfg.brickGap / 2,
    cw: cfg.cell - cfg.brickGap, ch: cfg.cell - cfg.brickGap, gap: cfg.brickGap, cell: cfg.cell,
    col0: col0 + wall, row0: row0 + wall,
    grid: { w: inner.w, h: inner.h, cells }, colors, rowColors,
  };
  return { bricks, solids, layout, gaps, groups: [], mapRows: cfg.rows };
}

/** Bricks laid out as text. Kept available via `level: 'text'`. */
function textLevel(cfg) {
  const d = Math.max(1, cfg.density | 0);
  const grid = densify(textGrid(cfg.text), d);
  const { cols, rows } = cfg;

  if (grid.w > cols || grid.h + cfg.gridTop > rows)
    throw new Error(
      `text needs a ${grid.w}x${grid.h} grid but the field is ${cols}x${rows} cells ` +
      `(gridTop ${cfg.gridTop}). Shorten the text, lower --density, or raise cols/rows.`);

  const colors = PALETTES[cfg.palette] ?? PALETTES.sunset;
  const col0 = Math.floor((cols - grid.w) / 2);
  const row0 = cfg.gridTop;
  const rowColors = Array.from({ length: grid.h }, (_, r) => colors[((r / d) | 0) % colors.length]);

  const bricks = [];
  for (let r = 0; r < grid.h; r++)
    for (let c = 0; c < grid.w; c++)
      if (grid.cells[r][c]) bricks.push(cellBrick(cfg, row0 + r, col0 + c, { color: rowColors[r] }));

  const layout = {
    x0: col0 * cfg.cell + cfg.brickGap / 2, y0: row0 * cfg.cell + cfg.brickGap / 2,
    cw: cfg.cell - cfg.brickGap, ch: cfg.cell - cfg.brickGap, gap: cfg.brickGap, cell: cfg.cell,
    col0, row0, grid, colors, rowColors,
  };
  return { bricks, solids: [], layout, gaps: [], groups: [], mapRows: cfg.rows };
}

/**
 * How many rows a painted map covers. The paddle row and the fixed clearance
 * above it are not part of it at all -- the template is cut to this height, so
 * there is no band to remember to avoid and nothing to silently discard.
 */
export function playRows(cfg) {
  return cfg.paddleRow - cfg.safeRows;
}

/**
 * Total rows in a template file: the paintable grid plus the key printed under
 * it. Keeping the key a whole number of rows means the file stays an exact grid
 * multiple, so the loader can find the boundary from the image size alone.
 */
export function templateRows(cfg) {
  return playRows(cfg) + cfg.docRows;
}

/**
 * A level painted in an image. cfg.mapGrid is a rows x cols array of
 * {kind:'empty'|'solid'|'brick', color}. See src/imagemap.js for the colour rules.
 */
function imageLevel(cfg, rng) {
  const g = cfg.mapGrid;
  const rows = g.length;
  const palette = PALETTES[cfg.palette] ?? PALETTES.sunset;
  const bricks = [], solids = [];
  const byCell = new Map();                 // row*4096+col -> the piece in that cell
  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cfg.cols ? null : g[r][c].kind);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const cell = g[r][c];
      if (cell.kind === 'empty') continue;
      const solid = cell.kind === 'obstacle';
      // A moving brick has no painted colour of its own (its key colour carried
      // the direction), so it takes the palette band for its row.
      const color = solid ? cfg.wallColor : (cell.color ?? palette[r % palette.length]);
      const piece = cellBrick(cfg, r, c, { solid, color, axis: cell.axis ?? null });
      (solid ? solids : bricks).push(piece);
      byCell.set(r * 4096 + c, piece);
    }
  }
  if (!bricks.length) throw new Error('the image has no brick cells -- paint some non-black, non-white cells');

  // Adjacent movers form one body. Obstacles and bricks group together when they
  // share an axis, which is what "相邻则构成组" asks for; the two axes never merge.
  const groups = [];
  const seen = new Set();
  for (const [key, piece] of byCell) {
    if (!piece.axis || seen.has(key)) continue;
    const members = [];
    const stack = [key];
    seen.add(key);
    while (stack.length) {
      const k = stack.pop();
      const p = byCell.get(k);
      members.push(p);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nk = (p.row + dr) * 4096 + (p.col + dc);
        const n = byCell.get(nk);
        if (n && n.axis === piece.axis && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    const group = { axis: piece.axis, dir: rng() < 0.5 ? -1 : 1, off: 0, members };
    for (const m of members) m.group = group;
    groups.push(group);
  }

  // A doorway is an empty cell that touches a wall and has a brick in line of
  // sight nearby. The paddle aims at these when every brick is occluded.
  const gaps = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      if (g[r][c].kind !== 'empty') continue;
      const touchesWall = at(r - 1, c) === 'obstacle' || at(r + 1, c) === 'obstacle' ||
                          at(r, c - 1) === 'obstacle' || at(r, c + 1) === 'obstacle';
      if (!touchesWall) continue;
      let seesBrick = false;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        for (let k = 1; k <= 3 && !seesBrick; k++) {
          const kind = at(r + dr * k, c + dc * k);
          if (kind === 'obstacle' || kind === null) break;
          if (kind === 'brick') seesBrick = true;
        }
      }
      if (seesBrick) gaps.push({ x: (c + 0.5) * cfg.cell, y: (r + 0.5) * cfg.cell });
    }
  }

  // The bounding box of the bricks stands in for the mosaic, so the end card
  // reforms where the bricks started.
  const r0 = Math.min(...bricks.map((b) => b.row)), r1 = Math.max(...bricks.map((b) => b.row));
  const c0 = Math.min(...bricks.map((b) => b.col)), c1 = Math.max(...bricks.map((b) => b.col));
  const cells = Array.from({ length: r1 - r0 + 1 }, (_, r) =>
    Array.from({ length: c1 - c0 + 1 }, (_, c) => g[r0 + r][c0 + c].kind === 'brick'));
  const rowColors = Array.from({ length: r1 - r0 + 1 }, (_, r) => {
    const hit = bricks.find((b) => b.row === r0 + r);
    return hit ? hit.color : '#FFFFFF';
  });

  const layout = {
    x0: c0 * cfg.cell + cfg.brickGap / 2, y0: r0 * cfg.cell + cfg.brickGap / 2,
    cw: cfg.cell - cfg.brickGap, ch: cfg.cell - cfg.brickGap, gap: cfg.brickGap, cell: cfg.cell,
    col0: c0, row0: r0,
    grid: { w: c1 - c0 + 1, h: r1 - r0 + 1, cells }, colors: rowColors, rowColors,
  };
  return { bricks, solids, layout, gaps, groups, mapRows: rows };
}

/** cw + gap === cell, so anything stepping by (cw + gap) stays on the grid. */
export function buildLevel(cfg, rng) {
  if (cfg.level === 'image') return imageLevel(cfg, rng);
  if (cfg.level === 'text') return textLevel(cfg);
  return chamberLevel(cfg, rng);
}
