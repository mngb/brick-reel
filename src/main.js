import { Canvas } from 'skia-canvas';
import { writeFileSync } from 'node:fs';
import { defaultConfig } from './config.js';
import { createState, runFrames, piercing } from './sim.js';
import { playRows } from './level.js';
import { createFx, updateFx } from './fx.js';
import { draw } from './render.js';
import { openEncoder } from './encode.js';
import { loadMapGrid, KEYS } from './imagemap.js';
import { writeTemplate } from './template.js';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    a[key] = next === undefined || next.startsWith('--') ? true : (i++, next);
  }
  return a;
}

function buildConfig(a) {
  const cfg = structuredClone(defaultConfig);
  if (a.seed) cfg.seed = Number(a.seed);
  if (a.text) cfg.text = String(a.text).split('/');
  if (a.palette) cfg.palette = a.palette;
  if (a.density) cfg.density = Number(a.density);
  if (a.fps) cfg.fps = Number(a.fps);
  if (a.crf) cfg.crf = Number(a.crf);
  if (a['max-duration']) cfg.maxDuration = Number(a['max-duration']);
  if (a.cols) cfg.cols = Math.max(8, Math.round(Number(a.cols)));
  if (a.rows) cfg.rows = Math.max(8, Math.round(Number(a.rows)));
  if (a.cell) cfg.cell = Math.max(4, Math.round(Number(a.cell)));

  // The grid decides the canvas. cols/rows are even, so any integer cell size
  // yields even dimensions, which h264 + yuv420p requires.
  cfg.width = cfg.cols * cfg.cell;
  cfg.height = cfg.rows * cfg.cell;
  cfg.field = { x: 0, y: 0, w: cfg.width, h: cfg.height };

  // Lengths that are not grid-aligned were authored against the default cell.
  const k = cfg.cell / defaultConfig.cell;
  cfg.brickGap = Math.max(2, 2 * Math.round(cfg.brickGap * k / 2));   // stays even
  cfg.slowmoRadius *= k;
  cfg.moveSpeed *= k;
  cfg.drops = { ...cfg.drops, speed: cfg.drops.speed * k, w: Math.round(cfg.drops.w * k), h: Math.round(cfg.drops.h * k) };
  cfg.ball = { ...cfg.ball, r: cfg.ball.r * k, speed: cfg.ball.speed * k, speedMax: cfg.ball.speedMax * k };
  cfg.paddle = { ...cfg.paddle, h: Math.max(4, Math.round(cfg.paddle.h * k)), speed: cfg.paddle.speed * k };
  cfg.scale = k;
  if (a.slowmo === 'off') cfg.slowmo = false;
  return cfg;
}

/** Simulate many seeds with no rendering, and rank them by how they play out. */
function scan(cfg, count) {
  const rows = [];
  for (let seed = 1; seed <= count; seed++) {
    const st = createState({ ...cfg, seed });
    let f = 0, caught = 0, pierce = 0;
    for (const { events } of runFrames(st)) {           // same frame loop the renderer uses
      f++;
      for (const e of events) if (e.type === 'pickup') { caught++; if (e.kind === 'pierce') pierce++; }
    }
    if (st.cleared) rows.push({ seed, secs: +(f / cfg.fps).toFixed(2), balls: st.balls.length, caught, pierce });
  }
  rows.sort((a, b) => a.secs - b.secs);
  return rows;
}

/** Print timestamps where something worth previewing is on screen. */
function find(cfg, what) {
  const st = createState(cfg);
  const hits = [];
  let prev = false;
  for (const { frame } of runFrames(st)) {
    const now = what === 'pierce'
      ? piercing(st)
      : st.drops.some((d) => d.y > st.layout.y0 && d.y < st.paddle.y - 80);
    if (now && !prev) hits.push(frame);   // only the moment it starts
    prev = now;
  }
  console.log(`${hits.length} occurrences of "${what}"`);
  console.log(hits.slice(0, 14).map((f) => `--preview ${(f / cfg.fps + 0.25).toFixed(2)}`).join('\n'));
}

async function render(cfg, out) {
  const canvas = new Canvas(cfg.width, cfg.height);
  const ctx = canvas.getContext('2d');
  const state = createState(cfg);
  const fx = createFx(cfg.seed);
  const enc = openEncoder({ width: cfg.width, height: cfg.height, fps: cfg.fps, out, crf: cfg.crf });

  const t0 = Date.now();
  let f = 0;

  for (const { events, dt, frame } of runFrames(state)) {
    updateFx(fx, state, events, dt);
    draw(ctx, state, fx);
    await enc.write(canvas.toBufferSync('raw'));
    f = frame;
    if (f % 60 === 0) process.stdout.write(`\r  frame ${f}  ${(f / cfg.fps).toFixed(1)}s  bricks ${state.total - state.destroyed}/${state.total}  `);
  }

  await enc.close();
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n  ${f} frames (${(f / cfg.fps).toFixed(1)}s video) in ${secs.toFixed(1)}s  ->  ${out}`);
  if (!state.cleared) console.log('  note: hit the duration cap before clearing; try another seed.');
}

function preview(cfg, atSec, out) {
  const canvas = new Canvas(cfg.width, cfg.height);
  const ctx = canvas.getContext('2d');
  const state = createState(cfg);
  const fx = createFx(cfg.seed);
  const want = Math.round(atSec * cfg.fps);
  for (const { events, dt, frame } of runFrames(state)) {
    updateFx(fx, state, events, dt);
    if (frame >= want) break;
  }
  draw(ctx, state, fx);
  writeFileSync(out, canvas.toBufferSync('png'));
  console.log(`  preview at ${atSec}s -> ${out}`);
}

const a = parseArgs(process.argv.slice(2));
const cfg = buildConfig(a);

if (a.map) {
  cfg.mapGrid = await loadMapGrid(cfg, a.map);
  cfg.level = 'image';
}

/** Flatten whatever the current config builds into a paintable cell grid. */
function levelToGrid(c) {
  const st = createState(c);
  const rows = playRows(c);
  const grid = Array.from({ length: rows }, () => Array.from({ length: c.cols }, () => ({ kind: 'empty' })));
  for (const b of st.bricks) {
    if (b.row < 0 || b.row >= rows || b.col < 0 || b.col >= c.cols) continue;
    grid[b.row][b.col] = {
      kind: b.solid ? 'obstacle' : 'brick',
      axis: b.axis ?? null,
      color: b.solid ? null : b.color,
    };
  }
  return grid;
}

if (a.template) {
  const out = a.template === true ? 'out/template.png' : a.template;
  const example = out.replace(/\.png$/i, '') + '-example.png';
  const blank = writeTemplate(cfg, out);
  writeTemplate(cfg, example, { fill: levelToGrid(cfg) });
  console.log(`  ${cfg.cols} x ${blank.rows} paintable cells, ${blank.cellPx}px each`);
  console.log(`  file is ${blank.W} x ${blank.H}: the grid on top, then a ${cfg.docRows}-row key strip that is never read back`);
  console.log(`  (the field is ${cfg.rows} rows; the bottom ${cfg.rows - blank.rows} are the paddle plus ${cfg.safeRows} rows of clearance, and are not part of the template)`);
  console.log(`  blank    ${out}`);
  console.log(`  example  ${example}   (the current level, so you can see the mapping)`);
  console.log('');
  console.log('  white / transparent  -> empty');
  console.log('  black                -> static obstacle');
  for (const k of KEYS)
    console.log(`  ${k.name}  -> ${k.axis === 'h' ? 'left-right' : 'up-down'} moving ${k.kind}`);
  console.log('  any other colour     -> static brick, painted in that colour');
  console.log(`  then render with:  node src/main.js --map ${out} --seed 1`);
} else if (a.scan) {
  const n = Number(a.scan) === true ? 200 : Number(a.scan);
  const all = scan(cfg, n);
  const lo = a.min ? Number(a.min) : 0;
  const hi = a.max ? Number(a.max) : Infinity;
  const rows = all.filter((r) => r.secs >= lo && r.secs <= hi);

  console.log(`scanned ${n} seeds -- ${all.length} cleared within ${cfg.maxDuration}s`);
  if (all.length) {
    const q = (f) => all[Math.min(all.length - 1, Math.floor(all.length * f))].secs;
    console.log(`duration p10 ${q(0.1)}s  median ${q(0.5)}s  p90 ${q(0.9)}s`);
  }
  console.log(`${rows.length} in range [${lo}, ${hi === Infinity ? '-' : hi}]s\n`);
  for (const r of rows.slice(0, Number(a.top ?? 12)))
    console.log(`  --seed ${String(r.seed).padEnd(6)} ${String(r.secs).padStart(7)}s   ${r.balls} balls   ${r.caught} pickups (${r.pierce} pierce)`);
} else if (a.find) {
  find(cfg, a.find === true ? 'drop' : a.find);
} else if (a.preview !== undefined) {
  preview(cfg, Number(a.preview) === true ? 3 : Number(a.preview), a.out ?? 'out/preview.png');
} else {
  await render(cfg, a.out ?? `out/breakout-${cfg.seed}.mp4`);
}
