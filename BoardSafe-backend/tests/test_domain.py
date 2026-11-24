from datetime import timedelta
from types import SimpleNamespace
from app.domain.geo import meters_between,near_route
from app.domain.rules import compute_risk,route_blockers,is_fresh
from app.db import now_utc

def test_coordinates_and_overlap():
    route={"type":"LineString","coordinates":[[-76.24,-9.93],[-76.23,-9.92]]}
    closed={"type":"LineString","coordinates":[[-76.235,-9.932],[-76.235,-9.918]]}
    far={"type":"LineString","coordinates":[[-75.00,-9.9],[-74.9,-9.89]]}
    assert near_route(route,closed)
    assert not near_route(route,far)
    assert 1000<meters_between((-76.24,-9.93),(-76.23,-9.92))<2000

def test_risk_is_priority_not_probabilistic():
    score, category, reasons=compute_risk(5,True,80,2)
    assert score==100 and category=="high"
    assert reasons and "susceptibilidad" in reasons[0].lower()

def test_confirmed_closure_expiry():
    geom={"type":"LineString","coordinates":[[-76.24,-9.93],[-76.23,-9.92]]}
    expired=SimpleNamespace(id="1",status="closed",geometry=geom,expires_at=now_utc()-timedelta(hours=1))
    current=SimpleNamespace(id="2",status="closed",geometry=geom,expires_at=now_utc()+timedelta(hours=1))
    assert route_blockers(geom,[expired])==[]
    assert route_blockers(geom,[current])==["2"]
    assert not is_fresh(now_utc()-timedelta(hours=1),60)
