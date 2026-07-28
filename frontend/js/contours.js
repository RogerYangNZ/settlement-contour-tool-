/* Generate: send points to the backend for IDW interpolation + contour
 * tracing, then ingest the result into editable contour objects. */
import { state } from './state.js';
import { setStatus } from './dom.js';
import { buildProjection } from './projection.js';
import { renderCanvas } from './render.js';
import { renderLegend } from './legend.js';
import { fitView } from './canvas.js';
import { renderDwg } from './dwg.js';
import { revealGroup } from './panel.js';

// Ingest raw contour data (from /generate or /import-contours) into editable
// contour objects and refresh the whole view. Shared so a CSV-generated set and
// an imported DXF go through exactly the same edit/export pipeline.
//   contours: [{level, coords:[[x,y]], closed?}]  — closed optional (import
//             sends it explicitly and pre-deduped; /generate omits it and
//             duplicates the first vertex at the end of closed loops).
//   levels:   sorted unique level values for the legend.
//   bounds:   {x_min,x_max,y_min,y_max} to frame the projection.
export function loadContours({ contours, levels, bounds }) {
  state.levels = levels;
  state.contours = contours.map(c => {
    const dupClosed = c.coords.length > 2 &&
      Math.abs(c.coords[0][0] - c.coords[c.coords.length - 1][0]) < 1e-6 &&
      Math.abs(c.coords[0][1] - c.coords[c.coords.length - 1][1]) < 1e-6;
    const closed = typeof c.closed === 'boolean' ? c.closed : dupClosed;
    // Every vertex in coords/original must be a distinct, editable point; the
    // SVG "Z" command + the `closed` flag re-close the loop on render/export.
    const raw = dupClosed ? c.coords.slice(0, -1) : c.coords;
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
  // Contours imported without a CSV have no survey points to include.
  if (state.points.length === 0) {
    const inc = document.getElementById('include-points');
    if (inc) inc.checked = false;
  }
  revealGroup('group-edit');
  revealGroup('group-export');
  buildProjection(bounds);
  renderLegend();
  renderCanvas();
  renderDwg();   // projection changed — re-place the underlay to match
  fitView();
}

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
    loadContours({ contours: data.contours, levels: data.levels, bounds: data.grid_bounds });
    setStatus('generate-status', `${state.contours.length} contour lines at ${state.levels.length} levels`, 'ok');
  } catch (err) {
    setStatus('generate-status', 'Error: ' + err.message, 'error');
  } finally {
    document.getElementById('btn-generate').disabled = false;
  }
}

export function initGenerate() {
  document.getElementById('btn-generate').addEventListener('click', generate);
}
