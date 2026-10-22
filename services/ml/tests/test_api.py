import math
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import _state, app

SPEC_SCORE_KEYS = {
    "anomalyScore",
    "isAnomaly",
    "flagged",
    "mlStatus",
    "reasonCodes",
    "modelVersion",
    "features",
}

SPEC_FEATURE_KEYS = {
    "capacityRatio",
    "hourOfDay",
    "deltaVsPrevKwh",
    "rollingMeanKwh",
    "rollingStdKwh",
    "zScore",
    "balanceResidualKwh",
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ML_MODEL_DIR", str(tmp_path))
    _state["artifact"] = None
    with TestClient(app) as test_client:
        yield test_client
    _state["artifact"] = None


@pytest.fixture()
def trained_client(client: TestClient):
    response = client.post("/train", json={"seed": 42, "nSamples": 600})
    assert response.status_code == 200
    return client


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _bell(hour: float, capacity: float = 150.0) -> float:
    if hour < 6.0 or hour > 18.0:
        return 0.0
    phase = (hour - 6.0) / 12.0
    return capacity * max(0.0, math.sin(math.pi * phase)) ** 1.2


def _normal_interval(dt: datetime, capacity: float = 150.0) -> dict[str, Any]:
    gen = _bell(dt.hour, capacity)
    load = 40.0 + (20.0 if 8 <= dt.hour < 18 else 0.0)
    export = max(0.0, gen - load) * 0.8
    imported = max(0.0, load - gen) * 0.9
    return {
        "intervalStart": _iso(dt),
        "intervalEnd": _iso(dt + timedelta(hours=1)),
        "generationKwh": round(gen, 3),
        "consumptionKwh": load,
        "importKwh": round(imported, 3),
        "exportKwh": round(export, 3),
        "batteryChargeKwh": 0.0,
        "batteryDischargeKwh": 0.0,
        "balanceResidualKwh": 0.0,
    }


def _history(n: int, end: datetime, capacity: float = 150.0) -> list[dict[str, Any]]:
    return [_normal_interval(end - timedelta(hours=k), capacity) for k in range(n, 0, -1)]


def test_health_untrained(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service"] == "tranergy-ml"
    assert body["trained"] is False
    assert body["modelVersion"] is None
    assert body["nTrain"] is None


def test_health_trained(trained_client: TestClient) -> None:
    body = trained_client.get("/health").json()
    assert body["ok"] is True
    assert body["trained"] is True
    assert body["modelVersion"].startswith("iforest-")
    assert isinstance(body["nTrain"], int)


def test_train_returns_all_metric_keys(client: TestClient) -> None:
    response = client.post("/train", json={"seed": 7, "nSamples": 200})
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"modelVersion", "nTrain", "nTest", "metrics", "trainedAt"}
    assert set(body["metrics"].keys()) == {"precision", "recall", "f1", "fpr"}
    assert body["modelVersion"].startswith("iforest-")
    assert body["nTrain"] > 0
    assert body["nTest"] > 0
    for value in body["metrics"].values():
        assert 0.0 <= value <= 1.0


def test_train_bumps_version_on_force(client: TestClient) -> None:
    first = client.post("/train", json={"seed": 1, "nSamples": 200}).json()
    second = client.post("/train", json={"seed": 1, "nSamples": 200, "force": True}).json()
    assert first["modelVersion"] != second["modelVersion"]
    assert second["modelVersion"].endswith("-v2")


def test_train_rejects_tiny_n(client: TestClient) -> None:
    response = client.post("/train", json={"nSamples": 5})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"


def test_score_normal_noon_not_flagged(trained_client: TestClient) -> None:
    noon = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    target = _normal_interval(noon)
    target["generationKwh"] = 140.0
    target["consumptionKwh"] = 55.0
    target["exportKwh"] = 30.0
    payload = {
        "facilityId": "fac-solar-1",
        "capacityKw": 150,
        "target": target,
        "history": _history(24, noon),
        "missingIntervals": 0,
    }
    response = trained_client.post("/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["flagged"] is False
    assert body["isAnomaly"] is False
    assert body["mlStatus"] == "OK"
    assert body["reasonCodes"] == []
    assert 0.0 <= body["anomalyScore"] <= 1.0


def test_score_spike_flagged(trained_client: TestClient) -> None:
    noon = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    payload = {
        "facilityId": "fac-solar-1",
        "capacityKw": 150,
        "target": {
            "intervalStart": _iso(noon),
            "intervalEnd": _iso(noon + timedelta(hours=1)),
            "generationKwh": 800,
            "consumptionKwh": 55,
            "importKwh": 0,
            "exportKwh": 30,
            "batteryChargeKwh": 0,
            "batteryDischargeKwh": 0,
            "balanceResidualKwh": 715,
        },
        "history": _history(100, noon),
        "missingIntervals": 0,
    }
    response = trained_client.post("/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["flagged"] is True
    assert body["isAnomaly"] is True
    assert body["mlStatus"] == "ANOMALY_FLAGGED"
    assert "GEN_ABOVE_CAPACITY" in body["reasonCodes"] or "GEN_SPIKE_VS_ROLLING" in body["reasonCodes"]
    assert body["anomalyScore"] > 0.5


def test_score_response_has_all_spec_keys(trained_client: TestClient) -> None:
    noon = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    payload = {
        "facilityId": "fac-solar-1",
        "capacityKw": 150,
        "target": _normal_interval(noon),
        "history": [],
        "missingIntervals": 0,
    }
    body = trained_client.post("/score", json=payload).json()
    assert SPEC_SCORE_KEYS.issubset(body.keys())
    assert SPEC_FEATURE_KEYS.issubset(body["features"].keys())
    assert body["modelVersion"].startswith("iforest-")
    assert body["mlStatus"] in {"ANOMALY_FLAGGED", "OK"}
    assert isinstance(body["reasonCodes"], list)


def test_score_empty_and_single_history_edges(trained_client: TestClient) -> None:
    noon = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    base = {
        "facilityId": "fac-solar-1",
        "capacityKw": 150,
        "target": _normal_interval(noon),
        "missingIntervals": 2,
    }
    empty = trained_client.post("/score", json={**base, "history": []}).json()
    assert empty["features"]["deltaVsPrevKwh"] == 0.0
    assert empty["features"]["zScore"] == 0.0
    assert "MISSING_INTERVALS_PRESENT" in empty["reasonCodes"]

    single = trained_client.post(
        "/score", json={**base, "history": [_normal_interval(noon - timedelta(hours=1))]}
    ).json()
    assert math.isclose(
        single["features"]["deltaVsPrevKwh"],
        base["target"]["generationKwh"] - round(_bell(11.0), 3),
    )


def test_score_balance_residual_high_reason(trained_client: TestClient) -> None:
    noon = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
    target = _normal_interval(noon)
    target["balanceResidualKwh"] = 60.0
    body = trained_client.post(
        "/score",
        json={
            "facilityId": "fac-solar-1",
            "capacityKw": 150,
            "target": target,
            "history": _history(12, noon),
            "missingIntervals": 0,
        },
    ).json()
    assert "BALANCE_RESIDUAL_HIGH" in body["reasonCodes"]
