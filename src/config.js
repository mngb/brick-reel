export const PALETTES = {
  sunset: ['#FF4E6B', '#FF7A4D', '#FFB13D', '#FFE05C', '#8BE07A', '#48C9F0', '#8B7BF5'],
  ice:    ['#7CE0FF', '#5CC2F5', '#4AA4EA', '#5B8BE0', '#7B78DE', '#9A6CD6', '#B96BCB'],
  mono:   ['#FFFFFF', '#E6E8F0', '#CCD0E0', '#B3B9D0', '#99A1C0', '#8089B0', '#6671A0'],
};

/**
 * The grid is the unit of everything. The canvas is cols x rows cells of `cell`
 * pixels, so no layout value is ever fractional: field = 36 x 48 cells = 1080x1440.
 * Lengths that are not grid-aligned (speeds, ball radius) are authored against
 * cell = 30 and scaled if you render at a different cell size.
 */
export const defaultConfig = {
  seed: 12345,
  cols: 36,
  rows: 48,
  cell: 30,          // px per cell -> canvas 1080 x 1440
  fps: 60,

  text: ['SHIP', 'IT'],
  caption: null,     // optional pixel-text line, drawn over the top rows
  watermark: null,   // optional handle along the bottom edge
  palette: 'sunset',
  bg: '#080A14',

  maxDuration: 600,  // hard cap, seconds (10 min)
  outro: 3.0,        // seconds of victory lap after the last brick
  slowmo: true,      // slow motion as a ball closes in on the final brick
  slowmoFactor: 4,
  slowmoRadius: 430, // px: only slow down once the kill is imminent

  // --- grid layout, all in cells ---
  level: 'chamber',  // 'chamber' = bricks walled in by obstacles | 'text' = the old mosaic

  // The vault: a ring of indestructible wall around a block of bricks, with the
  // ring punched open in a few places so a ball can get in (and back out).
  chamber: {
    col: null,       // null = centred horizontally
    row: 6,
    w: 26, h: 16,    // outer size in cells, wall included
    wall: 1,         // wall thickness in cells
    gapSize: 3,      // cells per opening
    gapsPerSide: [2, 3], // random number of openings on each side
    // The bottom faces the paddle, so it always gets one wide way in. Without a
    // guaranteed entry a ball can settle into a bounce cycle that never lines up
    // with a narrow gap, and the run makes no progress at all.
    entryGap: 5,
  },

  density: 1,        // text level only: each glyph pixel becomes density^2 bricks
  gridTop: 0,        // text level only: mosaic starts at this row
  obstacleTop: 22,   // free-standing obstacle pattern, below the vault
  paddleRow: 44,     // paddle sits on this row line
  docRows: 10,       // rows of the template taken up by the printed key at the
                     // bottom. They are part of the file but never read back.
  safeRows: 4,       // clearance above the paddle that a painted map may not use.
                     // Bricks or walls down here leave the ball no room to be
                     // returned, and can wedge it against the paddle.

  brickGap: 4,       // px inset inside each cell; a brick is (cell - brickGap) square

  shake: 0,            // screen shake on impact; 0 = off, 1 = the original amount
  floorBounce: false,  // true: the floor is a wall and nothing is ever lost.
                       // false: a ball the paddle misses is gone, and the run
                       // ends when the last one goes.
  floorScatter: 0.5,   // radians of angle jitter on a floor bounce, to break cycles
  showChrome: false, // field outline + floor line; off, you add your own border
  wallColor: '#3A4478', // indestructible walls
  moveSpeed: 90,       // px/s for moving groups (3 cells per second at cell 30)

  obstacles: { enabled: false, color: '#3A4478' }, // the extra mid-field pattern

  drops: {
    enabled: true,
    chance: 0.08,        // per destroyed brick
    maxActive: 5,        // cap what can be on screen at once
    speed: 300,          // fall speed, px/s
    w: 92, h: 40,
    // How long each timed effect lasts, in seconds.
    duration: { pierce: 3.0, wide: 6.5, freeze: 4.5, wrap: 5.0 },
    weights: { split: 1, triple: 0.7, pierce: 1, wide: 0.8, freeze: 0.7, wrap: 0.6 },
    colors: {
      split:  '#4EE6C1',   // one ball becomes two
      triple: '#7CE0FF',   // one ball becomes three
      pierce: '#FF7ACF',   // bricks do not deflect
      wide:   '#FFB13D',   // a longer paddle
      freeze: '#8B7BF5',   // moving pieces stop
      wrap:   '#8BE07A',   // leave one edge, arrive at the opposite one
    },
  },

  ball: {
    r: 9, speed: 780, speedMax: 1250, speedGain: 1.005,
    startCount: 1, maxCount: 6,
    // Split the ball that breaks a brick once the remaining fraction drops past each
    // mark. The steady speedGain above does most of the pacing work.
    splitAt: [0.22, 0.10],
  },
  paddle: { cols: 5, h: 18, speed: 2800, sloppiness: 0.9, wideFactor: 1.9 },
};
