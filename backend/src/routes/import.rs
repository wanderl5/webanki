use crate::{
    error::{AppError, AppResult},
    models::{
        tags_to_string, CardCandidate, CommitImportRequest, ImportResponse, PreviewImportRequest,
        PreviewImportResponse, TextImportRequest, UrlImportRequest,
    },
    routes::auth::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Multipart, State},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use chrono::Utc;
use reqwest::multipart::{Form, Part};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/text", post(import_text))
        .route("/url", post(import_url))
        .route("/image", post(import_image))
        .route("/image/clean", post(clean_image))
        .route("/preview", post(preview_import))
        .route("/commit", post(commit_import))
        .route("/file", post(import_file))
}

async fn import_text(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Json(req): Json<TextImportRequest>,
) -> AppResult<Json<ImportResponse>> {
    verify_deck(&state, &req.deck_id, &id).await?;
    let preview = call_ai_process_text(&state, &req.deck_id, &req.text, false).await?;
    let imported = insert_cards(&state, &id, &req.deck_id, &preview.cards).await?;
    Ok(Json(ImportResponse {
        imported,
        message: format!("Imported {imported} cards from text"),
    }))
}

async fn import_url(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Json(req): Json<UrlImportRequest>,
) -> AppResult<Json<ImportResponse>> {
    verify_deck(&state, &req.deck_id, &id).await?;
    let preview = call_ai_process_url(&state, &req.deck_id, &req.url, req.use_ai).await?;
    let imported = insert_cards(&state, &id, &req.deck_id, &preview.cards).await?;
    Ok(Json(ImportResponse {
        imported,
        message: format!("Imported {imported} cards from URL"),
    }))
}

async fn preview_import(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Json(req): Json<PreviewImportRequest>,
) -> AppResult<Json<PreviewImportResponse>> {
    verify_deck(&state, &req.deck_id, &id).await?;

    if let Some(text) = req.text {
        let mut preview = call_ai_process_text(&state, &req.deck_id, &text, req.use_ai).await?;
        preview.deck_id = req.deck_id;
        return Ok(Json(preview));
    }

    if let Some(url) = req.url {
        let mut preview = call_ai_process_url(&state, &req.deck_id, &url, req.use_ai).await?;
        preview.deck_id = req.deck_id;
        return Ok(Json(preview));
    }

    Err(AppError::BadRequest("text or url required".into()))
}

async fn commit_import(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Json(req): Json<CommitImportRequest>,
) -> AppResult<Json<ImportResponse>> {
    verify_deck(&state, &req.deck_id, &id).await?;
    let imported = insert_cards(&state, &id, &req.deck_id, &req.cards).await?;
    Ok(Json(ImportResponse {
        imported,
        message: format!("Imported {imported} cards"),
    }))
}

async fn import_file(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    mut multipart: Multipart,
) -> AppResult<Json<PreviewImportResponse>> {
    let mut deck_id: Option<String> = None;
    let mut file_part: Option<(String, Vec<u8>)> = None;
    let mut use_ai = true;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "deck_id" => deck_id = Some(field.text().await.map_err(|e| AppError::BadRequest(format!("{e}")))?),
            "use_ai" => {
                let val = field.text().await.map_err(|e| AppError::BadRequest(format!("{e}")))?;
                use_ai = val.parse().unwrap_or(true);
            }
            "file" => {
                let filename = field.file_name().unwrap_or("upload").to_string();
                let data = field.bytes().await.map_err(|e| AppError::BadRequest(format!("{e}")))?;
                file_part = Some((filename, data.to_vec()));
            }
            _ => {}
        }
    }

    let deck_id = deck_id.ok_or_else(|| AppError::BadRequest("deck_id required".into()))?;
    let (filename, data) = file_part.ok_or_else(|| AppError::BadRequest("file required".into()))?;
    verify_deck(&state, &deck_id, &id).await?;

    let preview = call_ai_process_file(&state, &deck_id, &filename, data, use_ai).await?;
    Ok(Json(PreviewImportResponse {
        deck_id,
        cards: preview.cards,
        ai_fallback_used: preview.ai_fallback_used,
        source: preview.source,
    }))
}

async fn clean_image(
    State(state): State<AppState>,
    CurrentUser { .. }: CurrentUser,
    mut multipart: Multipart,
) -> AppResult<impl IntoResponse> {
    let mut file_part: Option<(String, Vec<u8>)> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))? {
        if field.name().unwrap_or("") == "file" {
            let filename = field.file_name().unwrap_or("upload").to_string();
            let data = field.bytes().await.map_err(|e| AppError::BadRequest(format!("{e}")))?;
            file_part = Some((filename, data.to_vec()));
        }
    }

    let (filename, data) = file_part.ok_or_else(|| AppError::BadRequest("file required".into()))?;
    let client = reqwest::Client::new();
    let url = format!("{}/process/image/clean", state.config.ai_service_url.trim_end_matches('/'));
    let part = Part::bytes(data).file_name(filename.to_string());
    let form = Form::new().part("file", part);

    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("AI service unavailable: {e}")))?;

    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("AI service error: {msg}")));
    }

    let bytes = res.bytes().await.map_err(|e| AppError::Internal(format!("read cleaned image: {e}")))?;
    let mime = mime_guess::from_path(&filename).first_or_octet_stream();

    Ok((
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, mime.to_string())],
        bytes,
    ))
}

async fn import_image(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    mut multipart: Multipart,
) -> AppResult<Json<PreviewImportResponse>> {
    let mut deck_id: Option<String> = None;
    let mut file_part: Option<(String, Vec<u8>)> = None;
    let mut remove_handwriting = false;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "deck_id" => deck_id = Some(field.text().await.map_err(|e| AppError::BadRequest(format!("{e}")))?),
            "remove_handwriting" => {
                let val = field.text().await.map_err(|e| AppError::BadRequest(format!("{e}")))?;
                remove_handwriting = val.parse().unwrap_or(false);
            }
            "file" => {
                let filename = field.file_name().unwrap_or("upload").to_string();
                let data = field.bytes().await.map_err(|e| AppError::BadRequest(format!("{e}")))?;
                file_part = Some((filename, data.to_vec()));
            }
            _ => {}
        }
    }

    let deck_id = deck_id.ok_or_else(|| AppError::BadRequest("deck_id required".into()))?;
    let (filename, data) = file_part.ok_or_else(|| AppError::BadRequest("file required".into()))?;
    verify_deck(&state, &deck_id, &id).await?;

    let preview = call_ai_process_image(&state, &deck_id, &filename, data, remove_handwriting).await?;
    Ok(Json(PreviewImportResponse {
        deck_id,
        cards: preview.cards,
        ai_fallback_used: preview.ai_fallback_used,
        source: preview.source,
    }))
}

async fn verify_deck(state: &AppState, deck_id: &str, user_id: &str) -> AppResult<()> {
    let _ = sqlx::query_as::<_, crate::models::Deck>(
        "SELECT * FROM decks WHERE id = ? AND user_id = ?",
    )
    .bind(deck_id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("deck not found".into()))?;
    Ok(())
}

async fn insert_cards(
    state: &AppState,
    user_id: &str,
    deck_id: &str,
    cards: &[CardCandidate],
) -> AppResult<usize> {
    let now = Utc::now().naive_utc();
    let mut imported = 0usize;
    for c in cards {
        if c.front.trim().is_empty() || c.back.trim().is_empty() {
            continue;
        }
        let card_id = crate::models::new_id();
        let tags = tags_to_string(&c.tags);
        sqlx::query(
            "INSERT INTO cards (
                id, user_id, deck_id, front, back, tags, media, state, due,
                stability, difficulty, elapsed_days, scheduled_days, reps, lapses,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&card_id)
        .bind(user_id)
        .bind(deck_id)
        .bind(&c.front)
        .bind(&c.back)
        .bind(&tags)
        .bind("[]")
        .bind("New")
        .bind(now)
        .bind(0.0)
        .bind(0.0)
        .bind(0i64)
        .bind(0i64)
        .bind(0i64)
        .bind(0i64)
        .bind(now)
        .bind(now)
        .execute(&state.pool)
        .await?;
        imported += 1;
    }
    Ok(imported)
}

#[derive(serde::Deserialize)]
struct AiImportResponse {
    cards: Vec<CardCandidate>,
    ai_fallback_used: bool,
    source: String,
}

async fn call_ai_process_text(
    state: &AppState,
    deck_id: &str,
    text: &str,
    use_ai: bool,
) -> AppResult<PreviewImportResponse> {
    let client = reqwest::Client::new();
    let url = format!("{}/process/text", state.config.ai_service_url.trim_end_matches('/'));
    let res = client
        .post(&url)
        .json(&serde_json::json!({
            "content": text,
            "deck_id": deck_id,
            "use_ai": use_ai,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("AI service unavailable: {e}")))?;

    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("AI service error: {msg}")));
    }

    let data: AiImportResponse = res.json().await.map_err(|e| AppError::Internal(format!("AI response parse error: {e}")))?;
    Ok(PreviewImportResponse {
        deck_id: deck_id.to_string(),
        cards: data.cards,
        ai_fallback_used: data.ai_fallback_used,
        source: data.source,
    })
}

async fn call_ai_process_url(
    state: &AppState,
    deck_id: &str,
    url: &str,
    use_ai: bool,
) -> AppResult<PreviewImportResponse> {
    let client = reqwest::Client::new();
    let endpoint = format!("{}/process/url", state.config.ai_service_url.trim_end_matches('/'));
    let res = client
        .post(&endpoint)
        .json(&serde_json::json!({
            "url": url,
            "deck_id": deck_id,
            "use_ai": use_ai,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("AI service unavailable: {e}")))?;

    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("AI service error: {msg}")));
    }

    let data: AiImportResponse = res.json().await.map_err(|e| AppError::Internal(format!("AI response parse error: {e}")))?;
    Ok(PreviewImportResponse {
        deck_id: deck_id.to_string(),
        cards: data.cards,
        ai_fallback_used: data.ai_fallback_used,
        source: data.source,
    })
}

async fn call_ai_process_file(
    state: &AppState,
    deck_id: &str,
    filename: &str,
    data: Vec<u8>,
    use_ai: bool,
) -> AppResult<PreviewImportResponse> {
    let client = reqwest::Client::new();
    let url = format!("{}/process/file", state.config.ai_service_url.trim_end_matches('/'));
    let part = Part::bytes(data).file_name(filename.to_string());
    let form = Form::new()
        .text("deck_id", deck_id.to_string())
        .text("use_ai", use_ai.to_string())
        .part("file", part);

    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("AI service unavailable: {e}")))?;

    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("AI service error: {msg}")));
    }

    let data: AiImportResponse = res.json().await.map_err(|e| AppError::Internal(format!("AI response parse error: {e}")))?;
    Ok(PreviewImportResponse {
        deck_id: deck_id.to_string(),
        cards: data.cards,
        ai_fallback_used: data.ai_fallback_used,
        source: data.source,
    })
}

async fn call_ai_process_image(
    state: &AppState,
    deck_id: &str,
    filename: &str,
    data: Vec<u8>,
    remove_handwriting: bool,
) -> AppResult<PreviewImportResponse> {
    let client = reqwest::Client::new();
    let url = format!("{}/process/image", state.config.ai_service_url.trim_end_matches('/'));
    let part = Part::bytes(data).file_name(filename.to_string());
    let form = Form::new()
        .text("deck_id", deck_id.to_string())
        .text("remove_handwriting", remove_handwriting.to_string())
        .part("file", part);

    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("AI service unavailable: {e}")))?;

    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("AI service error: {msg}")));
    }

    let data: AiImportResponse = res.json().await.map_err(|e| AppError::Internal(format!("AI response parse error: {e}")))?;
    Ok(PreviewImportResponse {
        deck_id: deck_id.to_string(),
        cards: data.cards,
        ai_fallback_used: data.ai_fallback_used,
        source: data.source,
    })
}
