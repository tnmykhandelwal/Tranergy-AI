from __future__ import annotations

from datetime import datetime
from math import sqrt
from typing import Any, Mapping, Sequence

EPS = 1e-9
DEFAULT_WINDOW = 6
ZSCORE_STD_FLOOR = 1e-6

FEATURE_ORDER: list[str] = [
    "capacityRatio",
    "hourOfDay",
    "deltaVsPrevKwh",
    "rollingMeanKwh",
    "rollingStdKwh",
    "zScore",
    "balanceResidualKwh",
    "missingIntervals",
]


def _parse_ts(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.fromisoformat(text)


def capacity_ratio(generation_kwh: float, capacity_kw: float) -> float:
    return float(generation_kwh) / max(float(capacity_kw), EPS)


def hour_of_day(interval_start: str) -> int:
    return _parse_ts(interval_start).hour


def day_of_year(interval_start: str) -> int:
    return _parse_ts(interval_start).timetuple().tm_yday


def delta_vs_prev_kwh(generation_kwh: float, prev_generation_kwh: float | None) -> float:
    if prev_generation_kwh is None:
        return 0.0
    return float(generation_kwh) - float(prev_generation_kwh)


def rolling_window(history_len: int, window: int = DEFAULT_WINDOW) -> int:
    return max(1, min(window, history_len + 1))


def rolling_mean_kwh(generations: Sequence[float], window: int = DEFAULT_WINDOW) -> float:
    if not generations:
        return 0.0
    w = min(window, len(generations))
    recent = generations[-w:]
    return float(sum(recent) / len(recent))


def rolling_std_kwh(generations: Sequence[float], window: int = DEFAULT_WINDOW) -> float:
    if not generations:
        return 0.0
    w = min(window, len(generations))
    recent = generations[-w:]
    mean = float(sum(recent) / len(recent))
    variance = float(sum((g - mean) ** 2 for g in recent) / len(recent))
    return sqrt(variance)


def z_score(generation_kwh: float, rolling_mean: float, rolling_std: float) -> float:
    if rolling_std < ZSCORE_STD_FLOOR:
        return 0.0
    return float(generation_kwh - rolling_mean) / max(float(rolling_std), ZSCORE_STD_FLOOR)


def balance_residual_kwh(target: Mapping[str, Any]) -> float:
    provided = target.get("balanceResidualKwh")
    if provided is not None:
        return float(provided)
    generation = float(target.get("generationKwh") or 0.0)
    imported = float(target.get("importKwh") or 0.0)
    discharged = float(target.get("batteryDischargeKwh") or 0.0)
    load = float(target.get("consumptionKwh") or 0.0)
    exported = float(target.get("exportKwh") or 0.0)
    charged = float(target.get("batteryChargeKwh") or 0.0)
    return abs(generation + imported + discharged - load - exported - charged)


def extract_features(
    target: Mapping[str, Any],
    history: Sequence[Mapping[str, Any]],
    capacity_kw: float,
    missing_intervals: int = 0,
) -> dict[str, float | int]:
    generation = float(target["generationKwh"])
    hist = list(history)
    prev_generation = float(hist[-1]["generationKwh"]) if hist else None
    generations = [float(h["generationKwh"]) for h in hist] + [generation]
    window = min(DEFAULT_WINDOW, len(generations))
    rolling_mean = rolling_mean_kwh(generations, window)
    rolling_std = rolling_std_kwh(generations, window)
    return {
        "capacityRatio": capacity_ratio(generation, capacity_kw),
        "hourOfDay": hour_of_day(str(target["intervalStart"])),
        "dayOfYear": day_of_year(str(target["intervalStart"])),
        "deltaVsPrevKwh": delta_vs_prev_kwh(generation, prev_generation),
        "rollingMeanKwh": rolling_mean,
        "rollingStdKwh": rolling_std,
        "zScore": z_score(generation, rolling_mean, rolling_std),
        "balanceResidualKwh": balance_residual_kwh(target),
        "missingIntervals": int(missing_intervals),
    }


def feature_vector(features: Mapping[str, float | int]) -> list[float]:
    return [float(features[name]) for name in FEATURE_ORDER]
