"""HTTP contract tests using local mocked OSRM response. No real external calls in CI."""
import httpx
import pytest
from app.integrations import osrm
from app.config import get_settings

def test_external_routing_http_contract(monkeypatch):
    settings=get_settings()
    monkeypatch.setattr(settings,"osrm_base_url","http://osrm:5000")
    calls=[]
    def handler(req):
        calls.append(str(req.url))
        return httpx.Response(200,json={"code":"Ok","routes":[{"distance":1700,"duration":220,"geometry":{"type":"LineString","coordinates":[[-76.24,-9.93],[-76.23,-9.92]]}}]})
    real_client=httpx.Client
    monkeypatch.setattr(osrm.httpx,"Client",lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    results=osrm.fetch_routes((-76.24,-9.93),(-76.23,-9.92))
    assert len(results)==1
    assert results[0]["geometry"]["type"]=="LineString"
    assert "geometries=geojson" in calls[0]
    assert "/route/v1/driving/-76.24,-9.93" in calls[0]


def test_no_route_provider_fail_closed(monkeypatch):
    settings=get_settings()
    monkeypatch.setattr(settings,"osrm_base_url","")
    with pytest.raises(osrm.RoutingUnavailable):
        osrm.fetch_routes((-76.24,-9.93),(-76.23,-9.92))
