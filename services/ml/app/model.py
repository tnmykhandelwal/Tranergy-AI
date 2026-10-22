from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import f1_score, precision_score, recall_score

from app.features import FEATURE_ORDER
from app.synthetic import Dataset, build_dataset

ARTIFACT_FILENAME = "model.joblib"
COUNTER_FILENAME = "version_counter.json"
DEFAULT_CAPACITY_KW = 150.0


def make_model() -> IsolationForest:
    return IsolationForest(contamination=0.05, random_state=42, n_estimators=200)


def invert_minmax(raw_score: float, score_min: float, score_max: float) -> float:
    span = score_max - score_min
    if span < 1e-12:
        return 0.0
    return float(min(1.0, max(0.0, (score_max - raw_score) / span)))


def evaluate(y_true: Sequence[int], y_pred: Sequence[int]) -> dict[str, float]:
    return {
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "fpr": false_positive_rate(y_true, y_pred),
    }


def false_positive_rate(y_true: Sequence[int], y_pred: Sequence[int]) -> float:
    true_arr = np.asarray(y_true)
    pred_arr = np.asarray(y_pred)
    negatives = int((true_arr == 0).sum())
    if negatives == 0:
        return 0.0
    false_positives = int(((pred_arr == 1) & (true_arr == 0)).sum())
    return false_positives / negatives


def reason_codes(features: Mapping[str, float | int], generation_kwh: float, missing_intervals: int) -> list[str]:
    codes: list[str] = []
    z = float(features["zScore"])
    if abs(z) > 4.0:
        codes.append("GEN_SPIKE_VS_ROLLING")
    if float(features["capacityRatio"]) > 1.05:
        codes.append("GEN_ABOVE_CAPACITY")
    if z < -3.0 and float(features["rollingMeanKwh"]) > 10.0:
        codes.append("GEN_COLLAPSE")
    if float(features["balanceResidualKwh"]) > 0.25 * max(generation_kwh, 0.0):
        codes.append("BALANCE_RESIDUAL_HIGH")
    if missing_intervals > 0:
        codes.append("MISSING_INTERVALS_PRESENT")
    return codes


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def next_model_version(model_dir: str) -> str:
    directory = Path(model_dir)
    directory.mkdir(parents=True, exist_ok=True)
    counter_path = directory / COUNTER_FILENAME
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    counter = 1
    if counter_path.exists():
        try:
            data = json.loads(counter_path.read_text())
            if data.get("date") == today:
                counter = int(data.get("counter", 0)) + 1
        except (ValueError, OSError, TypeError):
            counter = 1
    counter_path.write_text(json.dumps({"date": today, "counter": counter}))
    return f"iforest-{today}-v{counter}"


def save_artifact(artifact: dict[str, Any], model_dir: str) -> Path:
    directory = Path(model_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / ARTIFACT_FILENAME
    joblib.dump(artifact, path)
    return path


def load_artifact(model_dir: str) -> dict[str, Any] | None:
    path = Path(model_dir) / ARTIFACT_FILENAME
    if not path.exists():
        return None
    try:
        return joblib.load(path)
    except Exception:
        return None


def train_model(seed: int, n_samples: int, model_dir: str, capacity: float = DEFAULT_CAPACITY_KW) -> dict[str, Any]:
    dataset: Dataset = build_dataset(seed, n_samples, capacity)
    model = make_model()
    model.fit(dataset.X_train)
    raw_train = model.decision_function(dataset.X_train)
    score_min = float(np.min(raw_train))
    score_max = float(np.max(raw_train))
    predictions = (model.predict(dataset.X_test) == -1).astype(int)
    metrics = evaluate(dataset.y_test, predictions)
    artifact: dict[str, Any] = {
        "model": model,
        "featureOrder": list(FEATURE_ORDER),
        "modelVersion": next_model_version(model_dir),
        "trainedAt": utc_now_iso(),
        "nTrain": int(dataset.n_train),
        "nTest": int(dataset.n_test),
        "metrics": metrics,
        "scoreMin": score_min,
        "scoreMax": score_max,
        "seed": int(seed),
        "capacityKw": float(capacity),
    }
    save_artifact(artifact, model_dir)
    return artifact


def score_row(artifact: Mapping[str, Any], vector: Sequence[float]) -> tuple[float, bool]:
    model = artifact["model"]
    x = np.asarray([list(vector)], dtype=float)
    raw = float(model.decision_function(x)[0])
    score = invert_minmax(raw, float(artifact["scoreMin"]), float(artifact["scoreMax"]))
    flagged = bool(model.predict(x)[0] == -1)
    return score, flagged
