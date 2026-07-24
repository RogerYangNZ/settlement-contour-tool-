/* Projection: data space (easting/northing) <-> a fixed "world pixel" space.
 * Pan/zoom is a separate d3 transform layered on top (see canvas.js), so all
 * editing math stays in simple data coordinates. */
import { state } from './state.js';

export function buildProjection(bounds) {
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

export function project(x, y) {
  const p = state.projection;
  return [(x - p.xMin) * p.scale, (p.yMax - y) * p.scale];
}

export function unproject(px, py) {
  const p = state.projection;
  return [px / p.scale + p.xMin, p.yMax - py / p.scale];
}
