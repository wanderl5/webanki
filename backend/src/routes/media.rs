use crate::{
    error::{AppError, AppResult},
    routes::auth::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use regex::Regex;
use std::collections::HashSet;
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/upload", post(upload_media))
        .route("/cleanup", post(cleanup_media))
        .route("/:filename", get(serve_media))
}

async fn upload_media(
    State(state): State<AppState>,
    CurrentUser { .. }: CurrentUser,
    mut multipart: Multipart,
) -> AppResult<Json<serde_json::Value>> {
    let media_dir = &state.config.media_dir;
    fs::create_dir_all(media_dir).await.map_err(|e| AppError::Internal(format!("create media dir: {e}")))?;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))? {
        if field.name().unwrap_or("") != "file" {
            continue;
        }
        let filename = field.file_name().unwrap_or("upload").to_string();
        let ext = std::path::Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");
        let safe_name = format!("{}.{}", Uuid::new_v4(), ext);
        let path = media_dir.join(&safe_name);
        let data = field.bytes().await.map_err(|e| AppError::BadRequest(format!("{e}")))?;

        let mut file = fs::File::create(&path).await.map_err(|e| AppError::Internal(format!("create file: {e}")))?;
        file.write_all(&data).await.map_err(|e| AppError::Internal(format!("write file: {e}")))?;

        let url = format!("/uploads/{}", safe_name);
        return Ok(Json(serde_json::json!({
            "url": url,
            "filename": safe_name,
            "original_name": filename,
        })));
    }

    Err(AppError::BadRequest("no file uploaded".into()))
}

async fn serve_media(
    State(state): State<AppState>,
    axum::extract::Path(filename): axum::extract::Path<String>,
) -> AppResult<impl IntoResponse> {
    let path = state.config.media_dir.join(&filename);
    if !path.exists() {
        return Err(AppError::NotFound("file not found".into()));
    }

    let body = fs::read(&path).await.map_err(|e| AppError::Internal(format!("read file: {e}")))?;
    let mime = mime_guess::from_path(&path).first_or_octet_stream();

    Ok((
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, mime.to_string())],
        body,
    ))
}

async fn cleanup_media(
    State(state): State<AppState>,
    CurrentUser { .. }: CurrentUser,
) -> AppResult<Json<serde_json::Value>> {
    let deleted = cleanup_unreferenced_media(&state).await?;
    Ok(Json(serde_json::json!({
        "deleted": deleted,
        "count": deleted.len(),
    })))
}

pub async fn cleanup_unreferenced_media(state: &AppState) -> AppResult<Vec<String>> {
    let referenced = collect_referenced_media(&state.pool).await?;

    let media_dir = &state.config.media_dir;
    fs::create_dir_all(media_dir).await.map_err(|e| AppError::Internal(format!("create media dir: {e}")))?;

    let mut deleted = Vec::new();
    let mut entries = fs::read_dir(media_dir).await.map_err(|e| AppError::Internal(format!("read media dir: {e}")))?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| AppError::Internal(format!("read dir entry: {e}")))? {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        if referenced.contains(&filename) {
            continue;
        }
        fs::remove_file(&path).await.map_err(|e| AppError::Internal(format!("remove file: {e}")))?;
        deleted.push(filename);
    }

    Ok(deleted)
}

async fn collect_referenced_media(pool: &sqlx::SqlitePool) -> AppResult<HashSet<String>> {
    let cards = sqlx::query_as::<_, (String, String, String)>("SELECT front, back, media FROM cards")
        .fetch_all(pool)
        .await?;

    let re = Regex::new(r#"/uploads/([^\s"'<>()]+)"#).unwrap();
    let mut referenced = HashSet::new();

    for (front, back, media_json) in cards {
        for text in [&front, &back] {
            for cap in re.captures_iter(text) {
                if let Some(m) = cap.get(1) {
                    referenced.insert(m.as_str().to_string());
                }
            }
        }

        let media: Vec<crate::models::MediaItem> =
            serde_json::from_str(&media_json).unwrap_or_default();
        for item in media {
            if let Some(name) = std::path::Path::new(&item.url)
                .file_name()
                .and_then(|s| s.to_str())
            {
                referenced.insert(name.to_string());
            }
        }
    }

    Ok(referenced)
}
