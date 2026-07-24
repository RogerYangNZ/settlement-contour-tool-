/* LINZ Basemaps underlay (NZTM 2000 tile scheme). No proj4 needed — the
 * tiles are served natively in the same CRS the contour data is in, so
 * alignment is a straight NZTM-to-world-pixel projection using project(). */
import { state } from './state.js';
import { project, unproject } from './projection.js';
import { svg, linzBasemapLayer, onZoom } from './canvas.js';

// NZTM2000Quad TileMatrixSet parameters, taken directly from LINZ's published
// WMTSCapabilities: TopLeftCorner = "10438190.1652 -3260586.7284" (EPSG:2193
// axis order is Northing, Easting, so northing=10438190.1652,
// easting=-3260586.7284). z0 extent = z0 ScaleDenominator(139770566.007179)
// * 0.00028 m/px * 256.
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
const NZTM_M_PER_TILEPX_Z0 = NZTM_TMS.extentAtZ0 / NZTM_TMS.tileSizePx;

// API key priority: config.js (authoritative) -> localStorage (UI paste) -> empty.
export const basemap = {
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

export function renderBasemap() {
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

export function initBasemap() {
  // Redraw tiles on every pan/zoom.
  onZoom(renderBasemap);

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
}
