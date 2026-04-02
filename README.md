# Video Lab — Local

A **local-first, browser-based video editor** with a small Python backend. You can edit timelines, adjust clips, and export finished videos **without signing in**—everything stays on your machine.

The app pairs a **Flask** server (projects, uploads, SQLite) with a **single-page editor** that runs in the browser. Final rendering uses **FFmpeg in WebAssembly** so encoding happens in your browser tab, not on a separate render farm.

For installation, configuration, and how to run the app, see **[SETUP.md](SETUP.md)**.

## What this project does

- **Projects:** Create named projects; each project stores timeline state and metadata in SQLite under `storage/`.
- **Media:** Upload video, image, and audio files; they are saved on disk under `storage/uploads/<project_id>/` and served back to the editor for preview and export.
- **Editing:** Arrange clips on a timeline, crop and transform segments, apply filter presets, and export a rendered video file.
- **Privacy:** There is **no user accounts or cloud sync**—suitable for offline-capable, anonymous workflows on your own computer.

## Features

| Area | Capabilities |
|------|----------------|
| **Timeline** | Multi-segment timeline with drag-and-drop style editing; mix video, still images, and audio. |
| **Transform & crop** | Per-segment crop with presets and a visual crop UI. |
| **Filters** | Filter presets for creative looks (with reset). |
| **Export** | Encode the timeline to a video file in the browser via FFmpeg WASM, with resolution/quality options; a fallback path may apply when WASM is unavailable (see limitations). |
| **Projects API** | REST-style endpoints to list/create/update/delete projects and uploads (intended for this app, not a public API product). |
| **UI** | Light/dark theme, project title editing, autosave-style persistence of progress to the server. |

The server exposes **`GET /api/health`**, which reports whether `ffmpeg-core.wasm` is present—useful to confirm export readiness after setup.

## Limitations

Understanding these upfront avoids surprises:

- **Security:** The API has **no authentication** and accepts requests on the configured port. The app is designed to run **only on your machine**, bound to **`127.0.0.1`** by default. **Do not expose it to the public internet.**
- **No cloud product features:** There is no remote sign-in or account system, no shared asset library, no AI media libraries, no “save export to cloud,” and no collaboration or sharing—only **SQLite + local files**—see [Local-only design](#local-only-design).
- **Upload size:** Each request is limited to **512 MB** (`MAX_CONTENT_LENGTH` in the Flask app); larger uploads are rejected.
- **Export:** **FFmpeg WASM** is large (~32MB for `ffmpeg-core.wasm`) and may be **omitted from the repo**; you must fetch it for reliable export (see SETUP). Encoding runs in the browser, so **memory and CPU** depend on your device, project length, and resolution—very long or high-resolution exports may be slow or fail on constrained hardware.
- **Codec & format reality:** Browser and WASM stacks impose practical limits on which containers/codecs behave well; stick to common formats (e.g. **MP4** for video) for the smoothest experience.
- **Stale timeline references:** If saved timeline data points at uploads that were deleted, the editor **drops those segments**, shows a warning, and **rewrites** the saved project so the database matches what you see.

## Local-only design

No remote sign-in, no global asset library, no AI video/image library tabs, no cloud “save export to library,” no sharing, and no hosted database or cloud backend—**SQLite and local files only**.

---

**Next step:** [SETUP.md](SETUP.md) — environment, dependencies, FFmpeg WASM, running the server, and optional development tools.
