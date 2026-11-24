from app.db import SessionLocal
from app.models import EdgeNode


def test_nodes_listing_is_admin_only_and_excludes_secret_hash(client, network, actor):
    admin = actor("admin")
    response = client.post("/api/v1/edge/nodes", headers=admin["headers"], json={
        "kind": "totem", "code": "TEST-TOTEM", "stop_id": network["stop"]["id"],
    })
    assert response.status_code == 201
    created = response.json()
    assert "node_secret" in created
    for headers in ({}, network["passenger"]["headers"], network["authority"]["headers"]):
        assert client.get("/api/v1/edge/nodes", headers=headers).status_code in (401, 403)
    listed = client.get("/api/v1/edge/nodes", headers=admin["headers"])
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == created["id"]
    assert set(listed.json()[0]) == {"id", "code", "kind", "stop_id", "vehicle_id", "enabled", "last_seen_at", "created_at", "updated_at"}
    assert "secret_hash" not in listed.text and "node_secret" not in listed.text
    assert created["node_secret"] not in listed.text
    with SessionLocal() as db:
        assert db.get(EdgeNode, created["id"]).secret_hash not in listed.text
