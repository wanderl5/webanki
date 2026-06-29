# Web Anki

A simplified, web-based spaced-repetition memory system inspired by Anki — with
hierarchical decks, linked cards, Markdown + LaTeX content, media attachments,
FSRS scheduling, and optional AI-assisted import.

## Features

- **Card = Note** — no separation between notes and cards, so the data model stays simple.
- **FSRS scheduling** — review intervals are computed by the [FSRS](https://github.com/open-spaced-repetition/fsrs-rs) algorithm with a configurable target retention.
- **Hierarchical decks** — unlimited nesting via `parent_id`, with cycle-safe move/edit and a tree view in the UI.
- **Linked cards** — relate cards to each other and view linked cards while studying.
- **Rich content** — Markdown editor with live preview, KaTeX math (`$inline$` / `$$display$$`), and a plain-fraction helper.
- **Media attachments** — upload images and audio; images render with a lightbox, audio with a player. Unreferenced media is cleaned up automatically.
- **Flexible study** — the system builds a suggested review queue, but you can filter, search, and browse any card at any time; a review-forecast plan shows upcoming load.
- **Assisted import** — extract cards from text, PDF, web pages (URL), images (OCR + vision), and `.apkg` files, with a preview/edit step before committing.
- **AI fallback** — an LLM is used only when rule-based extraction yields nothing; works without an API key by emitting placeholder cards so the flow never breaks.
- **Anki interop** — import and export `.apkg` deck files (via the Python service).

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend — React 19 + TypeScript + Vite     │
│  Tailwind CSS 4                              │
│  http://localhost:5173                       │
└───────────────────┬──────────────────────────┘
                    │  /api, /uploads  (Vite proxy / nginx)
┌───────────────────▼──────────────────────────┐
│  Backend — Rust + Axum + SQLite (sqlx)       │
│  fsrs-rs scheduling · JWT auth · media serve │
│  http://localhost:3000                       │
└───────────────────┬──────────────────────────┘
                    │  HTTP (import / export proxy)
┌───────────────────▼──────────────────────────┐
│  AI Service — Python + FastAPI (optional)     │
│  content parsing · LLM cards · apkg export    │
│  http://localhost:8001                       │
└───────────────────────────────────────────────┘
```

## Project Structure

```
web-anki/
├── backend/       # Rust API server (auth, decks, cards, study, media, import/export)
├── frontend/      # React SPA
├── ai-service/    # Python FastAPI content-processing & apkg service (optional)
├── scripts/       # Helper scripts (smoke_test.sh)
├── data/          # SQLite database (created at runtime)
├── media/         # Uploaded media files (created at runtime)
├── DESIGN.md      # Architecture & design notes
├── PRD.md         # Product requirements
└── AGENTS.md      # Contributor / agent guide
```

## Prerequisites

- **Rust** (stable, with Cargo) for the backend
- **Node.js 18+** and npm for the frontend
- **Python 3.10+** for the AI service (optional)
- For image OCR in the AI service, Tesseract data is bundled under `ai-service/tessdata/` (Chinese + English).

## Quick Start

### 1. Backend

```bash
cd backend
cargo run
```

Runs on `http://localhost:3000`. On first start it creates the SQLite database
and applies the migrations in `backend/migrations/` automatically.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`. The dev server proxies `/api` and `/uploads`
to the backend (see `frontend/vite.config.ts`). To expose it on your network:

```bash
npm run dev -- --host 0.0.0.0
```

### 3. AI Service (optional)

Needed for PDF/URL/image/apkg import, LLM generation, and apkg export.

```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

Runs on `http://localhost:8001`. Without it, manual card creation and study
work fine, but import/export endpoints that depend on it return errors.

## Configuration

Copy `.env.example` to `.env` and fill in what you need. Note that
`.env.example` ships only the secrets/LLM keys; the remaining backend variables
below have working defaults and only need to be set when you want to override them.

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite://web-anki.db` | SQLite database location |
| `JWT_SECRET` | `dev-secret-change-me` | JWT signing key — **must be changed in production** |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `3000` | Listen port |
| `MEDIA_DIR` | `./media` | Directory for uploaded media |
| `AI_SERVICE_URL` | `http://localhost:8001` | URL of the Python AI service |
| `DESIRED_RETENTION` | `0.9` | FSRS target retention (clamped to `0.7`–`0.97`) |

### AI Service

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | `openai`, `claude`, or `local` |
| `LLM_API_KEY` | *(empty)* | API key; empty ⇒ placeholder-card fallback |
| `LLM_MODEL` | *(provider default)* | e.g. `gpt-4o-mini`, `claude-3-5-haiku-20241022`, `qwen2.5-7b-instruct` |
| `LLM_BASE_URL` | *(provider default)* | Custom API base URL |

## API Overview

All backend routes are prefixed with `/api`; everything except `auth` requires a
`Authorization: Bearer <token>` header (JWT, HS256, 7-day expiry; passwords are
bcrypt-hashed).

| Group | Endpoints |
|-------|-----------|
| **Auth** | `POST /auth/register`, `POST /auth/login` |
| **Decks** | `GET/POST /decks`, `GET /decks/search`, `GET/PUT/DELETE /decks/:id`, `GET /decks/:id/cards` |
| **Cards** | `POST /cards`, `GET/PUT/DELETE /cards/:id`, `POST /cards/:id/reset` |
| **Study** | `GET /study/queue`, `GET /study/plan`, `POST /study/:id/review` |
| **Import** | `POST /import/{text,url,image,image/clean,preview,commit,file}` |
| **Stats** | `GET /stats` |
| **Media** | `POST /media/upload`, `POST /media/cleanup`, `GET /media/:filename` |
| **Export** | `GET /export/apkg/:deck_id` |

Uploaded media is served as static files under `/uploads/<uuid>.<ext>`.

The AI service exposes `POST /process/{text,url,file,image,image/clean,image/ocr,llm}`
and `POST /export/apkg`, plus `GET /health`.

## Development

```bash
# Backend
cd backend
cargo check
cargo test

# Frontend
cd frontend
npm run build          # tsc -b && vite build
npx eslint src/        # lint app code only (avoids scanning node_modules/.venv-browser)

# End-to-end smoke test (backend must be running; AI service for the import steps)
BASE_URL=http://localhost:3000 ./scripts/smoke_test.sh
```

`scripts/smoke_test.sh` walks the core API: register → login → create deck →
create card → list → study queue → review → stats → import preview/commit.

## Documentation

- `DESIGN.md` — architecture and design decisions
- `PRD.md` — product requirements and milestones
- `AGENTS.md` — contributor/agent guide (build commands, conventions, gotchas)

## License

MIT
