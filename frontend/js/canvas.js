/* Canvas: the SVG, the D3 layer stack, pan/zoom, and fit-to-view.
 * d3 is loaded globally via the CDN <script>, so it's referenced as a global.
 *
 * onZoom(cb) lets other modules (basemap, dwg) react to pan/zoom without
 * canvas.js having to import them — avoids a circular dependency. */
import { state } from './state.js';

export const svg = d3.select('#canvas-svg');
export const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

// Underlays paint below everything else. A group of groups so each underlay
// source (LINZ basemap raster, georeferenced DWG) gets its own child layer.
export const underlaysLayer = zoomLayer.append('g').attr('class', 'underlays-layer');
export const linzBasemapLayer = underlaysLayer.append('g').attr('class', 'linz-basemap-layer');
export const dwgLayer = underlaysLayer.append('g').attr('class', 'dwg-layer');

// Hit layer sits below the visible line layer so clicks land on the fat
// invisible strokes, but the crisp visible lines paint on top of them.
export const contourHitLayer = zoomLayer.append('g').attr('class', 'contour-hit-layer');
export const contoursLayer = zoomLayer.append('g').attr('class', 'contours-layer');
export const pointsLayer = zoomLayer.append('g').attr('class', 'points-layer');
export const vertexLayer = zoomLayer.append('g').attr('class', 'vertex-layer');

export const lineGen = d3.line().x(d => d[0]).y(d => d[1]);

const zoomListeners = [];
export function onZoom(cb) { zoomListeners.push(cb); }

export const zoomBehavior = d3.zoom().scaleExtent([0.1, 40]).on('zoom', (event) => {
  zoomLayer.attr('transform', event.transform);
  zoomListeners.forEach(cb => cb());
});
svg.call(zoomBehavior);
svg.on('click', () => { /* click on empty canvas: no-op, keep selection */ });

export function fitView() {
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
window.addEventListener('resize', () => { if (state.projection) fitView(); });
