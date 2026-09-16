/**
 * Drives the editor's interaction state machine outside a browser.
 *
 * The point of the DOM stub is that querySelector returns null for anything the
 * HTML does not contain, exactly as a browser does -- a reference to a deleted
 * element has to fail here too. That is what a stub returning a convenient fake
 * for every selector would hide, and it is how a deleted panel once left
 * selectShape throwing before it could change the shape.
 *
 *   node test/editor.mjs
 */
import fs from 'node:fs';
import { Canvas } from 'skia-canvas';

const html = fs.readFileSync('/home/pk/Work/x/index.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

// --- minimal DOM good enough to run the editor ---
const listeners = { window: {} };
const mk = (id) => {
  const el = {
    id, hidden: false, disabled: false, textContent: '', value: '', href: '', src: '',
    style: {}, dataset: {}, files: [], attrs: {},
    classList: { add() {}, remove() {} },
    addEventListener(t, f) { (listeners[id] ||= {})[t] = f; },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    querySelector() { return mk(id + '>child'); },
    querySelectorAll() { return { forEach() {} }; },
    append() {}, click() {}, showModal() {}, close() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 720, height: 800 }),
    setPointerCapture() {}, releasePointerCapture() {},
    toDataURL: () => 'data:,', toBlob: (cb) => cb(null),
  };
  if (id === 'grid') { const c = new Canvas(720, 800); el.getContext = (t) => c.getContext(t); el.width = 720; el.height = 800; }
  if (id === 'strip') { const c = new Canvas(720, 200); el.getContext = (t) => c.getContext(t); el.width = 720; el.height = 200; }
  return el;
};
const nodes = new Map();
const byId = (id) => { if (!nodes.has(id)) nodes.set(id, mk(id)); return nodes.get(id); };

// Real browsers return null for a selector that matches nothing. Mirroring that
// is the whole point: a reference to a deleted element must blow up here too.
const present = new Set([...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
const document = {
  querySelector: (s) => {
    const id = s.replace(/^#/, '');
    return present.has(id) ? byId(id) : null;
  },
  createElement: (t) => (t === 'canvas' ? Object.assign(new Canvas(1, 1), { getContext(k) { return Canvas.prototype.getContext.call(this, k); } }) : mk('new')),
};
const windowStub = { claude: undefined };
const addEventListener = (t, f) => { listeners.window[t] = f; };
const navigator = { clipboard: { writeText: async () => {}, write: async () => {} } };
const getComputedStyle = () => ({ fontFamily: 'sans-serif' });
const ClipboardItem = function () {};
const Image = function () {};
const URL = { createObjectURL: () => '', revokeObjectURL: () => {} };

const api = new Function(
  'document', 'window', 'addEventListener', 'navigator', 'getComputedStyle',
  'ClipboardItem', 'Image', 'URL', 'Canvas',
  script + '\n; return { get shape(){return shape}, get sel(){return sel}, get stroke(){return stroke},' +
  ' get curve(){return curve}, get marquee(){return marquee}, get selDrag(){return selDrag},' +
  ' get penBase(){return penBase}, get cells(){return cells}, selectShape, selectTool };'
)(document, windowStub, addEventListener, navigator, getComputedStyle, ClipboardItem, Image, URL, Canvas);

const grid = byId('grid');
const ev = (r, c, extra = {}) => ({ clientX: c * 20 + 10, clientY: r * 20 + 10, button: 0, pointerId: 1, preventDefault() {}, ...extra });
const down = (r, c, x) => listeners.grid.pointerdown(ev(r, c, x));
const move = (r, c, x) => listeners.grid.pointermove(ev(r, c, x));
const up = () => listeners.window.pointerup({ preventDefault() {} });
const live = () => api.cells.flat().filter((x) => x.t !== 'empty').length;

const step = (label, fn) => {
  try { fn(); console.log(`  ok    ${label}   [shape=${api.shape} sel=${!!api.sel} stroke=${!!api.stroke} marquee=${!!api.marquee} selDrag=${!!api.selDrag} penBase=${!!api.penBase}] cells=${live()}`); }
  catch (e) { console.log(`  THROW ${label}   ${e.constructor.name}: ${e.message}`); }
};

console.log('--- 0. 每个被引用的元素都必须存在 ---');
{
  const refs = [...new Set([...script.matchAll(/\$\("#([\w-]+)"\)/g)].map((m) => m[1]))];
  const gone = refs.filter((id) => !present.has(id));
  console.log(gone.length ? `  MISSING: ${gone.join(' ')}` : `  ok    ${refs.length} 个引用全部存在`);
}

console.log('--- 1. 用 Box 画点东西 ---');
step('选 Box', () => api.selectShape('rect'));
step('按下 (5,5)', () => down(5, 5));
step('拖到 (9,12)', () => move(9, 12));
step('松开 -> 应落笔', () => up());

console.log('--- 2. 切到 Select 并框选 ---');
step('选 Select', () => api.selectShape('select'));
step('按下 (4,4)', () => down(4, 4));
step('拖到 (10,13)', () => move(10, 13));
step('松开 -> 抬起选区', () => up());
step('拖动选区: 按下框内 (7,8)', () => down(7, 8));
step('拖到 (16,20)', () => move(16, 20));
step('松开', () => up());

console.log('--- 3. 直接切到 Pencil 后作画 ---');
step('选 Pencil', () => api.selectShape('pencil'));
step('按下 (25,5)', () => down(25, 5));
step('拖到 (25,15)', () => move(25, 15));
step('松开', () => up());

console.log('--- 4. 切到 Box 再画 ---');
step('选 Box', () => api.selectShape('rect'));
step('按下 (30,5)', () => down(30, 5));
step('拖到 (34,14)', () => move(34, 14));
step('松开', () => up());
