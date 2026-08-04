/* Import a contour DXF/DWG as editable contours. Unlike the DWG *underlay*
 * (dwg.js), this parses each line back into an editable contour with a detected
 * level, then hands it to the shared loadContours() pipeline — so you can open a
 * contour DXF, reshape it, and re-export, with no CSV loaded. */
import { setStatus } from './dom.js';
import { loadContours } from './contours.js';

async function importFile(file) {
  if (!file) return;
  setStatus('contour-import-status', `Importing ${file.name}…`, '');
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/import-contours', { method: 'POST', body: form });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    const data = await res.json();
    const levels = [...new Set(data.contours.map(c => c.level))].sort((a, b) => a - b);
    loadContours({ contours: data.contours, levels, bounds: data.bounds });
    setStatus('contour-import-status',
      `Imported ${data.contour_count} contours at ${levels.length} level${levels.length === 1 ? '' : 's'}`, 'ok');
  } catch (err) {
    setStatus('contour-import-status', 'Error: ' + err.message, 'error');
  }
}

export function initImportContours() {
  const input = document.getElementById('contour-import-input');
  input.addEventListener('change', () => {
    importFile(input.files[0]);
    input.value = '';   // allow re-importing the same file
  });
}
