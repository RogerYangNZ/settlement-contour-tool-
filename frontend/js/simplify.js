/* Vertex reduction (Douglas–Peucker). The tracer emits one vertex per grid-cell
 * crossing, so lines arrive far denser than their shape needs, which makes
 * vertex/segment editing fiddly. Each contour keeps its full-detail `traced`
 * geometry; `original` (the baseline smoothing and "Reset" work from) is the
 * simplified copy, re-derived whenever the slider moves.
 *
 * Tolerance is a fraction of the data extent's diagonal so one setting suits
 * both a 40 m site and a 4 km alignment, whatever the grid resolution. */
import { state } from './state.js';
import { renderCanvas } from './render.js';

// Slider positions -> tolerance as % of the extent diagonal. 0 = off.
const LEVELS_PCT = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.2, 2];
const DEFAULT_LEVEL = 4;   // 0.3% — about 4x fewer vertices on the sample, no visible change

function sliderLevel() {
  const el = document.getElementById('simplify-slider');
  return el ? parseInt(el.value, 10) : DEFAULT_LEVEL;
}

// Current tolerance in data units (metres). Needs state.projection.
export function currentTolerance() {
  const p = state.projection;
  if (!p) return 0;
  const diag = Math.hypot(p.xMax - p.xMin, p.yMax - p.yMin);
  return diag * LEVELS_PCT[sliderLevel()] / 100;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1e-18;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Iterative Douglas–Peucker on an open polyline; always keeps both endpoints.
function dpOpen(pts, tol) {
  const n = pts.length;
  if (n < 3) return pts.map(p => p.slice());
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = 0, k = -1;
    for (let q = i + 1; q < j; q++) {
      const d = segDist(pts[q], pts[i], pts[j]);
      if (d > maxD) { maxD = d; k = q; }
    }
    if (k >= 0 && maxD > tol) {
      keep[k] = 1;
      stack.push([i, k], [k, j]);
    }
  }
  return pts.filter((_, i) => keep[i]).map(p => p.slice());
}

export function simplifyLine(pts, tol, closed) {
  if (!(tol > 0) || pts.length < 3) return pts.map(p => p.slice());
  if (!closed) return dpOpen(pts, tol);
  // Closed loop (no duplicated end vertex): anchor at vertex 0 and the vertex
  // farthest from it, simplify the two halves, and stitch them back together.
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const halfA = pts.slice(0, far + 1);
  const halfB = pts.slice(far).concat([pts[0]]);
  // A loop small relative to the tolerance would collapse to a sliver, so
  // tighten the tolerance for that loop until it keeps at least 4 vertices.
  for (let t = tol; ; t /= 2) {
    const out = dpOpen(halfA, t).concat(dpOpen(halfB, t).slice(1, -1));
    if (out.length >= 4 || t < 1e-9) return out;
  }
}

function countVertices() {
  return state.contours.reduce((n, c) => n + c.coords.length, 0);
}

export function updateSimplifyLabel() {
  const label = document.getElementById('simplify-value');
  if (!label) return;
  const tol = currentTolerance();
  const verts = `${countVertices()} vertices`;
  label.textContent = tol > 0 ? `${tol.toFixed(2)} m · ${verts}` : `off · ${verts}`;
}

export function initSimplify() {
  const slider = document.getElementById('simplify-slider');
  slider.value = DEFAULT_LEVEL;
  slider.addEventListener('input', () => {
    // Re-derive every line from its full-detail trace. Like the smoothing
    // slider, this replaces manual vertex edits and smoothing on all lines.
    const tol = currentTolerance();
    state.contours.forEach(c => {
      c.original = simplifyLine(c.traced, tol, c.closed);
      c.coords = c.original.map(p => p.slice());
    });
    document.getElementById('smooth-slider').value = 0;
    document.getElementById('smooth-value').textContent = '0';
    renderCanvas();
    updateSimplifyLabel();
  });
}
