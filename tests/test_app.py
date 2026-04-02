"""Smoke tests for standalone video editor API."""

from __future__ import annotations

import io

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Isolated storage + DB per test."""
    import app as app_module

    st = tmp_path / "storage"
    st.mkdir(parents=True)
    (st / "uploads").mkdir(parents=True)
    db_path = st / "editor.db"
    monkeypatch.setattr(app_module, "STORAGE_DIR", st)
    monkeypatch.setattr(app_module, "UPLOADS_ROOT", st / "uploads")
    monkeypatch.setattr(app_module, "DB_PATH", db_path)
    app_module.init_db()
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("ok") is True
    assert "ffmpeg_wasm" in data


def test_create_and_get_project(client):
    r = client.post("/api/projects", json={"title": "Pytest Project"})
    assert r.status_code == 201
    body = r.get_json()
    assert body.get("success") is True
    pid = body["project"]["id"]
    r2 = client.get(f"/api/projects/{pid}")
    assert r2.status_code == 200
    assert r2.get_json()["project"]["title"] == "Pytest Project"


def test_upload_mp4_octet_stream(client):
    r = client.post("/api/projects", json={"title": "U"})
    pid = r.get_json()["project"]["id"]
    data = {
        "files": (io.BytesIO(b"notrealmp4"), "clip.mp4"),
    }
    up = client.post(
        f"/api/projects/{pid}/upload",
        data=data,
        content_type="multipart/form-data",
    )
    assert up.status_code == 200
    assert up.get_json().get("success") is True


def test_serve_media_wrong_filename_404(client):
    r = client.post("/api/projects", json={"title": "M"})
    pid = r.get_json()["project"]["id"]
    data = {"files": (io.BytesIO(b"x"), "a.mp4")}
    up = client.post(
        f"/api/projects/{pid}/upload",
        data=data,
        content_type="multipart/form-data",
    )
    uploads = up.get_json()["uploads"]
    assert len(uploads) == 1
    uid = uploads[0]["id"]
    bad = client.get(f"/media/{pid}/{uid}/not-the-file.bin")
    assert bad.status_code == 404


def test_get_project_404(client):
    r = client.get("/api/projects/nonexistent-project-id-00000000")
    assert r.status_code == 404
    assert r.get_json().get("error") is True


def test_put_progress_roundtrip(client):
    r = client.post("/api/projects", json={"title": "Progress"})
    pid = r.get_json()["project"]["id"]
    progress = {"timeline": [], "zoomLevel": 7}
    put = client.put(f"/api/projects/{pid}", json={"progress_data": progress})
    assert put.status_code == 200
    assert put.get_json()["project"]["progress_data"] == progress
    get = client.get(f"/api/projects/{pid}")
    assert get.get_json()["project"]["progress_data"] == progress


def test_put_project_404(client):
    put = client.put(
        "/api/projects/missing-id-xxxxxxxx",
        json={"title": "Nope"},
    )
    assert put.status_code == 404


def test_delete_upload(client):
    r = client.post("/api/projects", json={"title": "DelUp"})
    pid = r.get_json()["project"]["id"]
    up = client.post(
        f"/api/projects/{pid}/upload",
        data={"files": (io.BytesIO(b"v"), "v.mp4")},
        content_type="multipart/form-data",
    )
    uid = up.get_json()["uploads"][0]["id"]
    d = client.delete(f"/api/projects/{pid}/uploads/{uid}")
    assert d.status_code == 200
    assert d.get_json().get("success") is True
    assets = client.get(f"/api/projects/{pid}/assets")
    assert assets.get_json().get("count") == 0


def test_delete_upload_404(client):
    r = client.post("/api/projects", json={"title": "X"})
    pid = r.get_json()["project"]["id"]
    d = client.delete(f"/api/projects/{pid}/uploads/upload_not_real")
    assert d.status_code == 404


def test_upload_missing_files_field_400(client):
    r = client.post("/api/projects", json={"title": "BadUp"})
    pid = r.get_json()["project"]["id"]
    bad = client.post(f"/api/projects/{pid}/upload", data={})
    assert bad.status_code == 400


def test_upload_no_valid_files_400(client):
    r = client.post("/api/projects", json={"title": "InvalidExt"})
    pid = r.get_json()["project"]["id"]
    bad = client.post(
        f"/api/projects/{pid}/upload",
        data={"files": (io.BytesIO(b"zzz"), "notes.xyzunknown")},
        content_type="multipart/form-data",
    )
    assert bad.status_code == 400


def test_delete_project(client):
    r = client.post("/api/projects", json={"title": "ToDelete"})
    pid = r.get_json()["project"]["id"]
    d = client.delete(f"/api/projects/{pid}")
    assert d.status_code == 200
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_media_serves_bytes_after_upload(client):
    r = client.post("/api/projects", json={"title": "Media"})
    pid = r.get_json()["project"]["id"]
    payload = b"%PDF-fake"[:8]
    up = client.post(
        f"/api/projects/{pid}/upload",
        data={"files": (io.BytesIO(payload), "doc.mp4")},
        content_type="multipart/form-data",
    )
    row = up.get_json()["uploads"][0]
    url = row["download_url"]
    assert url.startswith("/")
    get = client.get(url)
    assert get.status_code == 200
    assert get.data == payload
