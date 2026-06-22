use crate::{
    error::{AppError, AppResult},
    models::Card,
    routes::auth::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

pub fn routes() -> Router<AppState> {
    Router::new().route("/apkg/:deck_id", get(export_apkg))
}

#[derive(Debug, Serialize)]
struct ApkgCard {
    front: String,
    back: String,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ApkgMediaFile {
    filename: String,
    data: String,
}

#[derive(Debug, Serialize)]
struct ApkgExportPayload {
    deck_name: String,
    cards: Vec<ApkgCard>,
    media_files: Vec<ApkgMediaFile>,
}

async fn export_apkg(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(deck_id): Path<String>,
) -> AppResult<impl IntoResponse> {
    let deck = sqlx::query_as::<_, crate::models::Deck>(
        "SELECT * FROM decks WHERE id = ? AND user_id = ?",
    )
    .bind(&deck_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("deck not found".into()))?;

    let cards = sqlx::query_as::<_, Card>(
        "SELECT * FROM cards WHERE deck_id = ? AND user_id = ? ORDER BY created_at DESC",
    )
    .bind(&deck_id)
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    let client = reqwest::Client::new();

    // Collect all image URLs referenced in card fields.
    let mut urls = HashSet::new();
    for c in &cards {
        urls.extend(collect_image_urls(&c.front));
        urls.extend(collect_image_urls(&c.back));
    }

    // Resolve each URL to a unique local filename and its bytes.
    let mut media_map: HashMap<String, (String, Vec<u8>)> = HashMap::new();
    let mut used_names: HashSet<String> = HashSet::new();
    for url in urls {
        if let Some(entry) = resolve_media(&url, &state, &client, &mut used_names).await {
            media_map.insert(url, entry);
        }
    }

    let apkg_cards: Vec<ApkgCard> = cards
        .iter()
        .map(|c| ApkgCard {
            front: replace_image_references(&c.front, &media_map),
            back: replace_image_references(&c.back, &media_map),
            tags: c.tags_vec(),
        })
        .collect();

    let media_files: Vec<ApkgMediaFile> = media_map
        .into_values()
        .map(|(filename, data)| ApkgMediaFile {
            filename,
            data: BASE64.encode(&data),
        })
        .collect();

    let payload = ApkgExportPayload {
        deck_name: deck.name.clone(),
        cards: apkg_cards,
        media_files,
    };

    let url = format!("{}/export/apkg", state.config.ai_service_url.trim_end_matches('/'));
    let res = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("AI service unavailable: {e}")))?;

    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!("AI service error: {msg}")));
    }

    let bytes = res.bytes().await.map_err(|e| AppError::Internal(format!("read apkg: {e}")))?;
    let filename = format!("{}.apkg", deck.name.replace("::", "_"));

    Ok((
        StatusCode::OK,
        [
            (axum::http::header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", filename),
            ),
        ],
        bytes,
    ))
}

fn collect_image_urls(text: &str) -> Vec<String> {
    let mut urls = HashSet::new();

    let md_re = Regex::new(r"!\[(.*?)\]\((.*?)\)").unwrap();
    for caps in md_re.captures_iter(text) {
        if let Some(m) = caps.get(2) {
            urls.insert(m.as_str().to_string());
        }
    }

    let img_re = Regex::new(r#"(?i)<img\s+[^>]*?src=["']([^"']+)["'][^>]*?>"#).unwrap();
    for caps in img_re.captures_iter(text) {
        if let Some(m) = caps.get(1) {
            urls.insert(m.as_str().to_string());
        }
    }

    urls.into_iter().collect()
}

fn replace_image_references(text: &str, media_map: &HashMap<String, (String, Vec<u8>)>) -> String {
    let mut html = text.to_string();

    // Markdown images -> <img> tags pointing at the local media filename.
    let md_re = Regex::new(r"!\[(.*?)\]\((.*?)\)").unwrap();
    html = md_re
        .replace_all(&html, |caps: &regex::Captures| {
            let alt = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let url = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            match media_map.get(url) {
                Some((filename, _)) if alt.is_empty() => format!(r#"<img src="{}">"#, filename),
                Some((filename, _)) => format!(r#"<img src="{}" alt="{}">"#, filename, html_escape(alt)),
                None => "[image]".to_string(),
            }
        })
        .into_owned();

    // Existing <img> tags -> rewrite src to local media filename.
    let img_re = Regex::new(r#"(?i)<img\s+[^>]*?src=["']([^"']+)["'][^>]*?>"#).unwrap();
    html = img_re
        .replace_all(&html, |caps: &regex::Captures| {
            let whole = caps.get(0).unwrap().as_str();
            let url = caps.get(1).unwrap().as_str();
            match media_map.get(url) {
                Some((filename, _)) => whole.replace(url, filename),
                None => whole.to_string(),
            }
        })
        .into_owned();

    html
}

async fn resolve_media(
    url: &str,
    state: &AppState,
    client: &reqwest::Client,
    used_names: &mut HashSet<String>,
) -> Option<(String, Vec<u8>)> {
    let (proposed_name, data) = if let Some(name) = url.strip_prefix("/uploads/") {
        let path = state.config.media_dir.join(name);
        let data = tokio::fs::read(&path).await.ok()?;
        (name.to_string(), data)
    } else if url.starts_with("http://") || url.starts_with("https://") {
        let res = client.get(url).send().await.ok()?;
        let ext = content_type_ext(res.headers().get(reqwest::header::CONTENT_TYPE));
        let base = url_file_name(url).unwrap_or_else(|| "media".to_string());
        let name = if std::path::Path::new(&base)
            .extension()
            .is_some()
        {
            base
        } else {
            format!("{}.{}", base, ext.unwrap_or("bin"))
        };
        let data = res.bytes().await.ok()?.to_vec();
        (name, data)
    } else {
        return None;
    };

    let unique_name = unique_filename(&proposed_name, used_names);
    used_names.insert(unique_name.clone());
    Some((unique_name, data))
}

fn unique_filename(proposed: &str, used_names: &mut HashSet<String>) -> String {
    if !proposed.is_empty() && !used_names.contains(proposed) {
        return proposed.to_string();
    }
    let path = std::path::Path::new(proposed);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media");
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("bin");
    let mut i = 1;
    loop {
        let candidate = format!("{}_{}.{}", stem, i, ext);
        if !used_names.contains(&candidate) {
            return candidate;
        }
        i += 1;
    }
}

fn url_file_name(url: &str) -> Option<String> {
    let parsed = url.parse::<reqwest::Url>().ok()?;
    parsed
        .path_segments()
        .and_then(|segments| segments.last())
        .map(sanitize_filename)
}

fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => c,
            _ => '_',
        })
        .collect();
    if s.is_empty() {
        "media".to_string()
    } else {
        s
    }
}

fn content_type_ext(content_type: Option<&reqwest::header::HeaderValue>) -> Option<&'static str> {
    let ct = content_type?.to_str().ok()?;
    if ct.starts_with("image/png") {
        Some("png")
    } else if ct.starts_with("image/jpeg") {
        Some("jpg")
    } else if ct.starts_with("image/gif") {
        Some("gif")
    } else if ct.starts_with("image/webp") {
        Some("webp")
    } else if ct.starts_with("audio/mpeg") || ct.starts_with("audio/mp3") {
        Some("mp3")
    } else if ct.starts_with("audio/ogg") {
        Some("ogg")
    } else if ct.starts_with("audio/wav") {
        Some("wav")
    } else {
        None
    }
}

fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
