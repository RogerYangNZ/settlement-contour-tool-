# CLAUDE.md

Guidance for working in this repo. Keep it current when architecture or workflow changes.

## What this is

A single-user local web tool that turns a CSV of survey points (easting, northing,
settlement value) into contour lines via IDW interpolation, lets you hand-edit and
smooth them in the browser, optionally overlays a georeferenced basemap / CAD drawing,
and exports the result to DXF for QGIS/ArcGIS. See `README.md` for the user-facing
description.

## Running it

Backend serves both the API and the frontend (no separate frontend server, no build step).

```bash
cd backend
python3 -m venv .venv        # first time only
source .venv/bin/activate    # every new shell — pip/uvicorn are NOT global on macOS
pip install -r requirements.txt   # first time only
uvicorn app:app --reload --port 8420
```

Then open http://127.0.0.1:8420. The `.venv` living in `backend/` is the expected setup;
if `pip`/`uvicorn` are "command not found", the venv isn't activated.

## Architecture

**Backend** (`backend/`, FastAPI + Python 3.10+):
- `app.py` — app assembly only: wires routers, serves `frontend/index.html` at `/` and
  static assets at `/static`. Add new endpoints as routers, not here.
- `routers/` — one module per feature area, each an `APIRouter(prefix="/api")`:
  `contours.py` (`/parse-csv`, `/generate`), `export.py` (`/export`),
  `dwg.py` (`/import-dwg` underlay, `/import-contours` editable contours),
  `utilities.py` (`/import-utilities` ArcGIS `.lpkx` underlay).
- `schemas.py` — all pydantic request models, shared across routers.
- `interpolation.py` — IDW scattered points → regular grid (pure numpy). Self-contained
  behind `build_grid`/`idw_interpolate` so a kriging alternative could be swapped in.
- `contouring.py` — grid → contour lines via `contourpy` (matplotlib's engine).
- `dxf_export.py` — contours → DXF via `ezdxf` (one layer per level, Z = settlement value).
- `dwg_import.py` — DWG/DXF drawing → flat polylines (`load_drawing`, underlay) **and**
  → editable contours keeping level + closure (`load_contours`); see "DWG import" below.
- `lpkx_import.py` — ArcGIS `.lpkx` layer package → flat polylines/points (`load_utilities`,
  underlay only, not editable); see "Utilities (.lpkx) import" below.

**Frontend** (`frontend/`, vanilla ES modules + D3 via CDN — no bundler, no npm):
- `index.html` — the whole UI. The sidebar is four **collapsible groups**
  (`.group` > `.group-header` toggle > `.group-body` of `.subsection` blocks):
  Data (CSV load / contour import / interpolation), Underlays, Edit, Export. Loads
  `config.js` then `js/main.js` as a module.
- `js/main.js` — entry point; calls each module's `init*()` once on load.
- `js/panel.js` — collapsible-group behavior; `revealGroup`/`showGroup`/`expandGroup`
  drive progressive disclosure (groups start hidden until their prerequisite is met).
- `js/state.js` — the single shared mutable `state` object; nearly every module imports it.
- `js/canvas.js` — the SVG, the D3 layer stack (draw order matters — see below), pan/zoom
  behavior, and `fitView`. Exposes `onZoom(cb)` so modules react to pan/zoom without
  canvas.js importing them (avoids circular deps).
- `js/projection.js` — data space (easting/northing) ↔ fixed "world pixel" space.
- `js/render.js` — main canvas draw (contours + hit strokes + points).
- Feature modules: `csv.js`, `contours.js` (exports `loadContours`, the shared
  generate/import ingest), `importContours.js` (DXF contours → editable, no CSV needed),
  `editing.js`, `smoothing.js`, `simplify.js` (Douglas–Peucker vertex reduction),
  `export.js`, `legend.js`, `basemap.js` (LINZ tiles),
  `dwg.js` (CAD underlay), `utilities.js` (ArcGIS `.lpkx` underlay, multiple layers at
  once, unlike `dwg.js`'s single drawing). Helpers: `colors.js`, `dom.js`.
- `config.js` — optional `window.APP_CONFIG.LINZ_API_KEY`. Served to the browser, so
  never commit a real key; the UI also accepts a key into localStorage.

## Key conventions (non-obvious)

- **Coordinates.** All survey/contour/CAD data is in NZTM2000 (EPSG:2193) easting/northing,
  used directly with no reprojection — the DXF/DWG and CSV are already in that grid.
  `projection.js` maps data → a fixed 1000-unit "world pixel" space; the D3 zoom transform
  on `zoomLayer` handles pan/zoom on top. Keep all editing math in data coordinates.
- **SVG layer order** (from `canvas.js`, back→front): underlays (LINZ basemap raster, then
  DWG vectors, then ArcGIS utility lines) → contour hit strokes → contour lines → points →
  vertices. Fat transparent "hit strokes" sit *below* the thin visible lines so clicks are
  forgiving; visible lines have `pointer-events: none`. Preserve this when adding layers.
- **Vector underlays pan/zoom for free** because they live inside `zoomLayer`; only the
  raster basemap re-fetches per view (`onZoom`). Use `vector-effect: non-scaling-stroke`
  to keep line width constant across zoom.
- **Closed contours**: the tracer duplicates the first point at the end; `contours.js`
  drops that duplicate and tracks closure with an explicit `closed` flag + SVG `Z`.
- **Three geometry copies per contour**: `traced` (full tracer/import detail, never shown),
  `original` (= `traced` simplified at the vertex-reduction tolerance; the baseline that
  smoothing and "Reset" work from), and `coords` (what's drawn, edited and exported).
  The tracer emits one vertex per grid-cell crossing, so lines are simplified on load
  (default tolerance 0.3% of the extent diagonal). Anything that rewrites `original`
  (e.g. the segment cut) must rewrite `traced` too.

## DWG import

`.dwg` is a closed binary format. Pipeline: `dwg2dxf` (GNU LibreDWG, a **system binary** —
`brew install libredwg`, not a pip package) converts DWG→DXF, then `ezdxf` parses it and
`ezdxf.path.make_path(e).flattening()` reduces every entity (lines, arcs, circles, splines,
and block INSERTs via `virtual_entities`) to plain polylines. `.dxf` uploads skip conversion.

Gotcha handled in `dwg_import.py`: LibreDWG sometimes emits a GEODATA object with a
mismatched source/target mesh; ezdxf's strict loader then rejects the *whole* file. We
monkeypatch `GeoData.load_mesh_data` at import time to truncate the mesh instead of raising,
and keep a `recover.readfile` fallback. Don't remove these without a replacement.

**Contour import** (`load_contours`, `/import-contours`) reuses the same convert/flatten
pipeline but, unlike the underlay path, keeps each entity's **level** and **closure** so
lines come back editable. Level is auto-detected, first hit wins: XDATA (this tool's own
`XDATA_APP_ID` stamp — imported from `dxf_export.py` so read/write stay in sync) → Z /
`elevation` → number parsed from the layer name → nearest numeric TEXT label → `0.0`.
Frontend feeds the result to the same `loadContours` pipeline as CSV-generated contours,
so it works with no CSV loaded (bounds/projection come from the DXF).

Gotcha handled in `_flatten_entity`/`_flatten_spline`: some CAD contour exports store lines
as **very high-degree SPLINEs** (e.g. degree 11). ezdxf's C-accelerated evaluator caps the
spline order (`MAX_SPLINE_ORDER`) and raises `ValueError("invalid order")`, which would
otherwise silently drop the entity (→ "No contour lines found"). We fall back to ezdxf's
pure-Python `Basis`/`Evaluator` and mirror its adaptive-subdivision flattening. Both the
underlay and contour-import paths share this flattener.

## Utilities (.lpkx) import

ArcGIS "compact" layer packages (`.lpkx`) are **7z archives** (not zip — check with `file`
if a new sample looks unreadable), containing a File Geodatabase nested a few levels down
(e.g. `commondata/<name>.gdb`) plus `.lyrx` symbology we don't use. Pipeline in
`lpkx_import.py`: `py7zr` extracts the archive (pure Python, no system `7z` binary needed),
then `pyogrio` reads the geodatabase directly — its PyPI wheel bundles GDAL with the
open-source OpenFileGDB driver, so no ArcGIS license or separate GDAL/brew install is
required. Geometry is read with `pyogrio.raw.read(..., columns=[])` (not
`read_dataframe`, which needs `geopandas`) and flattened with `shapely.from_wkb`.

Unlike DWG (already in NZTM, passed through untouched), a `.gdb` layer carries its own CRS,
so each layer is reprojected to EPSG:2193 with `pyproj` when its CRS is defined and
different; a layer with no CRS at all is passed through as-is with a note added to the
response's `warnings` list, rather than failing. The sample data in
`sample_data/Utilities/` is already EPSG:2193, so reprojection is a no-op there in
practice but still guards against a differently-sourced package.

This is underlay-only, like `load_drawing` — no editable levels, no export. Styling is
**not** derived from the package's `.lyrx` renderer; the frontend (`utilities.js`) applies
its own fixed colour-coding per uploaded file instead (wet/dry → colour, GHELLA/Open
Source → solid/dashed), since several `.lpkx` files load and toggle independently (unlike
`dwg.js`'s single-drawing model).

## Testing / verifying

No automated test suite. Verify changes by running the server and driving the UI, or with
one-off Python against the modules (activate the venv first). Backend endpoints can be
smoke-tested with `curl` against `:8420`. A sample dataset lives in `sample_data/`.

## Git

Default branch `main`. Feature work happens on branches (e.g. `dwg-import`). `.venv/`,
`__pycache__/`, `.DS_Store`, and exported `*.dxf` are gitignored.
