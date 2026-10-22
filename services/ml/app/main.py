from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app import model as model_store
from app.features import extract_features, feature_vector

HISTORY_CAP = 24
DEFAULT_SEED = 42
DEFAULT_N_SAMPLES = 4000
MAX_N_SAMPLES = 200_000
RESPONSE_FEATURE_KEYS = [
    "capacityRatio",
    "hourOfDay",
    "deltaVsPrevKwh",
    "rollingMeanKwh",
    "rollingStdKwh",
    "zScore",
    "balanceResidualKwh",
]

_state: dict[str, Any] = {"artifact": None}
_lock = threading.Lock()


def _model_dir() -> str:
    return os.environ.get("ML_MODEL_DIR", "./models")


@asynccontextmanager
async def lifespan(app: FastAPI):
    artifact = model_store.load_artifact(_model_dir())
    if artifact is not None:
        _state["artifact"] = artifact
    yield


app = FastAPI(title="tranergy-ml", version="1.0.0", lifespan=lifespan)


class IntervalReading(BaseModel):
    intervalStart: str
    intervalEnd: str
    generationKwh: float
    consumptionKwh: float = 0.0
    importKwh: float = 0.0
    exportKwh: float = 0.0
    batteryChargeKwh: float = 0.0
    batteryDischargeKwh: float = 0.0
    balanceResidualKwh: float | None = None


class TrainRequest(BaseModel):
    seed: int = 42
    nSamples: int = Field(default=4000, ge=100, le=MAX_N_SAMPLES)
    force: bool = False


class ScoreRequest(BaseModel):
    facilityId: str
    capacityKw: float = Field(gt=0)
    target: IntervalReading
    history: list[IntervalReading] = Field(default_factory=list)
    missingIntervals: int = 0


def _train_summary(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        "modelVersion": artifact["modelVersion"],
        "nTrain": artifact["nTrain"],
        "nTest": artifact["nTest"],
        "metrics": {k: round(float(v), 4) for k, v in artifact["metrics"].items()},
        "trainedAt": artifact["trainedAt"],
    }


def _ensure_artifact() -> dict[str, Any]:
    with _lock:
        artifact = _state["artifact"]
        if artifact is not None:
            return artifact
        try:
            artifact = model_store.train_model(DEFAULT_SEED, DEFAULT_N_SAMPLES, _model_dir())
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail={"error": {"code": "ML_UNAVAILABLE", "message": f"model training failed: {exc}"}},
            ) from exc
        _state["artifact"] = artifact
        return artifact


def _code_for_status(status_code: int) -> str:
    mapping = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        503: "ML_UNAVAILABLE",
    }
    return mapping.get(status_code, "INTERNAL_ERROR")


@app.get("/health")
def health() -> dict[str, Any]:
    artifact = _state["artifact"]
    return {
        "ok": True,
        "service": "tranergy-ml",
        "modelVersion": artifact["modelVersion"] if artifact else None,
        "trained": artifact is not None,
        "nTrain": artifact["nTrain"] if artifact else None,
    }


@app.post("/train")
def train(request: TrainRequest) -> dict[str, Any]:
    with _lock:
        artifact = _state["artifact"]
        if artifact is not None and not request.force:
            return _train_summary(artifact)
        try:
            artifact = model_store.train_model(request.seed, request.nSamples, _model_dir())
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"training failed: {exc}") from exc
        _state["artifact"] = artifact
        return _train_summary(artifact)


@app.post("/score")
def score(request: ScoreRequest) -> dict[str, Any]:
    artifact = _ensure_artifact()
    history = [reading.model_dump() for reading in request.history[-HISTORY_CAP:]]
    target = request.target.model_dump()
    features = extract_features(target, history, request.capacityKw, request.missingIntervals)
    anomaly_score, model_flagged = model_store.score_row(artifact, feature_vector(features))
    reason_codes = model_store.reason_codes(features, request.target.generationKwh, request.missingIntervals)
    flagged = bool(model_flagged or reason_codes)
    return {
        "anomalyScore": round(anomaly_score, 4),
        "isAnomaly": model_flagged,
        "flagged": flagged,
        "mlStatus": "ANOMALY_FLAGGED" if flagged else "OK",
        "reasonCodes": reason_codes,
        "modelVersion": artifact["modelVersion"],
        "features": {name: features[name] for name in RESPONSE_FEATURE_KEYS},
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail:
        body = detail
    else:
        body = {"error": {"code": _code_for_status(exc.status_code), "message": str(detail)}}
    return JSONResponse(status_code=exc.status_code, content=body)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": {"code": "BAD_REQUEST", "message": str(exc.errors())}},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": str(exc)}},
    )
