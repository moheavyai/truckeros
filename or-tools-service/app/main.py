"""
or-tools-service/app/main.py

FastAPI application entrypoint for TruckerOS OR-Tools Service.

- Full CORS for localhost:3000 (Next dev) + self
- Includes /routers/route.py (provides POST /optimize-route)
- Health + docs
- Lifespan logging
- Ready for uvicorn on port 8001

Run (from or-tools-service/):
  uvicorn app.main:app --reload --port 8001
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS, SERVICE_VERSION
from .routers.route import router as route_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("OR-Tools Service starting (FastAPI + ortools + public OSRM) v%s", SERVICE_VERSION)
    yield
    logger.info("OR-Tools Service shutdown")


app = FastAPI(
    title="TruckerOS OR-Tools Service",
    description="Complete OR-Tools VRP backend for OSOW-constrained route optimization. Basic + OSOW penalties + real OSRM legs + special instructions support.",
    version=SERVICE_VERSION,
    lifespan=lifespan,
)

# CORS — open for the Next.js dev server and the thin same-origin proxy
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the route router (contains /optimize-route)
app.include_router(route_router)

# Also expose health at root level for convenience
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "or-tools", "version": SERVICE_VERSION}


# Root hint
@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "TruckerOS OR-Tools Service",
        "version": SERVICE_VERSION,
        "docs": "/docs",
        "health": "/health",
        "optimize": "POST /optimize-route",
    }
