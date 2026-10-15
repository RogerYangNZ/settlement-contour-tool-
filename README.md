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
   delete vertices or whole segments, and apply a Chaikin corner-cutting
   smoothing slider per line or to everything at once. Lines are thinned to
   far fewer vertices on load (Douglas–Peucker) so they're easy to edit; a
   "Vertex reduction" slider tunes how much.
5. **Overlay underlays** (optional) — a georeferenced site drawing (DWG/DXF),
   ArcGIS utility layer packages (`.lpkx`), and/or the LINZ aerial basemap,
   all in the same easting/northing (NZTM) as your survey points, rendered
   read-only behind the contours for site context.
6. **Export to DXF** — one layer per contour level (e.g. `SETTLEMENT_5`,
   `SETTLEMENT_10`), each polyline's elevation (Z) set to the settlement
   value, plus optional survey point markers and labels. Opens directly in
   QGIS/ArcGIS as a normal DXF vector layer.

## Running it

Requires Python 3.10+.

**First-time setup** (creates an isolated virtual environment so `pip`/`uvicorn`
are available — on macOS they aren't installed globally):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8420
```

**Every time after that**, just activate the environment and run:

```bash
cd backend
source .venv/bin/activate
uvicorn app:app --reload --port 8420
```

Then open **http://127.0.0.1:8420** in a browser. Stop the server with `Ctrl+C`.

> On Windows the activate command is `.venv\Scripts\activate` instead of
> `source .venv/bin/activate`.

**Optional — DWG underlay:** to import `.dwg` drawings you also need GNU
LibreDWG's `dwg2dxf` converter on your PATH (`brew install libredwg` on macOS).
`.dxf` drawings import without it. Nothing else in the tool requires it.

## CSV format

Any CSV with at least three numeric columns: easting, northing, and
settlement value (any units — the interval you set in the UI should match,
e.g. millimetres). A header row is expected; a sample is provided at
`sample_data/Contour_CSV.csv`. Column mapping happens in the UI after
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
    dwg_import.py         DWG/DXF drawing -> flat polylines (via LibreDWG + ezdxf)
    lpkx_import.py        ArcGIS .lpkx layer package -> polylines/points (py7zr + pyogrio)
    app.py                 FastAPI app: wires the routers, serves the frontend
    routers/               contours, export, dwg, utilities, config (API endpoints)
    schemas.py             pydantic request models
    requirements.txt       just includes ../requirements.txt
  frontend/
    index.html             upload, column mapping, settings, legend, edit tools
    config.js              optional LINZ Basemaps API key
    js/                    ES modules: rendering, pan/zoom, editing, simplify, basemap, dwg, utilities
    style.css
  sample_data/
    Contour_CSV.csv        sample survey points
  requirements.txt         Python dependency pins (shared by local + Databricks)
  app.yaml                 Databricks Apps start command + env
  databricks.yml           Databricks Asset Bundle (staging / prod targets)
```

## Deploying to Databricks

The tool runs as a **Databricks App** on the Arup staging and prod workspaces,
alongside the `nz-geotechnics` geo-databricks app. It is stateless — no
Volume, no database — so deployment is just the app itself.

| Target | Workspace | App name | CLI profile |
|---|---|---|---|
| `staging` | `dbc-8244a8d2-0f15` | `settlement-contours-staging` | `staging` |
| `prod` | `dbc-660fdeaa-1f2a` | `settlement-contours-prod` | `prod` |

**One-time prerequisites**

- Databricks CLI (set up with v1.17.0; `brew install databricks/tap/databricks`), logged in to each
  workspace: `databricks auth login --profile staging` (and `--profile prod`).
  Tokens expire — if a command says the refresh token is invalid, re-run this.
- The LINZ key lives in each workspace's `geo-databricks` secret scope as
  `linz_api_key` (already created for the geo-databricks app). Optional —
  without it, users paste a key into the UI as they would locally.

**Deploy** — always staging first, then the *same* tree to prod. `bundle
deploy` ships your local working tree, not a git commit, so commit first and
make sure `git status` is clean:

```bash
databricks bundle validate -t staging
databricks bundle deploy   -t staging            # sync files, create/update the app
databricks bundle run settlement_app -t staging  # snapshot those files and (re)start
databricks apps get settlement-contours-staging -p staging   # URL + status
```

Test on the staging URL, then repeat with `-t prod`. A code change needs both
`deploy` *and* `run` — `deploy` alone uploads files while the app keeps serving
the previous snapshot. To pick up a rotated secret without shipping code, use
`databricks apps stop <app>` then `apps start <app>`.

**Access.** A new app is usable only by its creator and workspace admins. Grant
`CAN_USE` to the right group in the app's Permissions tab (or `databricks apps
update-permissions`); match whatever `nz-geotechnics-<env>` uses:
`databricks apps get-permissions nz-geotechnics-staging -p staging`.

**Differences from running locally**

- **No `.dwg` import.** It needs LibreDWG's `dwg2dxf` system binary, which the
  Apps runtime can't install. Uploading a `.dwg` shows a "save as DXF" message;
  `.dxf` drawings and contour imports work normally.
- **LINZ basemap key** comes from the workspace secret via `GET /api/config`
  (a key in `config.js` or pasted into the UI still takes priority).
- **Python 3.11** on Linux. Every pin in `requirements.txt` must have a Linux
  x86_64 wheel for 3.11 (the runtime can't compile) — the header of that file
  has a one-line check to run before bumping a version.
