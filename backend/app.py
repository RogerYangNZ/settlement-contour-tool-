"""
Settlement Contour Tool — FastAPI backend (app assembly only).

Endpoints live in routers/:
  routers/contours.py -> /api/parse-csv, /api/generate
  routers/export.py   -> /api/export
  routers/dwg.py      -> /api/import-dwg

This module just wires the app together and serves the frontend.

Run with:
  uvicorn app:app --reload --port 8420
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from routers import contours, dwg, export

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = FastAPI(title="Settlement Contour Tool")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(contours.router)
app.include_router(export.router)
app.include_router(dwg.router)


@app.get("/", response_class=HTMLResponse)
def index():
    return (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
