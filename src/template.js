import { Canvas } from 'skia-canvas';
import { writeFileSync } from 'node:fs';
import { playRows, templateRows } from './level.js';
import { MARK_INSET, MARK_SIZE } from './imagemap.js';

const LINE = 'rgba(0,0,0,0.10)';       // light enough to read as empty
const LINE_MAJOR = 'rgba(0,0,0,0.16)';   // every mark here must still read as "empty"

/**
 * A paintable grid. Every cell is marked; paint black for an obstacle and any
 * other colour for a brick (that colour becomes the brick's colour). Leave a
 * cell white to leave it empty.
 * Nothing but the faint rules is drawn, so the file can be loaded back as-is.
 */
export function writeTemplate(cfg, out, { cellPx = 20, fill = null } = {}) {
  const rows = playRows(cfg), all = templateRows(cfg);
  const W = cfg.cols * cellPx, H = all * cellPx;
  const gridH = rows * cellPx;
  const cv = new Canvas(W, H);
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, gridH);

  if (fill) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        const cell = fill[r]?.[c];
        if (!cell || cell.kind === 'empty') continue;
        // Body carries kind and colour; the corner mark carries direction, so a
        // moving piece keeps the colour it was painted.
        ctx.fillStyle = cell.kind === 'obstacle' ? '#000000' : cell.color;
        ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
        if (cell.axis) {
          ctx.fillStyle = cell.axis === 'h' ? '#FF0000' : '#00FF00';
          ctx.fillRect(c * cellPx, r * cellPx, cellPx * MARK_SIZE, cellPx * MARK_SIZE);
        }
      }
    }
  }

  ctx.lineWidth = 1;
  for (let c = 0; c <= cfg.cols; c++) {
    ctx.strokeStyle = c % 4 === 0 ? LINE_MAJOR : LINE;
    ctx.beginPath(); ctx.moveTo(c * cellPx + 0.5, 0); ctx.lineTo(c * cellPx + 0.5, gridH); ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.strokeStyle = r % 4 === 0 ? LINE_MAJOR : LINE;
    ctx.beginPath(); ctx.moveTo(0, r * cellPx + 0.5); ctx.lineTo(W, r * cellPx + 0.5); ctx.stroke();
  }

  drawKeyStrip(ctx, cfg, W, gridH, H - gridH);

  writeFileSync(out, cv.toBufferSync('png'));
  return { W, H, cellPx, rows, all, gridH };
}



/**
 * The key, printed into the bottom strip of the template itself. It occupies a
 * whole number of cell rows, and the loader reads only the rows above it -- so
 * the documentation travels with the file and can never be mistaken for level
 * content, however it is painted.
 */
function drawKeyStrip(ctx, cfg, W, top, h) {
  // The band is kept -- it is what makes the file cols x templateRows cells, so
  // the loader can find the boundary from the image size alone. Nothing is
  // printed in it any more.
  ctx.fillStyle = '#0E1222';
  ctx.fillRect(0, top, W, h);
  ctx.fillStyle = '#FF4E6B';
  ctx.fillRect(0, top, W, 3);
}
