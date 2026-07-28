/* Manual editing tools: select/drag, insert vertex, delete vertex, delete
 * segment (cut), plus the tool switcher. */
import { state } from './state.js';
import { project, unproject } from './projection.js';
import { zoomLayer, contoursLayer, vertexLayer } from './canvas.js';
import { renderCanvas } from './render.js';
import { renderLegend, highlightLegend } from './legend.js';

export function selectContour(id) {
  state.selectedId = id;
  document.getElementById('smooth-slider').value = 0;
  document.getElementById('smooth-value').textContent = '0';
  renderCanvas();
  highlightLegend();
}

export function renderVertices() {
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

export function insertVertexAt(d, event) {
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
export function deleteSegmentAt(d, event) {
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

// Delete the whole selected contour line (not just a vertex or segment).
// Useful when an import brings in several lines at one level and you want to
// drop one outright. Prunes the level from the legend if it has no lines left.
export function deleteSelectedLine() {
  const idx = state.contours.findIndex(x => x.id === state.selectedId);
  if (idx < 0) return;   // nothing selected — no-op
  const { level } = state.contours[idx];
  state.contours.splice(idx, 1);
  state.selectedId = null;
  if (!state.contours.some(c => c.level === level)) {
    state.levels = state.levels.filter(l => l !== level);
  }
  renderLegend();
  renderCanvas();
}

export function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function setTool(tool) {
  state.tool = tool;
  ['select', 'add', 'delete', 'cut'].forEach(t => {
    document.getElementById('btn-tool-' + t).classList.toggle('active', t === tool);
  });
  renderCanvas();
}

export function initEditing() {
  document.getElementById('btn-tool-select').addEventListener('click', () => setTool('select'));
  document.getElementById('btn-tool-add').addEventListener('click', () => setTool('add'));
  document.getElementById('btn-tool-delete').addEventListener('click', () => setTool('delete'));
  document.getElementById('btn-tool-cut').addEventListener('click', () => setTool('cut'));
  document.getElementById('btn-delete-line').addEventListener('click', deleteSelectedLine);
  setTool('select');
}
