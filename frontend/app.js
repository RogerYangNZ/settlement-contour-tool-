/* Settlement Contour Tool — frontend logic.
 * CSV upload -> column mapping -> call backend for IDW + contours ->
 * render on an SVG canvas with pan/zoom -> manual vertex editing +
 * Chaikin smoothing -> export edited contours to DXF via backend.
 */

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  header: [],
  rawRows: [],
  points: [],           // [{x,y,z,id}]
  contours: [],          // [{id, level, original:[[x,y]], coords:[[x,y]], closed, visible}]
  levels: [],
  selectedId: null,
  tool: 'select',        // select | add | delete | cut
  showPoints: true,
  projection: null,      // {xScale,yScale,scale,worldW,worldH,xMin,yMin,xMax,yMax}
  nextId: 1,
};

const COLORS = ['#4f9dff', '#3ecf8e', '#f4d35e', '#ff9a4a', '#ff6b4a', '#c77dff', '#7dd3fc', '#f472b6'];

function colorForLevel(level) {
  const idx = state.levels.indexOf(level);
  if (idx < 0) return '#4f9dff';
  const lo = Math.min(...state.levels);
  const hi = Math.max(...state.levels);
  let t = hi > lo ? (level - lo) / (hi - lo) : 0;
  t = Math.min(1, Math.max(0, t));
  let r, g;
  if (t < 0.5) { r = Math.round(255 * (t / 0.5)); g = 200; }
  else { r = 255; g = Math.round(200 * (1 - (t - 0.5) / 0.5)); }
  return `rgb(${r},${g},40)`;
}

// ---------------------------------------------------------------------
// CSV parsing (client-side, handles simple quoted fields)
// ---------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

function setStatus(elId, msg, cls) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

// ---------------------------------------------------------------------
// Upload + column mapping
// ---------------------------------------------------------------------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCSV(reader.result);
    if (!rows.length) { setStatus('generate-status', 'CSV appears empty', 'error'); return; }
    state.header = rows[0];
    state.rawRows = rows.slice(1);
    populateMapping();
  };
  reader.readAsText(file);
}

function guessColumn(names, keywords) {
  for (let i = 0; i < names.length; i++) {
    const n = names[i].toLowerCase();
    if (keywords.some(k => n.includes(k))) return i;
  }
  return -1;
}

function populateMapping() {
  document.getElementById('mapping').style.display = 'block';
  const selects = {
    'col-x': guessColumn(state.header, ['east', 'x']),
    'col-y': guessColumn(state.header, ['north', 'y']),
    'col-z': guessColumn(state.header, ['settle', 'displac', 'z', 'value']),
    'col-id': guessColumn(state.header, ['id', 'point', 'name']),
  };
  for (const selId in selects) {
    const sel = document.getElementById(selId);
    sel.innerHTML = '';
    if (selId === 'col-id') {
      const opt = document.createElement('option');
      opt.value = -1; opt.textContent = '(none)';
      sel.appendChild(opt);
    }
    state.header.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = h;
      sel.appendChild(opt);
    });
    if (selects[selId] >= 0) sel.value = selects[selId];
  }

  const table = document.getElementById('preview-table');
  const previewRows = state.rawRows.slice(0, 6);
  let html = '<tr>' + state.header.map(h => `<th>${h}</th>`).join('') + '</tr>';
  previewRows.forEach(r => { html += '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>'; });
  table.innerHTML = html;

  document.getElementById('section-settings').style.display = 'block';
  document.getElementById('section-underlays').style.display = 'block';
  buildPointsFromMapping();
  [selects, ['col-x', 'col-y', 'col-z', 'col-id']].forEach(() => {});
  ['col-x', 'col-y', 'col-z', 'col-id'].forEach(id => {
    document.getElementById(id).addEventListener('change', buildPointsFromMapping);
  });
}

function buildPointsFromMapping() {
  const xi = +document.getElementById('col-x').value;
  const yi = +document.getElementById('col-y').value;
  const zi = +document.getElementById('col-z').value;
  const idi = +document.getElementById('col-id').value;
  const pts = [];
  let skipped = 0;
  state.rawRows.forEach((r, i) => {
    const x = parseFloat(r[xi]), y = parseFloat(r[yi]), z = parseFloat(r[zi]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      pts.push({ x, y, z, id: idi >= 0 ? (r[idi] || `P${i}`) : `P${i}` });
    } else skipped++;
  });
  state.points = pts;
  setStatus('generate-status', `${pts.length} valid points loaded` + (skipped ? `, ${skipped} rows skipped` : ''), skipped ? 'error' : 'ok');
  updateUnderlayCrsWarning();
}

// LINZ Basemaps only aligns when the input XY is in NZTM 2000. Real NZTM
// eastings fall in ~900k-3.2M and northings in ~4M-8.2M; anything wildly
// outside those bands is almost certainly a local site grid or a different
// CRS, so warn instead of silently drawing a misaligned map.
function updateUnderlayCrsWarning() {
  const el = document.getElementById('underlay-status');
  if (!state.points.length) { el.textContent = ''; el.className = 'status'; return; }
  const outOfNZTM = state.points.some(p =>
    p.x < 900000 || p.x > 3200000 || p.y < 4000000 || p.y > 8200000
  );
  if (outOfNZTM) {
    el.textContent = "Data doesn't look like NZTM 2000 (local grid or different CRS). Basemap will be misaligned or off-map.";
    el.className = 'status error';
  } else {
    el.textContent = '';
    el.className = 'status';
  }
}

// ---------------------------------------------------------------------
// Generate (call backend)
// ---------------------------------------------------------------------
document.getElementById('btn-generate').addEventListener('click', generate);

async function generate() {
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

// ---------------------------------------------------------------------
// Projection (data space -> fixed "world pixel" space; zoom/pan is a
// separate transform layered on top so editing math stays simple)
// ---------------------------------------------------------------------
function buildProjection(bounds) {
  const { x_min, x_max, y_min, y_max } = bounds;
  const dataW = (x_max - x_min) || 1;
  const dataH = (y_max - y_min) || 1;
  const worldSize = 1000;
  const scale = worldSize / Math.max(dataW, dataH);
  state.projection = {
    xMin: x_min, xMax: x_max, yMin: y_min, yMax: y_max,
    scale,
    worldW: dataW * scale,
    worldH: dataH * scale,
  };
}

function project(x, y) {
  const p = state.projection;
  return [(x - p.xMin) * p.scale, (p.yMax - y) * p.scale];
}

function unproject(px, py) {
  const p = state.projection;
  return [px / p.scale + p.xMin, p.yMax - py / p.scale];
}

// ---------------------------------------------------------------------
// Canvas / D3 rendering
// ---------------------------------------------------------------------
const svg = d3.select('#canvas-svg');
const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
// Underlays paint below everything else. This is deliberately a group of
// groups so future underlays (georeferenced DWG, other raster sources) can
// each get their own child layer without disturbing the basemap render.
const underlaysLayer = zoomLayer.append('g').attr('class', 'underlays-layer');
const linzBasemapLayer = underlaysLayer.append('g').attr('class', 'linz-basemap-layer');
// Hit layer sits below the visible line layer so clicks land on the fat
// invisible strokes, but the crisp visible lines paint on top of them.
const contourHitLayer = zoomLayer.append('g').attr('class', 'contour-hit-layer');
const contoursLayer = zoomLayer.append('g').attr('class', 'contours-layer');
const pointsLayer = zoomLayer.append('g').attr('class', 'points-layer');
const vertexLayer = zoomLayer.append('g').attr('class', 'vertex-layer');

// ---------------------------------------------------------------------
// LINZ Basemaps (NZTM 2000 tile scheme). No proj4 needed — the tiles are
// served natively in the same CRS the contour data is in, so alignment is
// a straight NZTM-to-world-pixel projection using the existing project().
// ---------------------------------------------------------------------
// NZTM2000Quad TileMatrixSet parameters (from LINZ Basemaps spec). Zoom 0
// is a single 256px tile covering a ~14.67 million m square that contains
// all of NZ; each higher zoom quadtree-subdivides.
// Values taken directly from LINZ's published NZTM2000Quad WMTSCapabilities:
//   TopLeftCorner = "10438190.1652 -3260586.7284" (EPSG:2193 axis order is
//   Northing, Easting, so northing=10438190.1652, easting=-3260586.7284).
//   z0 extent = z0 ScaleDenominator(139770566.007179) * 0.00028 m/px * 256.
const NZTM_TMS = {
  originX: -3260586.7284,     // easting of the left edge
  originY: 10438190.1652,     // northing of the top edge
  extentAtZ0: 10018754.171,   // metres spanned by the single z0 tile
  tileSizePx: 256,
  // Cap tile fetch zoom well below the raw tile-scheme max — LINZ aerial
  // coverage thins to blank tiles past ~z18 outside dense urban areas, so
  // clamping here lets deep on-screen zoom just stretch a lower-zoom tile
  // (browser interpolation) instead of drawing nothing.
  maxZoom: 18,
};
// Meters per tile-pixel at zoom 0 = extentAtZ0 / (tilesAtZ0 * tileSizePx)
// = 14665886 / 256 ~ 57288. Used to pick the tile zoom that best matches
// the current on-screen resolution.
const NZTM_M_PER_TILEPX_Z0 = NZTM_TMS.extentAtZ0 / NZTM_TMS.tileSizePx;

// API key priority: config.js (authoritative) -> localStorage (UI paste) -> empty.
const basemap = {
  style: 'off',       // 'off' | 'aerial' | 'topographic'
  opacity: 0.6,
  apiKey: (window.APP_CONFIG && window.APP_CONFIG.LINZ_API_KEY)
    || localStorage.getItem('linzBasemapsApiKey')
    || '',
};

function linzTileUrl(style, z, x, y) {
  return `https://basemaps.linz.govt.nz/v1/tiles/${style}/NZTM2000Quad/${z}/${x}/${y}.webp?api=${encodeURIComponent(basemap.apiKey)}`;
}

function tileBoundsNZTM(z, tx, ty) {
  const size = NZTM_TMS.extentAtZ0 / Math.pow(2, z);
  return {
    x_min: NZTM_TMS.originX + tx * size,
    x_max: NZTM_TMS.originX + (tx + 1) * size,
    y_max: NZTM_TMS.originY - ty * size,
    y_min: NZTM_TMS.originY - (ty + 1) * size,
  };
}

function renderBasemap() {
  const attribution = document.getElementById('basemap-attribution');
  const off = basemap.style === 'off' || !basemap.apiKey || !state.projection;
  attribution.style.display = off ? 'none' : 'block';
  if (off) {
    linzBasemapLayer.selectAll('image').remove();
    return;
  }

  // Screen viewport -> world-pixel space (invert the zoom transform) ->
  // data (NZTM) space. That gives us the NZTM window we need to cover.
  const rect = svg.node().getBoundingClientRect();
  const t = d3.zoomTransform(svg.node());
  const [ux, uy] = t.invert([0, 0]);
  const [vx, vy] = t.invert([rect.width, rect.height]);
  const [dx1, dy1] = unproject(ux, uy);
  const [dx2, dy2] = unproject(vx, vy);
  const view = {
    x_min: Math.min(dx1, dx2), x_max: Math.max(dx1, dx2),
    y_min: Math.min(dy1, dy2), y_max: Math.max(dy1, dy2),
  };

  // Pick tile zoom: match tile-pixel size to current on-screen m/px.
  const mPerScreenPx = (view.x_max - view.x_min) / Math.max(rect.width, 1);
  let z = Math.round(Math.log2(NZTM_M_PER_TILEPX_Z0 / Math.max(mPerScreenPx, 1e-9)));
  z = Math.max(0, Math.min(NZTM_TMS.maxZoom, z));

  const sizeAtZ = NZTM_TMS.extentAtZ0 / Math.pow(2, z);
  const maxIdx = Math.pow(2, z) - 1;
  const tx0 = Math.max(0, Math.floor((view.x_min - NZTM_TMS.originX) / sizeAtZ));
  const tx1 = Math.min(maxIdx, Math.floor((view.x_max - NZTM_TMS.originX) / sizeAtZ));
  const ty0 = Math.max(0, Math.floor((NZTM_TMS.originY - view.y_max) / sizeAtZ));
  const ty1 = Math.min(maxIdx, Math.floor((NZTM_TMS.originY - view.y_min) / sizeAtZ));

  // Safety cap so a stray extreme zoom doesn't ask for thousands of tiles.
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 300) {
    linzBasemapLayer.selectAll('image').remove();
    return;
  }

  const tiles = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const b = tileBoundsNZTM(z, tx, ty);
      const [px, py] = project(b.x_min, b.y_max);   // world-pixel top-left
      const [px2, py2] = project(b.x_max, b.y_min); // world-pixel bottom-right
      tiles.push({
        key: `${basemap.style}/${z}/${tx}/${ty}`,
        url: linzTileUrl(basemap.style, z, tx, ty),
        x: px, y: py,
        width: px2 - px,
        height: py2 - py,
      });
    }
  }

  const sel = linzBasemapLayer.selectAll('image').data(tiles, d => d.key);
  sel.exit().remove();
  sel.enter().append('image')
    .attr('preserveAspectRatio', 'none')
    .merge(sel)
    .attr('href', d => d.url)
    .attr('x', d => d.x)
    .attr('y', d => d.y)
    .attr('width', d => d.width)
    .attr('height', d => d.height)
    .attr('opacity', basemap.opacity);
}

const zoomBehavior = d3.zoom().scaleExtent([0.1, 40]).on('zoom', (event) => {
  zoomLayer.attr('transform', event.transform);
  renderBasemap();
});
svg.call(zoomBehavior);

function fitView() {
  if (!state.projection) return;
  const rect = svg.node().getBoundingClientRect();
  const pad = 40;
  const k = Math.min(
    (rect.width - pad * 2) / state.projection.worldW,
    (rect.height - pad * 2) / state.projection.worldH
  ) || 1;
  const tx = (rect.width - state.projection.worldW * k) / 2;
  const ty = (rect.height - state.projection.worldH * k) / 2;
  const t = d3.zoomIdentity.translate(tx, ty).scale(k);
  svg.transition().duration(300).call(zoomBehavior.transform, t);
}
document.getElementById('btn-zoom-fit').addEventListener('click', fitView);
document.getElementById('btn-toggle-points').addEventListener('click', () => {
  state.showPoints = !state.showPoints;
  renderCanvas();
});

const lineGen = d3.line().x(d => d[0]).y(d => d[1]);

function renderCanvas() {
  document.getElementById('canvas-hint').textContent = state.contours.length
    ? 'Tool: ' + state.tool + ' — click a line to select it.'
    : 'Load a CSV to begin.';

  // Contours
  const projectedContours = state.contours
    .filter(c => c.visible)
    .map(c => ({ ...c, px: c.coords.map(([x, y]) => project(x, y)) }));

  // Fat invisible hit strokes underneath so clicks near a contour register
  // easily. non-scaling-stroke keeps the hit area ~constant in screen space
  // at any zoom level, so it's just as forgiving zoomed way out as in.
  const hitboxes = contourHitLayer.selectAll('path.contour-hit').data(projectedContours, d => d.id);
  hitboxes.exit().remove();
  const hitboxesEnter = hitboxes.enter().append('path')
    .attr('class', 'contour-hit')
    .attr('fill', 'none')
    .attr('stroke', 'transparent')
    .attr('stroke-width', 16)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round')
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('pointer-events', 'stroke')
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation();
      if (state.tool === 'add') {
        insertVertexAt(d, event);
      } else if (state.tool === 'cut') {
        deleteSegmentAt(d, event);
      } else {
        selectContour(d.id);
      }
    });
  hitboxesEnter.merge(hitboxes)
    .attr('d', d => lineGen(d.px) + (d.closed ? 'Z' : ''));

  const paths = contoursLayer.selectAll('path.contour').data(projectedContours, d => d.id);
  paths.exit().remove();
  const pathsEnter = paths.enter().append('path')
    .attr('class', 'contour')
    .attr('fill', 'none')
    // Clicks go to the hit layer below; the visible line stays out of the
    // way so the hit target doesn't shrink to the line's real thickness.
    .attr('pointer-events', 'none');
  pathsEnter.merge(paths)
    .attr('d', d => lineGen(d.px) + (d.closed ? 'Z' : ''))
    .attr('stroke', d => colorForLevel(d.level))
    .attr('stroke-width', d => d.id === state.selectedId ? 3 : 1.6)
    .attr('opacity', d => d.id === state.selectedId ? 1 : 0.85);

  // Points
  const ptData = state.showPoints ? state.points.map(p => ({ ...p, px: project(p.x, p.y) })) : [];
  const circles = pointsLayer.selectAll('circle.pt').data(ptData, (d, i) => d.id || i);
  circles.exit().remove();
  circles.enter().append('circle')
    .attr('class', 'pt')
    .attr('r', 2.5)
    .attr('fill', '#ffffff')
    .attr('stroke', '#000')
    .attr('stroke-width', 0.4)
    .append('title')
    .text(d => `${d.id}: ${d.z}mm`);
  pointsLayer.selectAll('circle.pt')
    .attr('cx', d => d.px[0])
    .attr('cy', d => d.px[1]);
  pointsLayer.selectAll('circle.pt title').text(d => `${d.id}: ${d.z}mm`);

  renderVertices();
}

function selectContour(id) {
  state.selectedId = id;
  const c = state.contours.find(x => x.id === id);
  document.getElementById('smooth-slider').value = 0;
  document.getElementById('smooth-value').textContent = '0';
  renderCanvas();
  highlightLegend();
}

function renderVertices() {
  vertexLayer.selectAll('*').remove();
  // Show vertices for every editing tool that operates on a selected line —
  // including 'add', where they're just reference dots so you can see the
  // existing spacing while choosing where to insert.
  if (state.tool !== 'select' && state.tool !== 'delete' && state.tool !== 'add') return;
  const c = state.contours.find(x => x.id === state.selectedId);
  if (!c || !c.visible) return;
  const verts = c.coords.map((pt, i) => ({ i, x: pt[0], y: pt[1] }));
  const g = vertexLayer.selectAll('circle.vertex').data(verts, d => d.i);
  const drag = d3.drag()
    // Subject must be given in the SAME coordinate space as the pointer d3
    // will report — that is, the world/pixel space cx/cy live in, not the
    // datum's data-space (x,y). Without this override d3.drag treats the
    // raw data-space (x,y) as the on-screen position and the vertex jumps
    // by that huge offset on the first move.
    .subject(function (event, d) {
      const [wx, wy] = project(d.x, d.y);
      return { x: wx, y: wy };
    })
    .on('start', function () { d3.select(this).attr('r', 5); })
    .on('drag', function (event, d) {
      const [x, y] = unproject(event.x, event.y);
      c.coords[d.i] = [x, y];
      d3.select(this).attr('cx', event.x).attr('cy', event.y);
      contoursLayer.selectAll('path.contour').filter(p => p.id === c.id)
        .attr('d', c.coords.map(p => project(...p)).map((p, idx) => (idx === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ') + (c.closed ? 'Z' : ''));
    })
    .on('end', function () { d3.select(this).attr('r', 3.5); renderCanvas(); });

  const isAdd = state.tool === 'add';
  const cursor = state.tool === 'delete' ? 'not-allowed'
    : isAdd ? 'crosshair'
    : 'grab';

  g.enter().append('circle')
    .attr('class', 'vertex')
    // Smaller + green in add mode so they read as "existing reference
    // points" rather than "grab handles". pointer-events: none lets clicks
    // pass through to the line's hit stroke below so insertion still works.
    .attr('r', isAdd ? 2.5 : 3.5)
    .attr('fill', isAdd ? '#3ecf8e' : '#fff')
    .attr('stroke', isAdd ? '#3ecf8e' : '#4f9dff')
    .attr('stroke-width', 1.5)
    .attr('opacity', isAdd ? 0.85 : 1)
    .attr('cx', d => project(d.x, d.y)[0])
    .attr('cy', d => project(d.x, d.y)[1])
    .style('cursor', cursor)
    .style('pointer-events', isAdd ? 'none' : null)
    .call(state.tool === 'select' ? drag : d3.drag().on('start', () => {}))
    .on('click', (event, d) => {
      if (state.tool === 'delete') {
        event.stopPropagation();
        const minLen = c.closed ? 3 : 2;
        if (c.coords.length > minLen) {
          c.coords.splice(d.i, 1);
          renderCanvas();
        }
      }
    });
}

function insertVertexAt(d, event) {
  const c = state.contours.find(x => x.id === d.id);
  const [mx, my] = d3.pointer(event, zoomLayer.node());
  const [dataX, dataY] = unproject(mx, my);
  // Segment count: n-1 for an open line, n (including the wrap-around
  // closing segment back to vertex 0) for a closed loop.
  const segCount = c.closed ? c.coords.length : c.coords.length - 1;
  let bestSeg = 0, bestDist = Infinity;
  for (let i = 0; i < segCount; i++) {
    const [x1, y1] = c.coords[i];
    const [x2, y2] = c.coords[(i + 1) % c.coords.length];
    const dist = pointToSegmentDist(dataX, dataY, x1, y1, x2, y2);
    if (dist < bestDist) { bestDist = dist; bestSeg = i; }
  }
  c.coords.splice(bestSeg + 1, 0, [dataX, dataY]);
  selectContour(c.id);
}

// Delete the segment nearest the click.
// - Closed loop: opens the loop at that seam (same vertices, rotated so the
//   vertex right after the cut becomes vertex 0; closed -> false).
// - Open line: splits into two shorter open lines, or trims one endpoint if
//   the cut is at the very first/last segment, or vanishes entirely if the
//   line only had one segment left.
// The cut is treated as a topology change, so `original` is rewritten to
// match — "Reset selected line" restores the post-cut baseline, not the
// pre-cut shape.
function deleteSegmentAt(d, event) {
  const idx = state.contours.findIndex(x => x.id === d.id);
  if (idx < 0) return;
  const c = state.contours[idx];
  const [mx, my] = d3.pointer(event, zoomLayer.node());
  const [dataX, dataY] = unproject(mx, my);
  const n = c.coords.length;
  const segCount = c.closed ? n : n - 1;
  if (segCount < 1) return;

  let bestSeg = 0, bestDist = Infinity;
  for (let i = 0; i < segCount; i++) {
    const [x1, y1] = c.coords[i];
    const [x2, y2] = c.coords[(i + 1) % n];
    const dist = pointToSegmentDist(dataX, dataY, x1, y1, x2, y2);
    if (dist < bestDist) { bestDist = dist; bestSeg = i; }
  }

  if (c.closed) {
    const k = bestSeg;
    const rotated = c.coords.slice(k + 1).concat(c.coords.slice(0, k + 1));
    c.coords = rotated;
    c.original = rotated.map(p => p.slice());
    c.closed = false;
  } else {
    const k = bestSeg;
    const first = c.coords.slice(0, k + 1);
    const second = c.coords.slice(k + 1);
    const firstOk = first.length >= 2;
    const secondOk = second.length >= 2;

    if (firstOk && secondOk) {
      c.coords = first;
      c.original = first.map(p => p.slice());
      state.contours.splice(idx + 1, 0, {
        id: state.nextId++,
        level: c.level,
        original: second.map(p => p.slice()),
        coords: second.map(p => p.slice()),
        closed: false,
        visible: c.visible,
      });
    } else if (firstOk) {
      c.coords = first;
      c.original = first.map(p => p.slice());
    } else if (secondOk) {
      c.coords = second;
      c.original = second.map(p => p.slice());
    } else {
      state.contours.splice(idx, 1);
      if (state.selectedId === c.id) state.selectedId = null;
    }
  }

  renderLegend();
  renderCanvas();
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

svg.on('click', () => { /* click on empty canvas: no-op, keep selection */ });

// ---------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------
function setTool(tool) {
  state.tool = tool;
  ['select', 'add', 'delete', 'cut'].forEach(t => {
    document.getElementById('btn-tool-' + t).classList.toggle('active', t === tool);
  });
  renderCanvas();
}
document.getElementById('btn-tool-select').addEventListener('click', () => setTool('select'));
document.getElementById('btn-tool-add').addEventListener('click', () => setTool('add'));
document.getElementById('btn-tool-delete').addEventListener('click', () => setTool('delete'));
document.getElementById('btn-tool-cut').addEventListener('click', () => setTool('cut'));
setTool('select');

// ---------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------
function renderLegend() {
  const legend = document.getElementById('legend');
  legend.innerHTML = '';
  state.levels.forEach(level => {
    const row = document.createElement('div');
    row.className = 'legend-item';
    row.dataset.level = level;
    const linesAtLevel = state.contours.filter(c => c.level === level);
    const visible = linesAtLevel.every(c => c.visible);
    if (!visible) row.classList.add('hidden');
    row.innerHTML = `<span class="swatch" style="background:${colorForLevel(level)}"></span><span>${level}mm (${linesAtLevel.length} line${linesAtLevel.length !== 1 ? 's' : ''})</span>`;
    row.addEventListener('click', () => {
      const newVisible = !linesAtLevel.every(c => c.visible);
      linesAtLevel.forEach(c => c.visible = newVisible);
      renderLegend();
      renderCanvas();
    });
    legend.appendChild(row);
  });
}

function highlightLegend() {
  const c = state.contours.find(x => x.id === state.selectedId);
  document.querySelectorAll('.legend-item').forEach(el => {
    el.classList.toggle('selected', c && +el.dataset.level === c.level);
  });
}

// ---------------------------------------------------------------------
// Smoothing (Chaikin corner-cutting), applied from the ORIGINAL traced
// line each time the slider moves, so it's a non-destructive preview.
// ---------------------------------------------------------------------
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
function lerp(p0, p1, t) { return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]; }

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

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------
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

window.addEventListener('resize', () => { if (state.projection) fitView(); });

// ---------------------------------------------------------------------
// Underlays panel: LINZ API key, basemap style, opacity.
// ---------------------------------------------------------------------
const apiKeyInput = document.getElementById('linz-api-key');
apiKeyInput.value = basemap.apiKey;
apiKeyInput.addEventListener('input', () => {
  basemap.apiKey = apiKeyInput.value.trim();
  localStorage.setItem('linzBasemapsApiKey', basemap.apiKey);
  renderBasemap();
});

document.getElementById('basemap-style').addEventListener('change', (e) => {
  basemap.style = e.target.value;
  renderBasemap();
});

const opacitySlider = document.getElementById('basemap-opacity');
const opacityValueEl = document.getElementById('basemap-opacity-value');
opacitySlider.addEventListener('input', () => {
  basemap.opacity = parseInt(opacitySlider.value, 10) / 100;
  opacityValueEl.textContent = opacitySlider.value + '%';
  // Only the opacity attr needs updating — no need to recompute tile layout.
  linzBasemapLayer.selectAll('image').attr('opacity', basemap.opacity);
});
