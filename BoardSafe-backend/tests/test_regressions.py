"""Regression coverage for the defects found during local integration."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings
from app.db import SessionLocal, now_utc
from app.models import Assistance, RoutePlan, User
from app.security import decode_token


@pytest.mark.parametrize("iat_offset,exp_offset,allowed", [(2, 60, True), (60, 120, False), (-120, -60, False)])
def test_jwt_clock_skew_is_bounded(iat_offset, exp_offset, allowed):
    now = datetime.now(timezone.utc)
    token = jwt.encode({
        "sub": "test-user", "role": "passenger", "iss": "boardsafe", "jti": "skew-test",
        "iat": now + timedelta(seconds=iat_offset), "exp": now + timedelta(seconds=exp_offset),
    }, get_settings().jwt_secret, algorithm="HS256")
    if allowed:
        assert decode_token(token)["sub"] == "test-user"
    else:
        with pytest.raises(HTTPException) as exc:
            decode_token(token)
        assert exc.value.status_code == 401


@pytest.mark.parametrize("change", ["logout", "deactivate", "role"])
def test_websocket_closes_when_session_loses_access(client, actor, monkeypatch, change):
    authority = actor("authority")
    monkeypatch.setattr(get_settings(), "event_poll_seconds", 0.01)
    with client.websocket_connect("/api/v1/ws/events") as ws:
        ws.send_text(authority["headers"]["Authorization"].split(" ", 1)[1])
        assert ws.receive_json()["type"] == "connected"
        if change == "logout":
            assert client.post("/api/v1/auth/logout", headers=authority["headers"]).status_code == 200
        else:
            with SessionLocal() as db:
                user = db.get(User, authority["id"])
                if change == "deactivate":
                    user.active = False
                else:
                    user.role = "passenger"
                db.commit()
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 1008


def test_websocket_closes_at_token_expiry(client, actor, monkeypatch):
    authority = actor("authority")
    original = authority["headers"]["Authorization"].split(" ", 1)[1]
    claims = decode_token(original)
    claims["exp"] = datetime.now(timezone.utc) + timedelta(seconds=1)
    token = jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")
    monkeypatch.setattr(get_settings(), "event_poll_seconds", 0.01)
    with client.websocket_connect("/api/v1/ws/events") as ws:
        ws.send_text(token)
        assert ws.receive_json()["type"] == "connected"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 1008


@pytest.mark.parametrize("closed", [False, True])
def test_expired_route_reverification_rechecks_closures(client, network, closed):
    n = network
    with SessionLocal() as db:
        route = db.get(RoutePlan, n["route_id"])
        route.status = "verified"
        route.expires_at = now_utc() - timedelta(minutes=1)
        db.commit()
    if closed:
        response = client.post("/api/v1/roads/restrictions", headers=n["authority"]["headers"], json={
            "name": "Cierre de prueba", "geometry": n["route_geom"],
            "confirmation_note": "Tramo cerrado tras inspección documentada",
        })
        assert response.status_code == 201
    response = client.post(f"/api/v1/routes/{n['route_id']}/verify", headers=n["inspector"]["headers"], json={
        "note": "Nueva inspección documentada de la ruta vencida", "valid_minutes": 30,
    })
    assert response.status_code == (409 if closed else 200), response.text
    if not closed:
        assert response.json()["valid_now"] is True
        assert response.json()["expires_at"].endswith("Z")
        assert client.post(f"/api/v1/routes/{n['route_id']}/verify", headers=n["inspector"]["headers"], json={
            "note": "No se debe renovar una ruta aún vigente",
        }).status_code == 409


def test_offset_inputs_are_utc_and_outputs_include_zone(client, network, actor):
    n = network
    lima = timezone(timedelta(hours=-5))
    observed = datetime.now(lima)
    node = client.post("/api/v1/edge/nodes", headers=actor("admin")["headers"], json={
        "code": "REGRESSION-CAMERA", "kind": "camera", "stop_id": n["stop"]["id"],
    }).json()
    signal = client.post(f"/api/v1/edge/nodes/{node['id']}/signals", headers={"X-Node-Key": node["node_secret"]}, json={
        "event_type": "bay_obstruction", "confidence": 0.9, "observed_at": observed.isoformat(),
    })
    assert signal.status_code == 202, signal.text
    stops = client.get("/api/v1/stops").json()
    assert stops[0]["bay_checked_at"].endswith("Z")
    assert datetime.fromisoformat(stops[0]["bay_checked_at"]) == observed.astimezone(timezone.utc)
    rain = client.post("/api/v1/weather/readings", headers={"X-Ingest-Token": get_settings().ingest_token}, json={
        "kind": "observation", "source": "Estación de prueba", "source_ref": "regression-offset",
        "lat": -9.93, "lon": -76.24, "mm": 10, "period_hours": 1, "observed_at": observed.isoformat(),
    })
    assert rain.status_code == 201, rain.text
    assert datetime.fromisoformat(rain.json()["observed_at"]) == observed.astimezone(timezone.utc)
    expires = observed + timedelta(hours=1)
    restriction = client.post("/api/v1/roads/restrictions", headers=n["authority"]["headers"], json={
        "name": "Restricción con horario local", "geometry": n["route_geom"],
        "confirmation_note": "Restricción confirmada por inspector de prueba", "expires_at": expires.isoformat(),
    })
    assert restriction.status_code == 201, restriction.text
    assert datetime.fromisoformat(restriction.json()["expires_at"]) == expires.astimezone(timezone.utc)


def test_driver_routes_are_scoped_to_assigned_services(client, network, actor):
    n = network
    assert client.get("/api/v1/routes", headers=n["driver"]["headers"]).json() == []
    with SessionLocal() as db:
        private_route = RoutePlan(
            requested_by=n["dispatcher"]["id"], geometry=n["route_geom"],
            origin=[-76.24, -9.93], destination=[-76.23, -9.92], distance_m=1600,
            duration_s=400, status="candidate",
        )
        db.add(private_route)
        db.add(Assistance(
            passenger_id=n["passenger"]["id"], stop_id=n["stop"]["id"],
            destination_lat=-9.92, destination_lon=-76.23, support=["ramp"],
            consent_operational=True, vehicle_id=n["vehicle"]["id"], route_id=n["route_id"],
            state="offered", expires_at=now_utc()+timedelta(hours=1),
        ))
        db.commit()
    visible = client.get("/api/v1/routes", headers=n["driver"]["headers"]).json()
    assert [route["id"] for route in visible] == [n["route_id"]]
    assert client.get("/api/v1/routes", headers=actor("driver")["headers"]).json() == []
    assert len(client.get("/api/v1/routes", headers=n["inspector"]["headers"]).json()) == 2
