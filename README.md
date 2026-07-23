# Settlement Contour Tool

Turns a CSV of survey points (easting, northing, settlement/displacement
value) into contour lines by IDW interpolation, lets you manually edit and
smooth those contours in the browser, and exports the result to a DXF file
that imports cleanly into QGIS or ArcGIS.

There's no single existing open-source tool that does this whole pipeline —
this combines mature open-source building blocks (numpy for interpolation,
`contourpy` — the same engine matplotlib uses — for contour tracing, `ezdxf`
for DXF output) with a lightweight custom web UI for the manual editing step,
since nothing off the shelf offered that combination.

## What it does

1. **Upload a CSV** — any column names; you map which columns are
   easting (X), northing (Y), and settlement value (Z) after upload.
2. **Interpolate** — Inverse Distance Weighting (IDW) builds a smooth
   surface from the scattered points, on a configurable grid resolution.
3. **Contour** — traces lines at any interval you choose (default 5mm, but
   you can set 3mm, 10mm, anything).
4. **Edit by hand** — drag vertices, insert new ones by clicking on a line,
   delete vertices, and apply a Chaikin corner-cutting smoothing slider per
   line or to everything at once.
5. **Export to DXF** — one layer per contour level (e.g. `SETTLEMENT_5`,
   `SETTLEMENT_10`), each polyline's elevation (Z) set to the settlement
   value, plus optional survey point markers and labels. Opens directly in
   QGIS/ArcGIS as a normal DXF vector layer.

## Running it

Requires Python 3.10+.

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8420
```

Then open **http://127.0.0.1:8420** in a browser.

## CSV format

Any CSV with at least three numeric columns: easting, northing, and
settlement value (any units — the interval you set in the UI should match,
e.g. millimetres). A header row is expected; a sample is provided at
`sample_data/sample_settlement.csv`. Column mapping happens in the UI after
upload, so header names don't need to match anything specific.

## Notes on the DXF output

- Coordinates are written as-is (no reprojection) — since northing/easting
  are already a projected/local grid, this is a direct 1:1 cartesian
  mapping into DXF space.
- Each contour level gets its own DXF layer, which is what QGIS/ArcGIS use
  to let you filter, symbolise, or query by settlement value after import.
- Elevation (Z) is also embedded on each polyline as the settlement value,
  for tools that read Z directly (e.g. QGIS's "Set Z value from
  attribute"/3D view, or any DXF viewer that respects entity elevation).
- Closed contour loops (e.g. a settlement "bowl") export as closed
  polylines; open lines that run off the edge of your survey extent export
  as open polylines. This is preserved correctly through manual edits.

## Interpolation method

IDW was chosen for this build because it runs efficiently server-side in
plain numpy with no extra dependencies, is intuitive to control (a single
"power" parameter), and works well for the kind of moderate-sized scattered
monitoring-point datasets settlement surveys typically produce. If you later
want geostatistical kriging (which models spatial correlation rather than
pure distance decay), `interpolation.py` is a self-contained module — a
`pykrige`-based alternative could be swapped in behind the same
`build_grid`/interpolate interface without touching the rest of the app.

## Project structure

```
settlement-contour-tool/
  backend/
    interpolation.py   IDW: scattered points -> regular grid
    contouring.py        grid -> contour lines (contourpy) at any interval
    dxf_export.py         contours -> DXF (layer per level, elevation embedded)
    app.py                 FastAPI app: /api/generate, /api/export, serves frontend
    requirements.txt
  frontend/
    index.html             upload, column mapping, settings, legend, edit tools
    app.js                   D3-based rendering, pan/zoom, vertex editing, smoothing
    style.css
  sample_data/
    sample_settlement.csv  synthetic test data (60 points, bowl-shaped settlement)
```
