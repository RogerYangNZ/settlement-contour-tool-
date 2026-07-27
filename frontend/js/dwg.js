/* Georeferenced DWG/DXF underlay. The backend flattens the drawing to plain
 * polylines (plus text) in easting/northing; we draw them into dwgLayer, which
 * lives inside the pan/zoom group, so the vectors line up with the contours and
 * pan/zoom for free — no per-view re-fetch like the raster basemap needs. */
import { state } from './state.js';
import { project, buildProjection } from './projection.js';
import { dwgLayer, lineGen, fitView } from './canvas.js';
import { setStatus } from './dom.js';

export const dwg = {
  opacity: 0.8,
  color: '#c026d3',   // magenta — reads clearly over both aerial and contours
  visible: true,
  showText: true,
};

export function renderDwg() {
  const off = !state.dwg || !state.projection || !dwg.visible;
  if (off) {
    dwgLayer.selectAll('*').remove();
    return;
  }

  // Lines
  const lines = state.dwg.polylines.map(pl => pl.map(([x, y]) => project(x, y)));
  const paths = dwgLayer.selectAll('path.dwg-line').data(lines);
  paths.exit().remove();
  paths.enter().append('path')
    .attr('class', 'dwg-line')
    .attr('fill', 'none')
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('pointer-events', 'none')
    .merge(paths)
    .attr('d', d => lineGen(d))
    .attr('stroke', dwg.color)
    .attr('stroke-width', 0.8)
    .attr('opacity', dwg.opacity);

  // Text labels (optional)
  const texts = (dwg.showText ? state.dwg.texts : []).map(t => ({ ...t, px: project(t.x, t.y) }));
  const labels = dwgLayer.selectAll('text.dwg-text').data(texts);
  labels.exit().remove();
  labels.enter().append('text')
    .attr('class', 'dwg-text')
    .attr('pointer-events', 'none')
    .merge(labels)
    .attr('x', d => d.px[0])
    .attr('y', d => d.px[1])
    .attr('fill', dwg.color)
    .attr('font-size', 9)
    .attr('opacity', dwg.opacity)
    .text(d => d.text);
}

async function importFile(file) {
  if (!file) return;
  setStatus('dwg-status', `Importing ${file.name}…`, '');
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/import-dwg', { method: 'POST', body: form });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const data = await res.json();
    state.dwg = data;
    dwg.visible = true;
    document.getElementById('dwg-show').checked = true;
    // If no contours have set up a projection yet, base it on the drawing so
    // the underlay can display on its own; otherwise keep the contour framing.
    if (!state.projection) {
      buildProjection(data.bounds);
      fitView();
    }
    renderDwg();
    setStatus('dwg-status', `Loaded ${data.polyline_count} lines`, 'ok');
  } catch (err) {
    setStatus('dwg-status', 'Error: ' + err.message, 'error');
  }
}

export function initDwg() {
  const input = document.getElementById('dwg-input');
  input.addEventListener('change', () => {
    importFile(input.files[0]);
    input.value = '';   // allow re-importing the same file
  });

  document.getElementById('dwg-show').addEventListener('change', (e) => {
    dwg.visible = e.target.checked;
    renderDwg();
  });

  const opacity = document.getElementById('dwg-opacity');
  const opacityVal = document.getElementById('dwg-opacity-value');
  opacity.addEventListener('input', () => {
    dwg.opacity = parseInt(opacity.value, 10) / 100;
    opacityVal.textContent = opacity.value + '%';
    dwgLayer.selectAll('path.dwg-line, text.dwg-text').attr('opacity', dwg.opacity);
  });

  document.getElementById('dwg-remove').addEventListener('click', () => {
    state.dwg = null;
    renderDwg();
    setStatus('dwg-status', 'Removed', '');
  });
}
