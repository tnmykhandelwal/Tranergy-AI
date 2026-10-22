from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

import numpy as np

from app.features import extract_features, feature_vector

SERIES_START = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
PURGE_HOURS = 6
MAX_HISTORY = 24
TRAIN_FRACTION = 0.8
DEFAULT_CAPACITY_KW = 150.0
ANOMALY_BLOCK = 8
CLEAN_BLOCK = 10

ANOMALY_TYPES: list[str] = [
    "capacity_spike",
    "midday_collapse",
    "meter_stuck",
    "balance_break",
    "gap_resume",
]


class Dataset(NamedTuple):
    X_train: np.ndarray
    X_test: np.ndarray
    y_test: np.ndarray
    n_train: int
    n_test: int


def _solar_bell(hour: float, capacity: float) -> float:
    if hour < 6.0 or hour > 18.0:
        return 0.0
    phase = (hour - 6.0) / 12.0
    return float(capacity * max(0.0, math.sin(math.pi * phase)) ** 1.2)


def generate_series(seed: int, n_hours: int, capacity: float = DEFAULT_CAPACITY_KW) -> dict[str, Any]:
    rng = np.random.RandomState(seed)
    gens = np.zeros(n_hours)
    loads = np.zeros(n_hours)
    imports = np.zeros(n_hours)
    exports = np.zeros(n_hours)
    charges = np.zeros(n_hours)
    discharges = np.zeros(n_hours)
    residuals = np.zeros(n_hours)
    missing = np.zeros(n_hours, dtype=int)
    for i in range(n_hours):
        hour = float(i % 24)
        cloud = float(np.clip(rng.lognormal(0.0, 0.08), 0.4, 1.4))
        gens[i] = _solar_bell(hour, capacity) * cloud
        base = capacity * 0.10
        office = capacity * 0.22 if 8.0 <= hour < 18.0 else 0.0
        loads[i] = max(0.0, base + office + float(rng.normal(0.0, capacity * 0.015)))
        surplus = gens[i] - loads[i]
        if surplus >= 0.0:
            exports[i] = surplus * float(0.75 + 0.15 * rng.rand())
            charges[i] = max(0.0, surplus - exports[i]) * float(0.5 * rng.rand())
            imports[i] = 0.0
        else:
            imports[i] = -surplus * float(0.80 + 0.15 * rng.rand())
            exports[i] = 0.0
        discharges[i] = 0.0
        residuals[i] = abs(float(rng.normal(0.0, 0.25)))
    labels = np.zeros(n_hours, dtype=int)
    return {
        "gens": gens,
        "loads": loads,
        "imports": imports,
        "exports": exports,
        "charges": charges,
        "discharges": discharges,
        "residuals": residuals,
        "missing": missing,
        "labels": labels,
        "anomaly_types": [],
        "capacity": float(capacity),
    }


def inject_anomalies(series: dict[str, Any], seed: int, test_start: int, n_hours: int) -> None:
    rng = np.random.RandomState(seed + 9973)
    gens = series["gens"]
    loads = series["loads"]
    imports = series["imports"]
    exports = series["exports"]
    residuals = series["residuals"]
    missing = series["missing"]
    labels = series["labels"]
    capacity = series["capacity"]
    anomaly_types: list[str] = []
    n_test = n_hours - test_start
    j = 0
    type_i = 0
    while j + ANOMALY_BLOCK <= n_test:
        g = test_start + j
        anomaly_type = ANOMALY_TYPES[type_i % len(ANOMALY_TYPES)]
        type_i += 1
        hour = g % 24
        if anomaly_type == "midday_collapse" and 7 <= hour <= 12:
            for k in range(ANOMALY_BLOCK):
                gens[g + k] = float(rng.uniform(0.0, 1.0))
                imports[g + k] = max(0.0, loads[g + k] - gens[g + k])
                exports[g + k] = 0.0
                residuals[g + k] = abs(float(rng.normal(0.0, 0.25)))
                labels[g + k] = 1
        elif anomaly_type == "meter_stuck":
            stuck = capacity * float(rng.uniform(0.2, 0.4))
            for k in range(ANOMALY_BLOCK):
                gens[g + k] = stuck
                labels[g + k] = 1
        elif anomaly_type == "balance_break":
            for k in range(ANOMALY_BLOCK):
                imports[g + k] = gens[g + k] * float(rng.uniform(2.0, 6.0))
                exports[g + k] = gens[g + k] * float(rng.uniform(2.0, 6.0))
                residuals[g + k] = (
                    abs(gens[g + k] + imports[g + k] - loads[g + k] - exports[g + k])
                    + float(rng.uniform(40.0, 120.0))
                )
                labels[g + k] = 1
        elif anomaly_type == "gap_resume":
            missing[g] = int(rng.randint(1, 5))
            prev = float(gens[g - 1]) if g > 0 else capacity * 0.3
            jump = float(rng.uniform(1.8, 3.0))
            for k in range(ANOMALY_BLOCK):
                gens[g + k] = prev * jump
                labels[g + k] = 1
        else:
            factor = float(rng.uniform(2.0, 5.0))
            for k in range(ANOMALY_BLOCK):
                gens[g + k] = capacity * factor
                labels[g + k] = 1
            if anomaly_type == "midday_collapse":
                anomaly_type = "capacity_spike"
        anomaly_types.append(anomaly_type)
        j += ANOMALY_BLOCK + CLEAN_BLOCK
    series["anomaly_types"] = anomaly_types


def _interval_dict(series: dict[str, Any], index: int) -> dict[str, Any]:
    ts = SERIES_START + timedelta(hours=index)
    return {
        "intervalStart": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "intervalEnd": (ts + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generationKwh": float(series["gens"][index]),
        "consumptionKwh": float(series["loads"][index]),
        "importKwh": float(series["imports"][index]),
        "exportKwh": float(series["exports"][index]),
        "batteryChargeKwh": float(series["charges"][index]),
        "batteryDischargeKwh": float(series["discharges"][index]),
        "balanceResidualKwh": float(series["residuals"][index]),
    }


def _history_dicts(series: dict[str, Any], index: int) -> list[dict[str, Any]]:
    start = max(0, index - MAX_HISTORY)
    return [_interval_dict(series, i) for i in range(start, index)]


def build_dataset(seed: int, n_samples: int, capacity: float = DEFAULT_CAPACITY_KW) -> Dataset:
    n_hours = int(math.ceil(n_samples / TRAIN_FRACTION))
    series = generate_series(seed, n_hours, capacity)
    train_end = int(n_hours * TRAIN_FRACTION)
    test_start = train_end + PURGE_HOURS
    inject_anomalies(series, seed, test_start, n_hours)
    train_rows: list[list[float]] = []
    for i in range(train_end):
        features = extract_features(_interval_dict(series, i), _history_dicts(series, i), capacity, 0)
        train_rows.append(feature_vector(features))
    test_rows: list[list[float]] = []
    test_labels: list[int] = []
    for i in range(test_start, n_hours):
        features = extract_features(
            _interval_dict(series, i),
            _history_dicts(series, i),
            capacity,
            int(series["missing"][i]),
        )
        test_rows.append(feature_vector(features))
        test_labels.append(int(series["labels"][i]))
    return Dataset(
        X_train=np.asarray(train_rows, dtype=float),
        X_test=np.asarray(test_rows, dtype=float),
        y_test=np.asarray(test_labels, dtype=int),
        n_train=len(train_rows),
        n_test=len(test_rows),
    )
