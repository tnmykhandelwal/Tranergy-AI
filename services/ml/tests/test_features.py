import math

from app.features import (
    DEFAULT_WINDOW,
    FEATURE_ORDER,
    balance_residual_kwh,
    capacity_ratio,
    day_of_year,
    delta_vs_prev_kwh,
    extract_features,
    feature_vector,
    hour_of_day,
    rolling_mean_kwh,
    rolling_std_kwh,
    rolling_window,
    z_score,
)


def test_capacity_ratio() -> None:
    assert math.isclose(capacity_ratio(800, 150), 800 / 150)
    assert capacity_ratio(75, 150) == 0.5
    assert capacity_ratio(10, 0) > 0


def test_hour_of_day_and_day_of_year() -> None:
    assert hour_of_day("2026-10-20T12:00:00Z") == 12
    assert hour_of_day("2026-10-20T00:30:00Z") == 0
    assert hour_of_day("2026-10-20T23:59:59+00:00") == 23
    assert day_of_year("2026-01-01T05:00:00Z") == 1
    assert day_of_year("2026-12-31T05:00:00Z") == 365


def test_delta_vs_prev_empty_history() -> None:
    assert delta_vs_prev_kwh(50.0, None) == 0.0


def test_delta_vs_prev() -> None:
    assert delta_vs_prev_kwh(80.0, 30.0) == 50.0
    assert delta_vs_prev_kwh(10.0, 25.0) == -15.0


def test_rolling_window_formula() -> None:
    assert rolling_window(0) == 1
    assert rolling_window(1) == 2
    assert rolling_window(5) == 6
    assert rolling_window(50) == DEFAULT_WINDOW


def test_rolling_stats_empty_single_history() -> None:
    assert rolling_mean_kwh([50.0]) == 50.0
    assert rolling_std_kwh([50.0]) == 0.0
    mean = rolling_mean_kwh([40.0, 50.0])
    std = rolling_std_kwh([40.0, 50.0])
    assert math.isclose(mean, 45.0)
    assert math.isclose(std, 5.0)


def test_rolling_stats_capped_at_window() -> None:
    gens = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    assert math.isclose(rolling_mean_kwh(gens), (5 + 6 + 7 + 8 + 9 + 10) / 6)
    recent = gens[-6:]
    mean = sum(recent) / 6
    expected_std = math.sqrt(sum((g - mean) ** 2 for g in recent) / 6)
    assert math.isclose(rolling_std_kwh(gens), expected_std)


def test_z_score_zero_std() -> None:
    assert z_score(50.0, 50.0, 0.0) == 0.0
    assert z_score(50.0, 50.0, 1e-9) == 0.0


def test_z_score_normal() -> None:
    assert math.isclose(z_score(80.0, 50.0, 10.0), 3.0)
    assert math.isclose(z_score(20.0, 50.0, 10.0), -3.0)


def test_balance_residual_prefers_provided_field() -> None:
    target = {
        "generationKwh": 800.0,
        "consumptionKwh": 55.0,
        "importKwh": 0.0,
        "exportKwh": 30.0,
        "batteryChargeKwh": 0.0,
        "batteryDischargeKwh": 0.0,
        "balanceResidualKwh": 715.0,
    }
    assert balance_residual_kwh(target) == 715.0


def test_balance_residual_recompute_when_missing() -> None:
    target = {
        "generationKwh": 100.0,
        "consumptionKwh": 55.0,
        "importKwh": 5.0,
        "exportKwh": 30.0,
        "batteryChargeKwh": 10.0,
        "batteryDischargeKwh": 0.0,
        "balanceResidualKwh": None,
    }
    assert math.isclose(balance_residual_kwh(target), abs(100 + 5 + 0 - 55 - 30 - 10))


def _interval(gen: float, start: str = "2026-10-20T12:00:00Z") -> dict:
    return {
        "intervalStart": start,
        "intervalEnd": start,
        "generationKwh": gen,
        "consumptionKwh": 55.0,
        "importKwh": 0.0,
        "exportKwh": 30.0,
        "batteryChargeKwh": 0.0,
        "batteryDischargeKwh": 0.0,
        "balanceResidualKwh": 0.0,
    }


def test_extract_features_empty_history() -> None:
    features = extract_features(_interval(90.0), [], capacity_kw=150.0, missing_intervals=0)
    assert features["capacityRatio"] == 0.6
    assert features["hourOfDay"] == 12
    assert features["dayOfYear"] == 293
    assert features["deltaVsPrevKwh"] == 0.0
    assert features["rollingMeanKwh"] == 90.0
    assert features["rollingStdKwh"] == 0.0
    assert features["zScore"] == 0.0
    assert features["balanceResidualKwh"] == 0.0
    assert features["missingIntervals"] == 0


def test_extract_features_single_history() -> None:
    features = extract_features(_interval(120.0), [_interval(80.0)], capacity_kw=150.0)
    assert features["deltaVsPrevKwh"] == 40.0
    assert math.isclose(features["rollingMeanKwh"], 100.0)
    assert math.isclose(features["rollingStdKwh"], 20.0)
    assert math.isclose(features["zScore"], 1.0)


def test_feature_order_fixed() -> None:
    assert FEATURE_ORDER == [
        "capacityRatio",
        "hourOfDay",
        "deltaVsPrevKwh",
        "rollingMeanKwh",
        "rollingStdKwh",
        "zScore",
        "balanceResidualKwh",
        "missingIntervals",
    ]
    features = extract_features(_interval(90.0), [], capacity_kw=150.0)
    vector = feature_vector(features)
    assert len(vector) == len(FEATURE_ORDER)
    assert vector[0] == 0.6
