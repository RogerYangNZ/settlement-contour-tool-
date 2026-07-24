/* Chaikin corner-cutting smoothing, applied from each line's ORIGINAL traced
 * geometry every time the slider moves, so it's a non-destructive preview. */
import { state } from './state.js';
import { renderCanvas } from './render.js';

function lerp(p0, p1, t) { return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]; }

function chaikin(points, iterations, closed) {
  let pts = points.map(p => p.slice());
  for (let it = 0; it < iterations; it++) {
    const n = pts.length;
    if (n < 3) break;
    const out = [];
    if (closed) {
      for (let i = 0; i < n; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % n];
        out.push(lerp(p0, p1, 0.25), lerp(p0, p1, 0.75));
      }
    } else {
      out.push(pts[0]);
      for (let i = 0; i < n - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        out.push(lerp(p0, p1, 0.25), lerp(p0, p1, 0.75));
      }
      out.push(pts[n - 1]);
    }
    pts = out;
  }
  return pts;
}

export function initSmoothing() {
  const smoothSlider = document.getElementById('smooth-slider');
  smoothSlider.addEventListener('input', () => {
    const iterations = parseInt(smoothSlider.value, 10);
    document.getElementById('smooth-value').textContent = iterations;
    const applyAll = document.getElementById('smooth-all').checked;
    const targets = applyAll ? state.contours : state.contours.filter(c => c.id === state.selectedId);
    targets.forEach(c => {
      c.coords = iterations === 0 ? c.original.map(p => p.slice()) : chaikin(c.original, iterations, c.closed);
    });
    renderCanvas();
  });

  document.getElementById('btn-reset-line').addEventListener('click', () => {
    const c = state.contours.find(x => x.id === state.selectedId);
    if (c) { c.coords = c.original.map(p => p.slice()); smoothSlider.value = 0; document.getElementById('smooth-value').textContent = '0'; renderCanvas(); }
  });
  document.getElementById('btn-reset-all').addEventListener('click', () => {
    state.contours.forEach(c => c.coords = c.original.map(p => p.slice()));
    smoothSlider.value = 0;
    document.getElementById('smooth-value').textContent = '0';
    renderCanvas();
  });
}
