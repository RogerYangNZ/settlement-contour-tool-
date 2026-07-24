/* Entry point: wire up all modules once the DOM is ready. Module scripts are
 * deferred, so the DOM is parsed by the time this runs.
 *
 * Importing canvas.js for its side effects (creating the SVG layers, zoom
 * behaviour, fit/resize handlers) — the other modules import it too, but the
 * explicit import documents that it must be initialised. */
import './canvas.js';
import { initCsv } from './csv.js';
import { initGenerate } from './contours.js';
import { initEditing } from './editing.js';
import { initSmoothing } from './smoothing.js';
import { initExport } from './export.js';
import { initBasemap } from './basemap.js';
import { initRender } from './render.js';

initCsv();
initGenerate();
initEditing();     // also sets the initial tool ('select')
initSmoothing();
initExport();
initBasemap();
initRender();
