/* Georeferenced ArcGIS .lpkx utility-line underlay. The backend extracts each
 * layer package's geodatabase and flattens it to plain polylines/points in
 * NZTM2000; we draw them into utilitiesLayer, which lives inside the pan/zoom
 * group, so the vectors line up with the contours and pan/zoom for free.
 *
 * Unlike the single-drawing DWG underlay, several .lpkx files load at once —
 * each becomes its own entry in state.utilities with an independent toggle,
 * so GHELLA/Open Source and Wet/Dry sets can all be compared on one map. */
import { state } from './state.js';
import { project, buildProjection } from './projection.js';
import { utilitiesLayer, lineGen, fitView } from './canvas.js';
import { setStatus } from './dom.js';

// Fixed colour-coding instead of parsing the package's ArcGIS symbology:
// wet vs dry gets a colour family, GHELLA vs Open Source gets solid vs dashed.
// Anything that doesn't match either keyword falls back to a cycling palette
// so an unexpected filename still renders instead of silently failing.
const WET_COLOR = '#38bdf8';   // cyan — water/sewer/stormwater
const DRY_COLOR = '#fb923c';   // orange — power/telecom/gas
const FALLBACK_COLORS = ['#a78bfa', '#4ade80', '#f472b6', '#facc15'];
let fallbackIndex = 0;

function classifyUtilityFile(filename) {
  const lower = filename.toLowerCase();
  let color;
  if (lower.includes('wet')) color = WET_COLOR;
  else if (lower.includes('dry')) color = DRY_COLOR;
  else color = FALLBACK_COLORS[fallbackIndex++ % FALLBACK_COLORS.length];

  let dash = null; // solid
  if (lower.includes('open source')) dash = '4,3';
  // "ghella" (and anything else) stays solid.

  return { color, dash };
}

export function renderUtilities() {
  if (!state.projection) {
    utilitiesLayer.selectAll('*').remove();
    return;
  }

  const visibleLayers = state.utilities.filter(u => u.visible);

  // One <path> per layer, with every polyline as a separate "M...L..."
  // subpath, rather than one <path> per polyline — a layer like Open Source
  // Dry Utilities has 2000+ lines, and one DOM node per line makes pan/zoom
  // visibly janky at that count (same fix as dwg.js, see its comment).
  const lineGroups = utilitiesLayer.selectAll('path.utility-lines').data(visibleLayers, d => d.id);
  lineGroups.exit().remove();
  lineGroups.enter().append('path')
    .attr('class', 'utility-lines')
    .attr('fill', 'none')
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('pointer-events', 'none')
    .merge(lineGroups)
    .attr('d', layer => layer.polylines.map(pl => lineGen(pl.map(([x, y]) => project(x, y)))).join(' '))
    .attr('stroke', layer => layer.color)
    .attr('stroke-width', 1.2)
    .attr('stroke-dasharray', layer => layer.dash || null)
    .attr('opacity', layer => layer.opacity);

  const pointGroups = utilitiesLayer.selectAll('g.utility-points').data(visibleLayers, d => d.id);
  pointGroups.exit().remove();
  const pointGroupsEnter = pointGroups.enter().append('g').attr('class', 'utility-points');
  pointGroupsEnter.merge(pointGroups).each(function (layer) {
    const pts = layer.points.map(([x, y]) => project(x, y));
    const circles = d3.select(this).selectAll('circle').data(pts);
    circles.exit().remove();
    circles.enter().append('circle')
      .attr('r', 3)
      .attr('pointer-events', 'none')
      .merge(circles)
      .attr('cx', d => d[0])
      .attr('cy', d => d[1])
      .attr('fill', layer.color)
      .attr('opacity', layer.opacity);
  });
}

function addLayerRow(layer) {
  const list = document.getElementById('utilities-layer-list');
  const row = document.createElement('div');
  row.className = 'utility-layer-row';
  row.dataset.id = layer.id;

  const swatch = document.createElement('span');
  swatch.className = 'line-swatch' + (layer.dash ? ' dashed' : '');
  swatch.style.borderColor = layer.color;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = layer.visible;
  checkbox.addEventListener('change', () => {
    layer.visible = checkbox.checked;
    renderUtilities();
  });

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = layer.name;
  name.title = layer.name;

  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.textContent = '✕';
  remove.title = 'Remove layer';
  remove.addEventListener('click', () => {
    state.utilities = state.utilities.filter(u => u.id !== layer.id);
    row.remove();
    renderUtilities();
  });

  row.append(checkbox, swatch, name, remove);
  list.appendChild(row);
}

async function importFile(file) {
  if (!file) return;
  setStatus('utilities-status', `Importing ${file.name}…`, '');
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/import-utilities', { method: 'POST', body: form });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const data = await res.json();
    const { color, dash } = classifyUtilityFile(file.name);
    const layer = {
      id: 'util-' + (state.nextId++),
      name: file.name.replace(/\.lpkx$/i, ''),
      color,
      dash,
      visible: true,
      opacity: 0.85,
      polylines: data.polylines,
      points: data.points,
      bounds: data.bounds,
    };
    state.utilities.push(layer);
    addLayerRow(layer);
    // Bootstrap a projection from the first underlay loaded, same as DWG —
    // otherwise defer to whatever already framed the view (CSV, DWG, ...).
    if (!state.projection) {
      buildProjection(data.bounds);
      fitView();
    }
    renderUtilities();
    const counts = [];
    if (data.polyline_count) counts.push(`${data.polyline_count} lines`);
    if (data.point_count) counts.push(`${data.point_count} points`);
    setStatus('utilities-status', `Loaded ${file.name}: ${counts.join(', ')}`, 'ok');
  } catch (err) {
    setStatus('utilities-status', 'Error: ' + err.message, 'error');
  }
}

export function initUtilities() {
  const input = document.getElementById('utilities-input');
  input.addEventListener('change', () => {
    const files = Array.from(input.files);
    files.forEach(importFile);
    input.value = ''; // allow re-importing the same file(s)
  });
}
