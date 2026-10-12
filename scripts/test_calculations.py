#!/usr/bin/env python3
from datetime import datetime
import math

from collect_v5 import IDF, adaptive_weights, future_targets, idf_intensity, metric_summary


def assert_close(actual, expected, tol=1e-6):
    if actual is None or abs(actual - expected) > tol:
        raise AssertionError(f"{actual!r} != {expected!r}")


def test_idf_thresholds():
    expected = {
        2: 38.1409087243,
        5: 45.1204303991,
        10: 51.2368161487,
        25: 60.6127980227,
        50: 68.8292811278,
        100: 78.1595652258,
    }
    for return_years, value in expected.items():
        assert_close(idf_intensity(return_years, 60), value, 1e-8)


def test_nominal_leads():
    issued = datetime(2026, 10, 12, 20, 0)
    times = [
        "2026-10-12T20:00", "2026-10-12T21:00", "2026-10-12T22:00",
        "2026-10-12T23:00", "2026-10-13T00:00", "2026-10-13T01:00",
        "2026-10-13T02:00",
    ]
    model = {
        "time": times,
        "rain": [0.0] * len(times),
        "gust": [10.0] * len(times),
        "cape": [100.0] * len(times),
        "dew": [15.0] * len(times),
    }
    targets = {item["lead"]: item["target"] for item in future_targets(model, issued)}
    assert targets[3] == "2026-10-12T23:00"
    assert targets[6] == "2026-10-13T02:00"


def test_official_metric_separation():
    records = [
        {
            "model": "ECMWF",
            "rain_error": 0.5,
            "gust_error": 4.0,
            "rain_official": True,
            "gust_official": False,
            "event_pred": True,
            "event_obs": True,
        },
        {
            "model": "ECMWF",
            "rain_error": 0.2,
            "gust_error": 2.0,
            "rain_official": False,
            "gust_official": True,
            "event_pred": False,
            "event_obs": False,
        },
    ]
    official = metric_summary(records, "ECMWF", True)
    assert official["rain_n"] == 1
    assert official["gust_n"] == 1
    assert_close(official["mae_rain"], 0.5)
    assert_close(official["mae_gust"], 2.0)
    assert official["events_n"] == 1


def test_zero_rmse_is_not_treated_as_missing():
    metrics = {}
    for name in ("ECMWF", "GFS", "ICON"):
        metrics[name] = {
            "official": {
                "rain_n": 20,
                "gust_n": 20,
                "rmse_rain": 3.0,
                "rmse_gust": 15.0,
            }
        }
    metrics["ECMWF"]["official"]["rmse_rain"] = 0.0
    weights = adaptive_weights(metrics, "rain")
    assert weights["active"] is True
    assert math.isclose(sum(weights["values"].values()), 1.0, rel_tol=0, abs_tol=1e-12)
    assert weights["values"]["ECMWF"] > weights["values"]["GFS"]


if __name__ == "__main__":
    test_idf_thresholds()
    test_nominal_leads()
    test_official_metric_separation()
    test_zero_rmse_is_not_treated_as_missing()
    print("calculation audit: ok")
