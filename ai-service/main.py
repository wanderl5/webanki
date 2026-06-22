import base64
import os
import re
import sqlite3
import tempfile
import zipfile
from io import BytesIO
from typing import List, Optional

import fitz  # pymupdf
import httpx
import numpy as np
import trafilatura
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Web Anki AI Service")


# ---------- Configuration ----------

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai").lower()
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "claude": "claude-3-5-haiku-20241022",
    "local": "qwen2.5-7b-instruct",
}

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "claude": "https://api.anthropic.com/v1",
    "local": "http://localhost:8000/v1",
}


def _model() -> str:
    return LLM_MODEL or DEFAULT_MODELS.get(LLM_PROVIDER, "gpt-4o-mini")


def _base_url() -> str:
    return LLM_BASE_URL or DEFAULT_BASE_URLS.get(LLM_PROVIDER, "https://api.openai.com/v1")


# ---------- Models ----------


class CardCandidate(BaseModel):
    front: str
    back: str
    tags: List[str] = []
    source: str = "rule"  # 'rule' | 'ai'


class TextImportRequest(BaseModel):
    content: str
    deck_id: str
    use_ai: bool = True


class ImportResponse(BaseModel):
    cards: List[CardCandidate]
    ai_fallback_used: bool = False
    source: str = "text"


class UrlImportRequest(BaseModel):
    url: str
    deck_id: str
    use_ai: bool = True


class LLMRequest(BaseModel):
    content: str
    deck_id: str


class ApkgMediaFile(BaseModel):
    filename: str
    data: str  # base64 encoded bytes


class ApkgExportRequest(BaseModel):
    deck_name: str
    cards: List[CardCandidate]
    media_files: List[ApkgMediaFile] = []


# ---------- Health ----------


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- Text processing ----------


@app.post("/process/text", response_model=ImportResponse)
def process_text(req: TextImportRequest):
    cards = _rule_based_extract(req.content)
    ai_used = False
    if not cards and req.use_ai:
        cards = _ai_generate(req.content)
        ai_used = True
    return ImportResponse(cards=cards, ai_fallback_used=ai_used, source="text")


# ---------- URL processing ----------


@app.post("/process/url", response_model=ImportResponse)
def process_url(req: UrlImportRequest):
    try:
        downloaded = trafilatura.fetch_url(req.url)
        if not downloaded:
            raise HTTPException(status_code=400, detail="Failed to fetch URL")
        text = trafilatura.extract(downloaded, include_comments=False, include_tables=False)
        if not text:
            raise HTTPException(status_code=400, detail="No extractable content found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"URL processing error: {e}")

    cards = _rule_based_extract(text)
    ai_used = False
    if not cards and req.use_ai:
        cards = _ai_generate(text)
        ai_used = True
    return ImportResponse(cards=cards, ai_fallback_used=ai_used, source="url")


# ---------- File processing ----------


@app.post("/process/file", response_model=ImportResponse)
def process_file(deck_id: str = Form(...), file: UploadFile = File(...), use_ai: bool = Form(True)):
    filename = file.filename or ""
    ext = filename.split(".")[-1].lower()
    content = file.file.read()

    if ext == "pdf":
        text = _extract_pdf(content)
        cards = _rule_based_extract(text)
        source = "pdf"
    elif ext in ("txt", "md", "markdown"):
        text = content.decode("utf-8", errors="ignore")
        cards = _rule_based_extract(text)
        source = "text"
    elif ext == "apkg":
        cards = _extract_apkg(content)
        source = "apkg"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    ai_used = False
    if not cards and use_ai and source != "apkg":
        cards = _ai_generate(text)
        ai_used = True

    return ImportResponse(cards=cards, ai_fallback_used=ai_used, source=source)


# ---------- Image processing ----------


@app.post("/process/image", response_model=ImportResponse)
def process_image(
    deck_id: str = Form(...),
    file: UploadFile = File(...),
    remove_handwriting: bool = Form(False),
):
    content = file.file.read()
    mime = _guess_mime(file.filename or "", content)
    b64 = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{mime};base64,{b64}"

    cards = _ai_generate_from_image(data_url, remove_handwriting)
    return ImportResponse(cards=cards, ai_fallback_used=True, source="image")


@app.post("/process/image/clean")
def process_image_clean(file: UploadFile = File(...)):
    content = file.file.read()
    cleaned = _remove_handwriting_local(content)
    mime = _guess_mime(file.filename or "", content)
    return StreamingResponse(
        BytesIO(cleaned),
        media_type=mime,
        headers={"Content-Disposition": 'attachment; filename="cleaned.png"'},
    )


@app.post("/process/image/ocr")
def process_image_ocr(file: UploadFile = File(...)):
    content = file.file.read()
    mime = _guess_mime(file.filename or "", content)
    b64 = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{mime};base64,{b64}"
    text = _ocr_from_data_url(data_url)
    return {"text": text}


def _remove_handwriting_local(content: bytes) -> bytes:
    import cv2
    import numpy as np

    arr = np.frombuffer(content, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Failed to decode image")

    # Try color-aware removal first (red / blue ink common in annotations).
    mask = _color_ink_mask(img)

    # Fallback to grayscale-based removal if no colored ink was detected.
    if cv2.countNonZero(mask) < 100:
        mask = _gray_ink_mask(img)

    # Close small gaps in strokes, then dilate to cover the full stroke width.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)

    cleaned = cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)
    _, encoded = cv2.imencode(".png", cleaned)
    return encoded.tobytes()


def _color_ink_mask(img: np.ndarray) -> np.ndarray:
    import cv2
    import numpy as np

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    b, g, r = cv2.split(img)

    # Red ink: R is significantly larger than G and B, and not too dark (avoids black text).
    # Lower thresholds catch darker/faded red/brown pens.
    red_diff = cv2.subtract(r, cv2.max(g, b))
    _, red = cv2.threshold(red_diff, 20, 255, cv2.THRESH_BINARY)
    red = cv2.bitwise_and(red, cv2.inRange(r, 50, 255))

    # Blue ink: hue in blue range, reasonably saturated, darker than the light-blue printed grid.
    blue = cv2.inRange(hsv, np.array([85, 60, 40]), np.array([135, 255, 185]))

    return cv2.bitwise_or(red, blue)


def _gray_ink_mask(img: np.ndarray) -> np.ndarray:
    import cv2
    import numpy as np

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Protect very dark printed text.
    _, strong_text = cv2.threshold(gray, 30, 255, cv2.THRESH_BINARY_INV)

    # Mid-tone strokes (lighter than solid print, darker than background).
    light_ink = cv2.inRange(gray, 35, 160)

    # Thin strokes via morphological opening.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    opened = cv2.morphologyEx(gray, cv2.MORPH_OPEN, kernel, iterations=1)
    diff = cv2.subtract(gray, opened)
    _, thin_strokes = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    mask = cv2.bitwise_or(light_ink, thin_strokes)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
    mask = cv2.bitwise_and(mask, cv2.bitwise_not(strong_text))
    return mask


def _guess_mime(filename: str, content: bytes) -> str:
    ext = filename.split(".")[-1].lower()
    mapping = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "bmp": "image/bmp",
    }
    if ext in mapping:
        return mapping[ext]
    if content.startswith(b"\x89PNG"):
        return "image/png"
    if content.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if content.startswith(b"GIF"):
        return "image/gif"
    if content.startswith(b"RIFF"):
        return "image/webp"
    return "image/png"


# ---------- Direct LLM ----------


@app.post("/process/llm", response_model=ImportResponse)
def process_llm(req: LLMRequest):
    cards = _ai_generate(req.content)
    return ImportResponse(cards=cards, ai_fallback_used=True, source="ai")


# ---------- apkg export ----------


@app.post("/export/apkg")
def export_apkg(req: ApkgExportRequest):
    try:
        import genanki
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"genanki not installed: {e}")

    model = genanki.Model(
        1607392319,
        "Simple Model",
        fields=[{"name": "Front"}, {"name": "Back"}],
        templates=[
            {
                "name": "Card 1",
                "qfmt": "{{Front}}",
                "afmt": '{{Front}}<hr id="answer">{{Back}}',
            }
        ],
    )
    deck = genanki.Deck(2059400110, req.deck_name)
    for c in req.cards:
        note = genanki.Note(model=model, fields=[c.front, c.back], tags=c.tags)
        deck.add_note(note)

    media_paths = []
    if req.media_files:
        media_dir = tempfile.mkdtemp()
        for item in req.media_files:
            path = os.path.join(media_dir, os.path.basename(item.filename))
            with open(path, "wb") as f:
                f.write(base64.b64decode(item.data))
            media_paths.append(path)

    tmp = tempfile.NamedTemporaryFile(suffix=".apkg", delete=False)
    genanki.Package(deck, media_files=media_paths).write_to_file(tmp.name)
    return FileResponse(tmp.name, filename=f"{req.deck_name}.apkg", media_type="application/octet-stream")


# ---------- Helpers ----------


def _extract_pdf(data: bytes) -> str:
    text_parts = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for page in doc:
            text_parts.append(page.get_text())
    return "\n\n".join(text_parts)


def _extract_apkg(data: bytes) -> List[CardCandidate]:
    cards = []
    with zipfile.ZipFile(BytesIO(data)) as zf:
        db_name = None
        for name in zf.namelist():
            if name.endswith(".anki2"):
                db_name = name
                break
        if not db_name:
            raise HTTPException(status_code=400, detail="No .anki2 database found in apkg")

        with tempfile.TemporaryDirectory() as tmpdir:
            zf.extract(db_name, tmpdir)
            db_path = os.path.join(tmpdir, db_name)
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            # Anki notes table: flds contains fields separated by \x1f
            try:
                cur.execute("SELECT flds, tags FROM notes")
                for row in cur.fetchall():
                    flds = row[0].split("\x1f")
                    tags = row[1].strip().split() if row[1] else []
                    if len(flds) >= 2 and flds[0].strip() and flds[1].strip():
                        cards.append(CardCandidate(front=flds[0].strip(), back=flds[1].strip(), tags=tags))
            finally:
                conn.close()
    return cards


def _rule_based_extract(content: str) -> List[CardCandidate]:
    cards = []
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    i = 0
    while i < len(lines):
        line = lines[i]
        qa = _split_inline_qa(line)
        if qa:
            cards.append(CardCandidate(front=qa[0], back=qa[1]))
            i += 1
            continue
        if i + 1 < len(lines):
            cards.append(CardCandidate(front=line, back=lines[i + 1]))
            i += 2
            continue
        i += 1
    return cards


def _split_inline_qa(line: str) -> Optional[tuple[str, str]]:
    for sep in ("?", "？", ":", "："):
        if sep in line:
            q, _, a = line.partition(sep)
            if a.strip():
                return (q.strip() + sep, a.strip())
    return None


def _ocr_from_data_url(data_url: str) -> str:
    """Run local Tesseract OCR on a base64 data URL."""
    try:
        import base64
        import cv2
        import numpy as np
        import pytesseract

        _, b64 = data_url.split(",", 1)
        content = base64.b64decode(b64)
        arr = np.frombuffer(content, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return ""

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        tessdata_dir = os.path.join(os.path.dirname(__file__), "tessdata")
        config = f'--tessdata-dir "{tessdata_dir}" -l chi_sim+eng --psm 6'
        text = pytesseract.image_to_string(binary, config=config)
        return text.strip()
    except Exception as e:
        print(f"OCR error: {e}")
        return ""


def _ai_generate_from_image(data_url: str, remove_handwriting: bool = False) -> List[CardCandidate]:
    ocr_text = _ocr_from_data_url(data_url)

    if not LLM_API_KEY and LLM_PROVIDER in ("openai", "claude"):
        if ocr_text:
            return [
                CardCandidate(
                    front=ocr_text[:500],
                    back="Extracted via OCR. Edit or add the answer.",
                    tags=["ocr"],
                    source="ai",
                )
            ]
        return [
            CardCandidate(
                front="Image analysis placeholder",
                back="No API key configured for vision LLM. Set LLM_API_KEY to enable image-to-card generation.",
                tags=["ai-generated"],
                source="ai",
            )
        ]

    extra = " Ignore any handwritten annotations or marks; use only printed or typed text." if remove_handwriting else ""
    ocr_section = ""
    if ocr_text:
        ocr_section = (
            "\n\nHere is the text recognized by OCR from the image (use it as reference, "
            "but verify against the image itself):\n"
            f"{ocr_text[:2000]}"
        )

    prompt = (
        "You are an Anki card generator. Look at the provided image and create concise question-answer flashcards "
        "based on the visual content. For diagrams, ask what the diagram represents; for text-heavy images, "
        "ask key facts and definitions."
        f"{extra}{ocr_section}\n\n"
        "Return ONLY a JSON array in this exact format, with no markdown code block:\n"
        '[{"front": "Question?", "back": "Answer", "tags": ["tag1"]}]\n'
    )

    try:
        if LLM_PROVIDER == "claude":
            cards = _call_claude_vision(prompt, data_url)
        else:
            cards = _call_openai_vision(prompt, data_url)
        if cards:
            return [c.model_copy(update={"source": "ai"}) for c in cards]
    except Exception as e:
        print(f"Vision LLM error: {e}")

    if ocr_text:
        return [
            CardCandidate(
                front=ocr_text[:500],
                back="Vision LLM failed; fallback to OCR text. Please edit.",
                tags=["ocr"],
                source="ai",
            )
        ]

    return [
        CardCandidate(
            front="Image analysis placeholder",
            back="Vision LLM failed to analyze the image.",
            tags=["ai-generated"],
            source="ai",
        )
    ]


def _ai_generate(content: str) -> List[CardCandidate]:
    if not LLM_API_KEY and LLM_PROVIDER in ("openai", "claude"):
        return [
            CardCandidate(
                front="AI fallback placeholder",
                back=content[:500] or "No API key configured for LLM fallback.",
                tags=["ai-generated"],
                source="ai",
            )
        ]

    prompt = (
        "You are an Anki card generator. Given the following content, create concise question-answer flashcards.\n\n"
        "Return ONLY a JSON array in this exact format, with no markdown code block:\n"
        '[{"front": "Question?", "back": "Answer", "tags": ["tag1"]}]\n\n'
        f"Content:\n{content[:8000]}\n"
    )

    try:
        if LLM_PROVIDER == "claude":
            cards = _call_claude(prompt)
        else:
            cards = _call_openai_compatible(prompt)
        if cards:
            return [c.model_copy(update={"source": "ai"}) for c in cards]
    except Exception as e:
        print(f"LLM error: {e}")

    return [
        CardCandidate(
            front="AI fallback placeholder",
            back=content[:500],
            tags=["ai-generated"],
            source="ai",
        )
    ]


def _call_openai_vision(prompt: str, data_url: str) -> List[CardCandidate]:
    model = _model()
    # Use a vision-capable default if the configured model is likely text-only
    if model in ("gpt-4o-mini", "gpt-3.5-turbo", "claude-3-5-haiku-20241022"):
        model = "gpt-4o-mini"
    url = f"{_base_url().rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        "temperature": 0.3,
    }
    with httpx.Client(timeout=120.0) as client:
        r = client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
    return _parse_llm_json(text)


def _call_claude_vision(prompt: str, data_url: str) -> List[CardCandidate]:
    model = _model()
    if model in ("claude-3-5-haiku-20241022",):
        model = "claude-3-5-sonnet-20241022"
    url = f"{_base_url().rstrip('/')}/messages"
    headers = {"x-api-key": LLM_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01"}
    payload = {
        "model": model,
        "max_tokens": 2048,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image", "source": {"type": "base64", "media_type": data_url.split(":")[1].split(";")[0], "data": data_url.split(",")[1]}},
                ],
            }
        ],
    }
    with httpx.Client(timeout=120.0) as client:
        r = client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        text = r.json()["content"][0]["text"]
    return _parse_llm_json(text)


def _call_openai_compatible(prompt: str) -> List[CardCandidate]:
    model = _model()
    url = f"{_base_url().rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }
    with httpx.Client(timeout=60.0) as client:
        r = client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
    return _parse_llm_json(text)


def _call_claude(prompt: str) -> List[CardCandidate]:
    model = _model()
    url = f"{_base_url().rstrip('/')}/messages"
    headers = {"x-api-key": LLM_API_KEY, "Content-Type": "application/json", "anthropic-version": "2023-06-01"}
    payload = {
        "model": model,
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": prompt}],
    }
    with httpx.Client(timeout=60.0) as client:
        r = client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        text = r.json()["content"][0]["text"]
    return _parse_llm_json(text)


def _parse_llm_json(text: str) -> List[CardCandidate]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    data = []
    try:
        import json

        data = json.loads(text)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    cards = []
    for item in data:
        if isinstance(item, dict) and item.get("front") and item.get("back"):
            cards.append(
                CardCandidate(
                    front=str(item["front"]).strip(),
                    back=str(item["back"]).strip(),
                    tags=item.get("tags", []) or [],
                )
            )
    return cards


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
