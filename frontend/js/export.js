/* DXF export: all contours, or just the selected line. */
import { state } from './state.js';
import { setStatus } from './dom.js';

async function postExport(body, filename) {
  setStatus('export-status', 'Exporting...', '');
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setStatus('export-status', `Downloaded ${filename}`, 'ok');
  } catch (err) {
    setStatus('export-status', 'Error: ' + err.message, 'error');
  }
}

export function initExport() {
  document.getElementById('btn-export').addEventListener('click', () => {
    const layerPrefix = document.getElementById('layer-prefix').value || 'SETTLEMENT';
    const filename = document.getElementById('file-name').value || 'settlement_contours.dxf';
    const includePoints = document.getElementById('include-points').checked;
    const includeLabels = document.getElementById('include-labels').checked;
    postExport({
      contours: state.contours.map(c => ({ level: c.level, coords: c.coords, closed: c.closed })),
      points: includePoints ? state.points : null,
      layer_prefix: layerPrefix,
      include_points: includePoints,
      include_labels: includeLabels,
      filename,
    }, filename);
  });

  document.getElementById('btn-export-selected').addEventListener('click', () => {
    const c = state.contours.find(x => x.id === state.selectedId);
    if (!c) { setStatus('export-status', 'No line selected — pick one first.', 'error'); return; }
    const layerPrefix = document.getElementById('layer-prefix').value || 'SETTLEMENT';
    const base = (document.getElementById('file-name').value || 'settlement_contours.dxf').replace(/\.dxf$/i, '');
    // Auto-suffix so multiple selected-line exports don't overwrite each other
    // when several lines share a level (e.g. two closed rings at 5mm).
    const filename = `${base}_line_${c.level}mm_id${c.id}.dxf`;
    const includePoints = document.getElementById('include-points').checked;
    const includeLabels = document.getElementById('include-labels').checked;
    postExport({
      contours: [{ level: c.level, coords: c.coords, closed: c.closed }],
      points: includePoints ? state.points : null,
      layer_prefix: layerPrefix,
      include_points: includePoints,
      include_labels: includeLabels,
      filename,
    }, filename);
  });
}
