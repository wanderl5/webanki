# AI Content Processing Service

Python microservice for automatic card generation and AI fallback.

## Run

```bash
cd ai-service
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

## Endpoints

- `GET /health` - health check
- `POST /process/text` - generate cards from text
- `POST /process/file` - generate cards from uploaded file (PDF, etc.)
