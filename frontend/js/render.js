/* Main canvas render: contours (with fat invisible hit strokes), survey
 * points, and delegated vertex rendering. */
import { state } from './state.js';
import { project } from './projection.js';
import { colorForLevel } from './colors.js';
import { contourHitLayer, contoursLayer, pointsLayer, lineGen } from './canvas.js';
import { insertVertexAt, deleteSegmentAt, selectContour, renderVertices } from './editing.js';

export function renderCanvas() {
  document.getElementById('canvas-hint').textContent = state.contours.length
    ? 'Tool: ' + state.tool + ' — click a line to select it.'
    : 'Load a basemap, drawing, or CSV to begin.';

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

export function initRender() {
  document.getElementById('btn-toggle-points').addEventListener('click', () => {
    state.showPoints = !state.showPoints;
    renderCanvas();
  });
}
