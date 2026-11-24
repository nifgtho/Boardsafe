from datetime import datetime,timezone
from app.db import SessionLocal,now_utc
from app.models import Assistance,RoutePlan,Stop,Vehicle,Report,AuditLog,DomainEvent

API="/api/v1"

def ready_trip(client,n):
    a=client.post(API+"/assistance",headers=n["passenger"]["headers"],json={"stop_id":n["stop"]["id"],"destination_lat":-9.92,"destination_lon":-76.23,"support":["ramp","audio"],"consent_operational":True})
    assert a.status_code==201,a.text
    request_id=a.json()["id"]
    vi=client.post(API+f"/routes/{n['route_id']}/verify",headers=n["inspector"]["headers"],json={"note":"Inspección vial documentada, ruta apta para el vehículo", "valid_minutes":60})
    assert vi.status_code==200,vi.text
    vs=client.patch(API+f"/vehicles/{n['vehicle']['id']}/status",headers=n["driver"]["headers"],json={"accessible_spaces_free":1,"ramp_ok":True,"at_lat":-9.93,"at_lon":-76.24})
    assert vs.status_code==200,vs.text
    assign=client.post(API+f"/assistance/{request_id}/offer",headers=n["dispatcher"]["headers"],json={"vehicle_id":n["vehicle"]["id"],"route_id":n["route_id"]})
    assert assign.status_code==200,assign.text
    return request_id

def test_privacy_access_and_registration(client,actor,network):
    n=network
    req=client.post(API+"/assistance",headers=n["passenger"]["headers"],json={"stop_id":n["stop"]["id"],"destination_lat":-9.92,"destination_lon":-76.23,"support":["ramp"],"consent_operational":True})
    assert req.status_code==201
    second=actor("passenger")
    assert client.get(API+"/assistance/"+req.json()["id"],headers=second["headers"]).status_code==403
    assert client.post(API+"/roads/restrictions",headers=n["passenger"]["headers"],json={}).status_code==403
    # Credentials of a brand new user
    reg=client.post(API+"/auth/register",json={"email":"citizen@example.com","password":"EnoughPassword1234!"})
    assert reg.status_code==201
    token=client.post(API+"/auth/login",json={"email":"citizen@example.com","password":"EnoughPassword1234!"})
    assert token.status_code==200 and token.json()["access_token"]

def test_onboarding_checks_and_closure_invalidation(client,network):
    n=network; aid=ready_trip(client,n)
    no_accept=client.post(API+f"/assistance/{aid}/board",headers=n["driver"]["headers"])
    assert no_accept.status_code==409
    accepted=client.post(API+f"/assistance/{aid}/accept",headers=n["driver"]["headers"])
    assert accepted.status_code==200
    still_unknown=client.post(API+f"/assistance/{aid}/board",headers=n["driver"]["headers"])
    assert still_unknown.status_code==409 and "paradero" in str(still_unknown.json()).lower()
    clear=client.patch(API+f"/stops/{n['stop']['id']}/bay",headers=n["dispatcher"]["headers"],json={"status":"clear","note":"Comprobación física completa"})
    assert clear.status_code==200
    blocked=client.post(API+"/roads/restrictions",headers=n["authority"]["headers"],json={"name":"Cierre verificado en tramo de prueba","geometry":{"type":"LineString","coordinates":[[-76.235,-9.932],[-76.235,-9.918]]},"status":"closed","confirmation_note":"Autoridad confirma restricción vial documentada"})
    assert blocked.status_code==201,blocked.text
    assert n["route_id"] in blocked.json()["routes_revoked"]
    board=client.post(API+f"/assistance/{aid}/board",headers=n["driver"]["headers"])
    assert board.status_code==409
    status=client.get(API+f"/assistance/{aid}",headers=n["passenger"]["headers"])
    assert status.json()["state"]=="waiting_safe"
    verified_again=client.post(API+f"/routes/{n['route_id']}/verify",headers=n["inspector"]["headers"],json={"note":"Reinspección en ruta del corte"})
    assert verified_again.status_code==409


def test_safe_full_trip_and_audit(client,network):
    n=network;aid=ready_trip(client,n)
    assert client.patch(API+f"/stops/{n['stop']['id']}/bay",headers=n["dispatcher"]["headers"],json={"status":"clear","note":"Inspección manual del área de ascenso"}).status_code==200
    assert client.post(API+f"/assistance/{aid}/accept",headers=n["driver"]["headers"]).status_code==200
    boarded=client.post(API+f"/assistance/{aid}/board",headers=n["driver"]["headers"])
    assert boarded.status_code==200,boarded.text
    assert client.post(API+f"/assistance/{aid}/complete",headers=n["passenger"]["headers"]).status_code==200
    metrics=client.get(API+"/metrics/continuity",headers=n["authority"]["headers"])
    assert metrics.json()["completed"]==1 and metrics.json()["ajcr_percent"]==100
    with SessionLocal() as db:
        assert db.query(AuditLog).count()>0 and db.query(DomainEvent).count()>0


def test_reports_cannot_close_roads_until_authority(client,network):
    n=network
    report=client.post(API+"/reports",headers=n["passenger"]["headers"],json={"kind":"landslide","description":"Material abundante en la carretera, requiere verificación", "lat":-9.93,"lon":-76.24})
    assert report.status_code==201
    id=report.json()["id"]
    req={"name":"Restricción señalizada por inspección","geometry":n["route_geom"],"source_report_id":id,"confirmation_note":"Autoridad confirma cierre por inspección presencial"}
    assert client.post(API+"/roads/restrictions",headers=n["authority"]["headers"],json=req).status_code==409
    review=client.post(API+f"/reports/{id}/review",headers=n["inspector"]["headers"],json={"status":"verified","reason":"Se confirmó con personal de campo"})
    assert review.status_code==200
    assert client.post(API+"/roads/restrictions",headers=n["authority"]["headers"],json=req).status_code==201


def test_sensor_obstruction_and_manual_clear(client,network,actor):
    n=network;admin=actor("admin")
    node=client.post(API+"/edge/nodes",headers=admin["headers"],json={"code":"EDGE-01","stop_id":n["stop"]["id"]})
    assert node.status_code==201
    node_id=node.json()["id"]
    signal=client.post(API+f"/edge/nodes/{node_id}/signals",headers={"X-Node-Key":node.json()["node_secret"]},json={"event_type":"bay_obstruction","confidence":0.88,"observed_at":datetime.now(timezone.utc).isoformat()})
    assert signal.status_code==202,signal.text
    stops=client.get(API+"/stops").json();assert stops[0]["bay_effective_status"]=="blocked"
    invalid=client.post(API+f"/edge/nodes/{node_id}/signals",headers={"X-Node-Key":"wrong-key"},json={"event_type":"bay_no_obstruction","confidence":0.9,"observed_at":datetime.now(timezone.utc).isoformat()})
    assert invalid.status_code==401
    clear_signal=client.post(API+f"/edge/nodes/{node_id}/signals",headers={"X-Node-Key":node.json()["node_secret"]},json={"event_type":"bay_no_obstruction","confidence":0.88,"observed_at":datetime.now(timezone.utc).isoformat()})
    assert clear_signal.status_code==202
    assert client.get(API+"/stops").json()[0]["bay_effective_status"]=="unknown"


def test_real_osrm_adapter_contract_with_mock(client,network,monkeypatch):
    n=network
    from app.api import roads
    monkeypatch.setattr(roads,"fetch_routes",lambda origin,destination:[{"geometry":n["route_geom"],"distance_m":1600,"duration_s":220}])
    response=client.post(API+"/routes/plan",headers=n["dispatcher"]["headers"],json={"origin_lat":-9.93,"origin_lon":-76.24,"destination_lat":-9.92,"destination_lon":-76.23})
    assert response.status_code==201,response.text
    assert len(response.json())==1 and response.json()[0]["eligible"] is False


def test_risk_is_not_a_closure(client,network):
    n=network
    zone=client.post(API+"/risk/zones",headers=n["authority"]["headers"],json={"name":"Terreno susceptible","lat":-9.93,"lon":-76.24,"radius_m":2000,"susceptibility":4,"critical_access":True,"source":"INGEMMET reference manual","source_version":"verified-source-v1"})
    assert zone.status_code==201
    weather=client.post(API+"/weather/readings",headers={"X-Ingest-Token":"test-ingest-token-for-real-observations-123"},json={"kind":"observation","source":"Hydro sensor","source_ref":"station-1-t1","lat":-9.93,"lon":-76.24,"mm":40,"period_hours":24,"observed_at":datetime.now(timezone.utc).isoformat()})
    assert weather.status_code==201,weather.text
    assessment=client.post(API+f"/risk/zones/{zone.json()['id']}/assess",headers=n["authority"]["headers"])
    assert assessment.status_code==200
    assert assessment.json()["score"]>0
    assert "NO probabilidad" in assessment.json()["methodology"]
    assert client.get(API+"/roads/restrictions").json()==[]


def test_map_features_geojson(client,network):
    res=client.get(API+"/map/features?bbox=-76.3,-10.0,-76.1,-9.8",headers=network["dispatcher"]["headers"])
    assert res.status_code==200
    assert res.json()["type"]=="FeatureCollection"
    assert any(f["properties"]["kind"]=="stop" for f in res.json()["features"])


def test_kiosk_passenger_without_account(client,network,actor):
    n=network;admin=actor("admin")
    node=client.post(API+"/edge/nodes",headers=admin["headers"],json={"code":"KIOSK-01","kind":"totem","stop_id":n["stop"]["id"]})
    assert node.status_code==201,node.text
    id=node.json()["id"]
    body={"destination_lat":-9.92,"destination_lon":-76.23,"support":["ramp","audio"],"consent_operational":True}
    ticket=client.post(API+f"/kiosk/{id}/requests",headers={"X-Node-Key":node.json()["node_secret"]},json=body)
    assert ticket.status_code==201,ticket.text
    track=client.post(API+"/kiosk/tracking",json={"token":ticket.json()["tracking_token"]})
    assert track.status_code==200 and track.json()["state"]=="requested"
    assert client.post(API+"/kiosk/tracking",json={"token":"invalid-token-with-lots-of-wrong-bytes-abcdef"}).status_code==401
    assert client.post(API+f"/edge/nodes/{id}/signals",headers={"X-Node-Key":node.json()["node_secret"]},json={"event_type":"bay_obstruction","confidence":.95,"observed_at":datetime.now(timezone.utc).isoformat()}).status_code==401


def test_onboard_journey_interrupted_by_road_closure(client,network):
    n=network;aid=ready_trip(client,n)
    assert client.patch(API+f"/stops/{n['stop']['id']}/bay",headers=n["dispatcher"]["headers"],json={"status":"clear","note":"Se verificó el estado de la bahía"}).status_code==200
    assert client.post(API+f"/assistance/{aid}/accept",headers=n["driver"]["headers"]).status_code==200
    assert client.post(API+f"/assistance/{aid}/board",headers=n["driver"]["headers"]).status_code==200
    closure=client.post(API+"/roads/restrictions",headers=n["authority"]["headers"],json={"name":"Tramo interrumpido","geometry":{"type":"LineString","coordinates":[[-76.235,-9.932],[-76.235,-9.918]]},"confirmation_note":"Autoridad verifica que hay un corte en la carretera"})
    assert closure.status_code==201
    state=client.get(API+f"/assistance/{aid}",headers=n["passenger"]["headers"]).json()["state"]
    assert state=="interrupted"
    assert client.post(API+f"/assistance/{aid}/complete",headers=n["passenger"]["headers"]).status_code==409


def test_report_rate_limits_persisted(client,network):
    h=network["passenger"]["headers"]
    payload={"kind":"road_damage","description":"Pavimento deteriorado y señalización dañada en el tramo", "lat":-9.93,"lon":-76.24}
    codes=[client.post(API+"/reports",headers=h,json=payload).status_code for _ in range(6)]
    assert codes==[201]*5+[429]


def test_accessible_space_reservations_prevent_overbooking(client,network,actor):
    n=network; first=ready_trip(client,n)
    second_passenger=actor("passenger")
    other=client.post(API+"/assistance",headers=second_passenger["headers"],json={"stop_id":n["stop"]["id"],"destination_lat":-9.92,"destination_lon":-76.23,"support":["ramp"],"consent_operational":True})
    assert other.status_code==201
    response=client.post(API+f"/assistance/{other.json()['id']}/offer",headers=n["dispatcher"]["headers"],json={"vehicle_id":n["vehicle"]["id"],"route_id":n["route_id"]})
    assert response.status_code==409
    assert "comprometida" in str(response.json())
    assert first!=other.json()["id"]


def test_edge_rejects_raw_image_fields(client,network,actor):
    n=network;admin=actor("admin")
    node=client.post(API+"/edge/nodes",headers=admin["headers"],json={"code":"EDGE-RAW","stop_id":n["stop"]["id"]}).json()
    response=client.post(API+f"/edge/nodes/{node['id']}/signals",headers={"X-Node-Key":node["node_secret"]},json={"event_type":"bay_obstruction","confidence":.9,"observed_at":datetime.now(timezone.utc).isoformat(),"frame_base64":"HIDDEN_PRIVATE_FRAME"})
    assert response.status_code==422


def test_stored_events_poll_and_websocket(client,network):
    n=network
    events=client.get(API+"/events?since_id=0",headers=n["authority"]["headers"])
    assert events.status_code==200 and events.json()
    last=events.json()[-1]["id"]
    assert client.get(API+f"/events?since_id={last}",headers=n["authority"]["headers"]).json()==[]
    assert client.get(API+"/events",headers=n["passenger"]["headers"]).status_code==403
    with client.websocket_connect(API+"/ws/events") as ws:
        ws.send_text(n["authority"]["headers"]["Authorization"].split(" ",1)[1])
        connected=ws.receive_json()
        assert connected["type"]=="connected"


def test_authority_resource_decisions_and_candidates(client,network):
    n=network
    zone=client.post(API+"/risk/zones",headers=n["authority"]["headers"],json={"name":"Zona inspeccionable","lat":-9.93,"lon":-76.24,"radius_m":600,"susceptibility":4,"critical_access":True,"source":"Cartografía validada","source_version":"1.0"})
    assert zone.status_code==201
    asset=client.post(API+"/resources",headers=n["authority"]["headers"],json={"code":"MAQ-014","asset_type":"excavator","lat":-9.94,"lon":-76.245})
    assert asset.status_code==201
    aid=asset.json()["id"];zid=zone.json()["id"]
    recommend=client.get(API+f"/resources/recommend/{zid}",headers=n["authority"]["headers"])
    assert recommend.status_code==200 and recommend.json()["status"]=="unverified_candidates"
    deploy=client.post(API+f"/resources/{aid}/decision",headers=n["authority"]["headers"],json={"zone_id":zid,"action":"deploy","reason":"Se requiere movilización inmediata"})
    assert deploy.status_code==409  # cannot deploy from available without preparation
    prepare=client.post(API+f"/resources/{aid}/decision",headers=n["authority"]["headers"],json={"zone_id":zid,"action":"prepare","reason":"Disposición preventiva aprobada por autoridad"})
    assert prepare.status_code==201 and prepare.json()["asset_state"]=="prepared"
    assert client.post(API+f"/resources/{aid}/decision",headers=n["passenger"]["headers"],json={"zone_id":zid,"action":"deploy","reason":"Persona no autorizada solicita salida"}).status_code==403
    deploy=client.post(API+f"/resources/{aid}/decision",headers=n["authority"]["headers"],json={"zone_id":zid,"action":"deploy","reason":"Revisión institucional confirma ejecución"})
    assert deploy.status_code==201 and deploy.json()["requires_field_execution"] is True


def test_forecast_not_mixed_with_observation(client,network,monkeypatch):
    n=network
    zone=client.post(API+"/risk/zones",headers=n["authority"]["headers"],json={"name":"Zona hidrometeorológica","lat":-9.93,"lon":-76.24,"radius_m":1500,"susceptibility":5,"critical_access":True,"source":"Mapa susceptible","source_version":"1"})
    assert zone.status_code==201
    from app.api import resilience
    monkeypatch.setattr(resilience,"forecast_24h",lambda lat,lon:{"kind":"forecast","source":"Open-Meteo","source_ref":"forecast-model-1","lat":lat,"lon":lon,"mm":80.0,"period_hours":24,"observed_at":now_utc()})
    forecast=client.post(API+f"/risk/zones/{zone.json()['id']}/refresh-forecast",headers=n["authority"]["headers"])
    assert forecast.status_code==200,forecast.text
    assert forecast.json()["kind"]=="forecast"
    outlook=client.post(API+f"/risk/zones/{zone.json()['id']}/outlook",headers=n["authority"]["headers"])
    assert outlook.status_code==200 and outlook.json()["data_kind"]=="forecast"
    observed=client.post(API+f"/risk/zones/{zone.json()['id']}/assess",headers=n["authority"]["headers"])
    assert observed.status_code==200
    assert "0.0 mm" in str(observed.json()["reasons"])  # forecast excluded from observation-based score
    assert client.get(API+"/roads/restrictions").json()==[]


def test_interrupted_journey_can_recover_on_new_verified_route(client,network):
    n=network;aid=ready_trip(client,n)
    assert client.patch(API+f"/stops/{n['stop']['id']}/bay",headers=n["dispatcher"]["headers"],json={"status":"clear","note":"Bahía físicamente verificada"}).status_code==200
    assert client.post(API+f"/assistance/{aid}/accept",headers=n["driver"]["headers"]).status_code==200
    assert client.post(API+f"/assistance/{aid}/board",headers=n["driver"]["headers"]).status_code==200
    client.post(API+"/roads/restrictions",headers=n["authority"]["headers"],json={"name":"Corte de tramo principal","geometry":{"type":"LineString","coordinates":[[-76.235,-9.932],[-76.235,-9.918]]},"confirmation_note":"Cierre por inspección vial de autoridad"})
    from app.models import RoutePlan
    from app.db import SessionLocal
    with SessionLocal() as db:
        alt=RoutePlan(requested_by=n["dispatcher"]["id"],geometry={"type":"LineString","coordinates":[[-76.24,-9.93],[-76.24,-9.914],[-76.23,-9.914],[-76.23,-9.92]]},origin=[-76.24,-9.93],destination=[-76.23,-9.92],distance_m=2200,duration_s=550,status="candidate")
        db.add(alt);db.commit();db.refresh(alt);alt_id=alt.id
    verified=client.post(API+f"/routes/{alt_id}/verify",headers=n["inspector"]["headers"],json={"note":"Desvío alternativo inspeccionado y habilitado"})
    assert verified.status_code==200,verified.text
    recover=client.post(API+f"/assistance/{aid}/recover",headers=n["dispatcher"]["headers"],json={"route_id":alt_id,"vehicle_id":n["vehicle"]["id"]})
    assert recover.status_code==200 and recover.json()["state"]=="onboard"
    complete=client.post(API+f"/assistance/{aid}/complete",headers=n["passenger"]["headers"])
    assert complete.status_code==200


def test_worker_expires_pending_and_clears_operational_support(client,network):
    n=network
    req=client.post(API+"/assistance",headers=n["passenger"]["headers"],json={"stop_id":n["stop"]["id"],"destination_lat":-9.92,"destination_lon":-76.23,"support":["ramp"],"consent_operational":True})
    assert req.status_code==201
    from datetime import timedelta
    with SessionLocal() as db:
        a=db.get(Assistance,req.json()["id"])
        a.expires_at=now_utc()-timedelta(minutes=1)
        db.commit()
    from app.workers import maintenance_once
    outcome=maintenance_once()
    assert outcome["expired"]==1
    result=client.get(API+"/assistance/"+req.json()["id"],headers=n["passenger"]["headers"]).json()
    assert result["state"]=="expired" and result["support"]==[]


def test_administrator_can_create_staff(client,actor):
    admin=actor("admin")
    r=client.post(API+"/auth/staff",headers=admin["headers"],json={"email":"new.inspector@example.org","password":"LongEnoughStaffPass123","role":"inspector"})
    assert r.status_code==201
    assert r.json()["role"]=="inspector"
    bad=client.post(API+"/auth/staff",headers=actor("passenger")["headers"],json={"email":"wrong@example.org","password":"LongEnoughStaffPass123","role":"admin"})
    assert bad.status_code==403


def test_jwt_logout_revokes_access(client,network):
    n=network
    assert client.get(API+"/auth/me",headers=n["passenger"]["headers"]).status_code==200
    out=client.post(API+"/auth/logout",headers=n["passenger"]["headers"])
    assert out.status_code==200 and out.json()["session"]=="revoked"
    assert client.get(API+"/auth/me",headers=n["passenger"]["headers"]).status_code==401
