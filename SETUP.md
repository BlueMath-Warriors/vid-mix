# Setup and run

This guide covers how to install dependencies, fetch FFmpeg WebAssembly (required for export), start the app, and optionally run tests and linters.

## Requirements

- **Python 3.10+**
- A modern **desktop browser** (Chromium- or Firefox-based recommended for WebAssembly and media APIs)
- **Network access** only for the one-time download of `ffmpeg-core.wasm` (unless you copy it in manually)

Optional:

- **Node.js** — only if you want to run ESLint on legacy scripts under `static/js/`

## 1. Clone the repository

```bash
git clone <repository-url>
```

## 2. Python virtual environment and dependencies

**Windows (PowerShell):**

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

**macOS / Linux:**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

For **reproducible installs** (e.g. CI), you can use `pip install -r requirements.lock` after reading the comment at the top of `requirements.lock`. Refresh that file when you change `requirements.txt` or `requirements-dev.txt`.

## 3. FFmpeg WebAssembly (export)

Export needs **`ffmpeg-core.wasm`** next to **`ffmpeg-core.js`** under `static/libs/ffmpeg/`. It is not always committed; fetch it after clone:

**Windows (PowerShell), from the project root:**

```powershell
.\scripts\fetch_ffmpeg_wasm.ps1
```

**macOS / Linux:**

```bash
chmod +x scripts/fetch_ffmpeg_wasm.sh
./scripts/fetch_ffmpeg_wasm.sh
```

Then verify:

```text
GET http://127.0.0.1:5050/api/health
```

The JSON should include **`ffmpeg_wasm: true`** when the file is present.

## 4. Run the application

With the venv activated:

```bash
python app.py
```

- **`FLASK_DEBUG`:** Set `FLASK_DEBUG=0` to run **without** Flask’s debug reloader (e.g. demos or scripted runs). The default favors **debug mode** for local development.

Open **http://127.0.0.1:5050/** — a new project is created and you are redirected to **`/p/<project-id>`**.

### Where data lives

| Path | Contents |
|------|----------|
| `storage/editor.db` | SQLite database |
| `storage/uploads/<project_id>/` | Uploaded media files |

### Timeline cleanup

If the timeline references media that no longer exists, the editor removes those segments, may show a short warning, and saves the cleaned timeline to the server.

## 5. Development tools (optional)

Install dev dependencies:

```bash
pip install -r requirements-dev.txt
```

**Tests:**

```bash
python -m pytest tests/ -v
```

**Ruff (Python):**

```bash
python -m ruff check app.py tests
python -m ruff format app.py tests
```

**ESLint (legacy JS):**

```bash
npm ci
npm run lint:js
```

**Pre-commit:** Optional hooks are defined in `.pre-commit-config.yaml` (Ruff on `app.py` and `tests/`).

## 6. Smoke checks (optional)

- **`GET /api/health`** — `ffmpeg_wasm: true` when WASM is installed
- Create a project; upload an `.mp4` with a generic `Content-Type`
- **`GET /media/<project>/<upload>/wrong.bin`** — expect **404**
- Open an invalid **`/p/<id>`** — use **Create new project** or **Go home**

## Internal API (reference)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health + `ffmpeg_wasm` flag |
| `GET`, `POST` | `/api/projects` | List / create projects |
| `GET`, `PUT`, `DELETE` | `/api/projects/<id>` | Read / update / delete project |
| `GET` | `/api/projects/<id>/assets` | List uploads |
| `POST` | `/api/projects/<id>/upload` | Multipart field `files` (optional `thumbnail` for video) |
| `DELETE` | `/api/projects/<id>/uploads/<upload_id>` | Remove upload |
| `GET` | `/media/<project_id>/<upload_id>/<filename>` | Serve uploaded bytes |

---

Return to the project overview: [README.md](README.md).
