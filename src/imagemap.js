import { loadImage, Canvas } from 'skia-canvas';
import { playRows, templateRows } from './level.js';

/**
 * Four pure key colours carry the type; every other colour is still a static
 * brick painted in that colour. Pure primaries are used because nothing in a
 * normal palette lands near them -- the closest palette entry is 132 away and
 * the match radius is 50, so a hand-picked brick colour can never be mistaken
 * for a key.
 */
export const KEYS = [
  { rgb: [0x00, 0x00, 0xFF], kind: 'obstacle', axis: 'h', name: 'pure blue    #0000FF' },
  { rgb: [0xFF, 0x00, 0xFF], kind: 'obstacle', axis: 'v', name: 'pure magenta #FF00FF' },
  { rgb: [0xFF, 0x00, 0x00], kind: 'brick',    axis: 'h', name: 'pure red     #FF0000' },
  { rgb: [0x00, 0xFF, 0x00], kind: 'brick',    axis: 'v', name: 'pure green   #00FF00' },
];
const KEY_RADIUS = 50;

export function classify(r, g, b, a) {
  if (a < 128) return { kind: 'empty' };

  for (const k of KEYS) {
    const d = Math.hypot(r - k.rgb[0], g - k.rgb[1], b - k.rgb[2]);
    if (d < KEY_RADIUS) return { kind: k.kind, axis: k.axis };
  }

  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  if (lum < 0.22) return { kind: 'obstacle', axis: null };
  if (sat < 0.12 && lum > 0.80) return { kind: 'empty' };
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { kind: 'brick', axis: null, color: hex };
}

/**
 * Sample an image into a cols x playRows grid. Any image size works: each cell
 * is read from nine points inside its middle and the majority wins, so grid
 * lines, antialiasing and a shaky brush cannot change the result.
 */
export async function loadMapGrid(cfg, path) {
  const img = await loadImage(path);
  const cv = new Canvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);

  // The file is cols x templateRows cells; only the top playRows are the map,
  // the rest is the printed key and is never sampled.
  const rows = playRows(cfg), all = templateRows(cfg);
  const want = cfg.cols / all, got = img.width / img.height;
  if (Math.abs(got - want) / want > 0.08)
    console.warn(`  note: ${path} is ${img.width}x${img.height}; a template is ${cfg.cols}x${all} cells ` +
                 `(aspect ${want.toFixed(2)}, this is ${got.toFixed(2)}). Regenerate with --template.`);

  const cw = img.width / cfg.cols, ch = img.height / all;
  const probes = [0.3, 0.5, 0.7];
  const grid = [];

  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cfg.cols; c++) {
      const votes = new Map();
      for (const py of probes) {
        for (const px of probes) {
          const x = Math.min(img.width - 1, Math.floor((c + px) * cw));
          const y = Math.min(img.height - 1, Math.floor((r + py) * ch));
          const i = (y * img.width + x) * 4;
          const cell = classify(data[i], data[i + 1], data[i + 2], data[i + 3]);
          const key = `${cell.kind}:${cell.axis ?? ''}:${cell.color ?? ''}`;
          const v = votes.get(key) ?? { n: 0, cell };
          v.n++; votes.set(key, v);
        }
      }
      let win = null;
      for (const v of votes.values()) if (!win || v.n > win.n) win = v;
      row.push(win.cell);
    }
    grid.push(row);
  }
  return grid;
}
