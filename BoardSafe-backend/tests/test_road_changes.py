from datetime import timedelta

import pytest

from app.db import SessionLocal, now_utc
from app.models import RoadRestriction


def test_expired_restriction_cannot_be_reclosed_without_new_validity(client, network):
    n = network
    created = client.post("/api/v1/roads/restrictions", headers=n["authority"]["headers"], json={
        "name": "Restricción temporal", "geometry": n["route_geom"],
        "confirmation_note": "Inspección documentada de restricción temporal",
    })
    assert created.status_code == 201
    road_id = created.json()["id"]
    with SessionLocal() as db:
        road = db.get(RoadRestriction, road_id)
        road.expires_at = now_utc() - timedelta(minutes=1)
        road.status = "open"
        db.commit()
    rejected = client.patch(f"/api/v1/roads/restrictions/{road_id}", headers=n["authority"]["headers"], json={
        "status": "closed", "confirmation_note": "Intento de cierre con vigencia ya caducada",
    })
    assert rejected.status_code == 422
    with SessionLocal() as db:
        assert db.get(RoadRestriction, road_id).status == "open"


def test_report_review_and_closure_have_separate_roles_and_decisions(client, network):
    n = network
    report = client.post("/api/v1/reports", headers=n["passenger"]["headers"], json={
        "kind": "road_damage", "description": "Daño visible que requiere inspección de campo", "lat": -9.93, "lon": -76.24,
    }).json()
    assert client.get("/api/v1/roads/restrictions").json() == []
    body = {"name": "Tramo por inspeccionar", "geometry": n["route_geom"],
            "source_report_id": report["id"], "confirmation_note": "Decisión de autoridad pendiente de corroboración"}
    assert client.post("/api/v1/roads/restrictions", headers=n["authority"]["headers"], json=body).status_code == 409
    review = {"status": "verified", "reason": "Hechos corroborados mediante inspección registrada"}
    assert client.post(f"/api/v1/reports/{report['id']}/review", headers=n["driver"]["headers"], json=review).status_code == 403
    assert client.post(f"/api/v1/reports/{report['id']}/review", headers=n["inspector"]["headers"], json=review).status_code == 200
    assert client.get("/api/v1/roads/restrictions").json() == []
    assert client.post("/api/v1/roads/restrictions", headers=n["inspector"]["headers"], json=body).status_code == 403
    assert client.post("/api/v1/roads/restrictions", headers=n["authority"]["headers"], json=body).status_code == 201


@pytest.mark.parametrize("status", ["closed", "restricted"])
def test_expired_road_is_not_shown_as_active_on_map(client, network, status):
    n = network
    response = client.post("/api/v1/roads/restrictions", headers=n["authority"]["headers"], json={
        "name": "Tramo de vigencia temporal", "geometry": n["route_geom"], "status": status,
        "confirmation_note": "Inspección documentada de vigencia temporal",
    })
    assert response.status_code == 201
    road_id = response.json()["id"]
    with SessionLocal() as db:
        db.get(RoadRestriction, road_id).expires_at = now_utc() - timedelta(seconds=1)
        db.commit()
    features = client.get("/api/v1/map/features", headers=n["passenger"]["headers"]).json()["features"]
    road = next(feature for feature in features if feature.get("id") == road_id)
    assert road["properties"]["status"] == "open_expired"
