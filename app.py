"""
Standalone video editor API — no authentication.
Intended for local use (bind 127.0.0.1). Do not expose publicly.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_ROOT = STORAGE_DIR / "uploads"
DB_PATH = STORAGE_DIR / "editor.db"
FFMPEG_DIR = BASE_DIR / "static" / "libs" / "ffmpeg"
FFMPEG_WASM_PATH = FFMPEG_DIR / "ffmpeg-core.wasm"

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024  # 512 MB

VIDEO_EXT = frozenset(
    {
        ".mp4",
        ".webm",
        ".mov",
        ".mkv",
        ".avi",
        ".m4v",
        ".ogv",
        ".mpeg",
        ".mpg",
        ".3gp",
    }
)
IMAGE_EXT = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"})
AUDIO_EXT = frozenset({".mp3", ".wav", ".ogg", ".aac", ".m4a", ".flac", ".opus", ".wma"})


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'Untitled',
            description TEXT,
            preview_data TEXT,
            progress_data TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_uploads (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            stored_filename TEXT NOT NULL,
            media_type TEXT NOT NULL,
            content_type TEXT,
            file_size INTEGER,
            thumbnail_stored_filename TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_uploads_project ON project_uploads(project_id);
        """
    )
    conn.commit()
    conn.close()


def _infer_media_from_extension(filename: str) -> str | None:
    if not filename:
        return None
    ext = Path(filename).suffix.lower()
    if ext in VIDEO_EXT:
        return "video"
    if ext in IMAGE_EXT:
        return "image"
    if ext in AUDIO_EXT:
        return "audio"
    return None


def _classify_file(content_type: str, filename: str) -> str | None:
    ct = (content_type or "").lower()
    if ct.startswith("video/"):
        return "video"
    if ct.startswith("image/"):
        return "image"
    if ct.startswith("audio/"):
        return "audio"
    return _infer_media_from_extension(filename)


def _default_content_type(media_type: str) -> str:
    if media_type == "video":
        return "video/mp4"
    if media_type == "image":
        return "image/jpeg"
    return "audio/mpeg"


def _parse_json_field(raw: str | None):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _row_project(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "title": r["title"],
        "description": r["description"],
        "preview_data": _parse_json_field(r["preview_data"]),
        "progress_data": _parse_json_field(r["progress_data"]),
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }


def _media_url(project_id: str, upload_id: str, filename: str) -> str:
    return f"/media/{project_id}/{upload_id}/{filename}"


def _upload_to_asset_dict(r: sqlite3.Row, project_id: str) -> dict:
    meta = {}
    if r["metadata"]:
        try:
            meta = json.loads(r["metadata"])
        except json.JSONDecodeError:
            meta = {}
    fname = r["stored_filename"]
    url = _media_url(project_id, r["id"], fname)
    thumb_name = r["thumbnail_stored_filename"]
    thumb_url = _media_url(project_id, r["id"], thumb_name) if thumb_name else None
    if thumb_url:
        meta = {**meta, "thumbnail_url": thumb_url}
    return {
        "id": r["id"],
        "video_url": url if r["media_type"] == "video" else None,
        "preview_url": url,
        "download_url": url,
        "original_filename": r["original_filename"],
        "file_size": r["file_size"] or 0,
        "content_type": r["content_type"] or "",
        "media_type": r["media_type"],
        "created_at": r["created_at"],
        "metadata": {
            **meta,
            "media_type": r["media_type"],
            "file_size": r["file_size"] or 0,
            "content_type": r["content_type"] or "",
            "project_id": project_id,
        },
    }


@app.route("/api/health")
def health():
    wasm_ok = FFMPEG_WASM_PATH.is_file()
    return jsonify(
        {
            "ok": True,
            "ffmpeg_wasm": wasm_ok,
            "ffmpeg_wasm_path": str(FFMPEG_WASM_PATH.relative_to(BASE_DIR))
            if wasm_ok
            else str(FFMPEG_WASM_PATH.relative_to(BASE_DIR)),
        }
    )


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/p/<project_id>")
def editor_project(project_id):
    return render_template("index.html")


@app.route("/media/<project_id>/<upload_id>/<path:filename>")
def serve_media(project_id, upload_id, filename):
    conn = get_db()
    row = conn.execute(
        """
        SELECT stored_filename, thumbnail_stored_filename
        FROM project_uploads WHERE project_id = ? AND id = ?
        """,
        (project_id, upload_id),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": True, "message": "Not found"}), 404
    allowed = {row["stored_filename"]}
    if row["thumbnail_stored_filename"]:
        allowed.add(row["thumbnail_stored_filename"])
    if filename not in allowed:
        return jsonify({"error": True, "message": "Not found"}), 404
    directory = UPLOADS_ROOT / project_id / upload_id
    return send_from_directory(directory, filename, conditional=True)


@app.route("/api/projects", methods=["GET"])
def list_projects():
    conn = get_db()
    rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 200").fetchall()
    conn.close()
    return jsonify({"success": True, "projects": [_row_project(r) for r in rows]})


@app.route("/api/projects", methods=["POST"])
def create_project():
    data = request.get_json(silent=True) or {}
    title = data.get("title") or "Untitled"
    description = data.get("description")
    preview_data = data.get("preview_data")
    progress_data = data.get("progress_data")
    pid = str(uuid.uuid4())
    now = _utc_now_iso()
    conn = get_db()
    conn.execute(
        """
        INSERT INTO projects (
            id, title, description, preview_data, progress_data, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pid,
            title,
            description,
            json.dumps(preview_data) if preview_data is not None else None,
            json.dumps(progress_data) if progress_data is not None else None,
            now,
            now,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    conn.close()
    return jsonify({"success": True, "project": _row_project(row)}), 201


@app.route("/api/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": True, "message": "Project not found"}), 404
    return jsonify({"success": True, "project": _row_project(row)})


@app.route("/api/projects/<project_id>", methods=["PUT"])
def update_project(project_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": True, "message": "Project not found"}), 404
    sets: list[str] = []
    params: list = []
    if "title" in data:
        sets.append("title = ?")
        params.append(data.get("title") or "Untitled")
    if "description" in data:
        sets.append("description = ?")
        params.append(data.get("description"))
    if "preview_data" in data:
        pd = data.get("preview_data")
        sets.append("preview_data = ?")
        params.append(json.dumps(pd) if pd is not None else None)
    if "progress_data" in data:
        prog = data.get("progress_data")
        sets.append("progress_data = ?")
        params.append(json.dumps(prog) if prog is not None else None)
    if not sets:
        conn.close()
        return jsonify({"success": True, "project": _row_project(row)})
    now = _utc_now_iso()
    sets.append("updated_at = ?")
    params.append(now)
    params.append(project_id)
    conn.execute(
        f"UPDATE projects SET {', '.join(sets)} WHERE id = ?",
        tuple(params),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return jsonify({"success": True, "project": _row_project(row)})


@app.route("/api/projects/<project_id>", methods=["DELETE"])
def delete_project(project_id):
    conn = get_db()
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    pdir = UPLOADS_ROOT / project_id
    if pdir.is_dir():
        shutil.rmtree(pdir, ignore_errors=True)
    return jsonify({"success": True})


@app.route("/api/projects/<project_id>/assets", methods=["GET"])
def list_project_assets(project_id):
    conn = get_db()
    row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": True, "message": "Project not found"}), 404
    uploads = conn.execute(
        "SELECT * FROM project_uploads WHERE project_id = ? ORDER BY created_at DESC",
        (project_id,),
    ).fetchall()
    conn.close()
    return jsonify(
        {
            "success": True,
            "uploads": [_upload_to_asset_dict(u, project_id) for u in uploads],
            "count": len(uploads),
        }
    )


@app.route("/api/projects/<project_id>/upload", methods=["POST"])
def upload_files(project_id):
    conn = get_db()
    row = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": True, "message": "Project not found"}), 404
    conn.close()

    if "files" not in request.files:
        return jsonify({"error": True, "message": "No files provided"}), 400
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": True, "message": "No files provided"}), 400

    thumbnail_file = request.files.get("thumbnail")
    thumb_bytes: bytes | None = None
    if thumbnail_file:
        try:
            thumb_bytes = thumbnail_file.read()
        except Exception:
            thumb_bytes = None
        if not thumb_bytes:
            thumb_bytes = None

    thumb_consumed = False
    uploaded = []
    proj_dir = UPLOADS_ROOT / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        if not file.filename:
            continue
        raw_ct = file.content_type or ""
        media_type = _classify_file(raw_ct, file.filename)
        if not media_type:
            continue
        file_data = file.read()
        if not file_data:
            continue
        is_video = media_type == "video"
        is_image = media_type == "image"
        content_type = raw_ct.strip() or _default_content_type(media_type)
        upload_id = f"upload_{uuid.uuid4().hex}"
        original = secure_filename(file.filename) or "upload.bin"
        ext = Path(original).suffix or (".mp4" if is_video else ".png" if is_image else ".mp3")
        stored = f"{upload_id}{ext}"
        upload_dir = proj_dir / upload_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        main_path = upload_dir / stored
        main_path.write_bytes(file_data)
        file_size = len(file_data)

        thumb_stored = None
        meta_extra = {
            "source": "user_upload",
            "project_id": project_id,
            "file_size": file_size,
            "content_type": content_type,
            "media_type": media_type,
        }
        if is_video and thumb_bytes and not thumb_consumed:
            try:
                thumb_stored = f"{upload_id}_thumb.jpg"
                (upload_dir / thumb_stored).write_bytes(thumb_bytes)
                thumb_consumed = True
                meta_extra["thumbnail_url"] = _media_url(project_id, upload_id, thumb_stored)
            except Exception:
                thumb_stored = None

        conn = get_db()
        conn.execute(
            """
            INSERT INTO project_uploads (
                id, project_id, original_filename, stored_filename, media_type,
                content_type, file_size, thumbnail_stored_filename, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                upload_id,
                project_id,
                original,
                stored,
                media_type,
                content_type,
                file_size,
                thumb_stored,
                json.dumps(meta_extra),
                _utc_now_iso(),
            ),
        )
        conn.execute(
            "UPDATE projects SET updated_at = ? WHERE id = ?", (_utc_now_iso(), project_id)
        )
        conn.commit()
        urow = conn.execute("SELECT * FROM project_uploads WHERE id = ?", (upload_id,)).fetchone()
        conn.close()
        uploaded.append(_upload_to_asset_dict(urow, project_id))

    if not uploaded:
        return jsonify({"error": True, "message": "No valid files were uploaded"}), 400
    return jsonify({"success": True, "uploads": uploaded, "count": len(uploaded)})


@app.route("/api/projects/<project_id>/uploads/<upload_id>", methods=["DELETE"])
def delete_upload(project_id, upload_id):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM project_uploads WHERE id = ? AND project_id = ?",
        (upload_id, project_id),
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": True, "message": "Upload not found"}), 404
    conn.execute(
        "DELETE FROM project_uploads WHERE id = ? AND project_id = ?",
        (upload_id, project_id),
    )
    conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (_utc_now_iso(), project_id))
    conn.commit()
    conn.close()
    udir = UPLOADS_ROOT / project_id / upload_id
    if udir.is_dir():
        shutil.rmtree(udir, ignore_errors=True)
    return jsonify({"success": True})


init_db()

if __name__ == "__main__":
    print("Open http://127.0.0.1:5050/ — no auth; do not expose to the network.")
    _debug = os.environ.get("FLASK_DEBUG", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    app.run(host="127.0.0.1", port=5050, debug=_debug)
