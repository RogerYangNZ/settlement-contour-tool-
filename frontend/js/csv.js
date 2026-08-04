/* CSV upload, client-side parsing, column mapping, and building the point
 * list the backend interpolates. */
import { state } from './state.js';
import { setStatus } from './dom.js';

// Client-side CSV parse (handles simple quoted fields + ; and tab delimiters).
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

  document.getElementById('sub-settings').style.display = 'block';
  buildPointsFromMapping();
  ['col-x', 'col-y', 'col-z', 'col-id'].forEach(id => {
    document.getElementById(id).addEventListener('change', buildPointsFromMapping);
  });
}

export function buildPointsFromMapping() {
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
export function updateUnderlayCrsWarning() {
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

export function initCsv() {
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
}
