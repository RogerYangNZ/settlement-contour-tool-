/* Generate: send points to the backend for IDW interpolation + contour
 * tracing, then ingest the result into editable contour objects. */
import { state } from './state.js';
import { setStatus } from './dom.js';
import { buildProjection } from './projection.js';
import { renderCanvas } from './render.js';
import { renderLegend } from './legend.js';
import { fitView } from './canvas.js';

export async function generate() {
  if (state.points.length < 3) {
    setStatus('generate-status', 'Need at least 3 valid points', 'error');
    return;
  }
  const interval = parseFloat(document.getElementById('interval').value);
  const power = parseFloat(document.getElementById('power').value);
  const resolution = parseInt(document.getElementById('resolution').value, 10);

  setStatus('generate-status', 'Interpolating & tracing contours...', '');
  document.getElementById('btn-generate').disabled = true;
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: state.points, interval, power, resolution }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const data = await res.json();
    state.levels = data.levels;
    state.contours = data.contours.map(c => {
      const closed = c.coords.length > 2 &&
        Math.abs(c.coords[0][0] - c.coords[c.coords.length - 1][0]) < 1e-6 &&
        Math.abs(c.coords[0][1] - c.coords[c.coords.length - 1][1]) < 1e-6;
      // The tracer duplicates the first point at the end of closed loops.
      // Drop that duplicate here so every vertex in coords/original is a
      // distinct, independently editable point; the SVG "Z" path command
      // and the explicit `closed` flag (sent on export) re-close the loop.
      const raw = closed ? c.coords.slice(0, -1) : c.coords;
      return {
        id: state.nextId++,
        level: c.level,
        original: raw.map(p => p.slice()),
        coords: raw.map(p => p.slice()),
        closed,
        visible: true,
      };
    });
    state.selectedId = null;
    setStatus('generate-status', `${state.contours.length} contour lines at ${state.levels.length} levels`, 'ok');
    document.getElementById('section-legend').style.display = 'block';
    document.getElementById('section-edit').style.display = 'block';
    document.getElementById('section-export').style.display = 'block';
    buildProjection(data.grid_bounds);
    renderLegend();
    renderCanvas();
    fitView();
  } catch (err) {
    setStatus('generate-status', 'Error: ' + err.message, 'error');
  } finally {
    document.getElementById('btn-generate').disabled = false;
  }
}

export function initGenerate() {
  document.getElementById('btn-generate').addEventListener('click', generate);
}
