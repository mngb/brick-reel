// Indestructible furniture, placed on the same grid as the bricks. Each character
// is one cell. Patterns are authored as the LEFT HALF only and mirrored, so they
// are symmetric by construction and always exactly cols wide.
// Every pattern keeps the outer and centre lanes open: a ball can never be sealed
// away from the bricks it still has to clear.
const HALVES = [
  ['..######..........',
   '..................',
   '........######....'],

  ['...###......###...',
   '...###......###...',
   '..................'],

  ['............###...',
   '......###.........',
   '###...............'],

  ['..####......####..',
   '..................',
   '..####......####..'],

  ['..##..##..##..##..',
   '..................',
   '......####........'],

  ['.....####.........',
   '..##..........##..',
   '.....####.........'],
];

function mirror(half, cols) {
  const flipped = [...half].reverse().join('');
  return (half + flipped).slice(0, cols).padEnd(cols, '.');
}

export function makeObstacles(cfg, rng) {
  if (!cfg.obstacles?.enabled) return [];
  const rows = HALVES[Math.floor(rng() * HALVES.length)];
  const { cell, brickGap: gap, obstacleTop } = cfg;
  const inset = gap / 2;

  const bricks = [];
  rows.forEach((half, r) => {
    const line = mirror(half, cfg.cols);
    for (let c = 0; c < cfg.cols; c++) {
      if (line[c] !== '#') continue;
      bricks.push({
        x: c * cell + inset,
        y: (obstacleTop + r) * cell + inset,
        w: cell - gap, h: cell - gap,
        row: obstacleTop + r, col: c,
        solid: true, alive: true, color: cfg.obstacles.color,
      });
    }
  });
  return bricks;
}
