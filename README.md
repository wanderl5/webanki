# Web Anki

A simplified web-based spaced repetition system inspired by Anki.

## Tech Stack

- **Backend**: Rust + Axum + SQLite + FSRS
- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **AI Service**: Python + FastAPI for automatic card generation and LLM fallback

## Project Structure

```
web-anki/
├── backend/       # Rust API server
├── frontend/      # React SPA
├── ai-service/    # Python content processing service
└── DESIGN.md      # Design document
```

## Quick Start

### Backend

```bash
cd backend
cargo run
```

Server runs on `http://localhost:3000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

### AI Service (optional)

```bash
cd ai-service
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

## Design Highlights

- **Card = Note**: No separation between notes and cards; simpler data model.
- **Flexible Study**: System provides a suggested review queue, but users can study or browse any card at any time.
- **Automatic Import**: Python service extracts knowledge from text, PDF, web pages, audio, and images.
- **AI Fallback**: LLM is used only when rule-based extraction fails or produces low-quality cards.

## License

MIT
