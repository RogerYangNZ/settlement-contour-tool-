/* Layer legend: one row per contour level, click to toggle visibility. */
import { state } from './state.js';
import { colorForLevel } from './colors.js';
import { renderCanvas } from './render.js';

export function renderLegend() {
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

export function highlightLegend() {
  const c = state.contours.find(x => x.id === state.selectedId);
  document.querySelectorAll('.legend-item').forEach(el => {
    el.classList.toggle('selected', c && +el.dataset.level === c.level);
  });
}
