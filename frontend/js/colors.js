/* Contour level -> colour (green low -> yellow -> red high), mirroring the
 * DXF exporter's colour ramp so screen and file agree. */
import { state } from './state.js';

export const COLORS = ['#4f9dff', '#3ecf8e', '#f4d35e', '#ff9a4a', '#ff6b4a', '#c77dff', '#7dd3fc', '#f472b6'];

export function colorForLevel(level) {
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
