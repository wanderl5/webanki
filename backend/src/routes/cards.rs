use crate::{
    error::{AppError, AppResult},
    models::{Card, CardResponse, CreateCardRequest, UpdateCardRequest, media_to_string, tags_to_string},
    routes::auth::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use std::collections::{HashMap, HashSet};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", post(create_card))
        .route("/:id", get(get_card).put(update_card).delete(delete_card))
}

pub async fn load_card_links(
    state: &AppState,
    card_ids: &[String],
) -> AppResult<HashMap<String, Vec<String>>> {
    if card_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders: String = card_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT card_id, linked_card_id FROM card_links WHERE card_id IN ({})",
        placeholders
    );
    let mut query = sqlx::query_as::<_, (String, String)>(&sql);
    for id in card_ids {
        query = query.bind(id);
    }
    let rows = query.fetch_all(&state.pool).await?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for (card_id, linked_id) in rows {
        map.entry(card_id).or_default().push(linked_id);
    }
    Ok(map)
}

async fn validate_links(
    state: &AppState,
    user_id: &str,
    card_id: &str,
    links: &[String],
) -> AppResult<()> {
    if links.is_empty() {
        return Ok(());
    }
    let set: HashSet<String> = links.iter().cloned().collect();
    if set.contains(card_id) {
        return Err(AppError::BadRequest("a card cannot link to itself".into()));
    }
    if set.len() < links.len() {
        return Err(AppError::BadRequest("duplicate linked cards".into()));
    }
    let placeholders: String = set.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT COUNT(*) FROM cards WHERE id IN ({}) AND user_id = ?",
        placeholders
    );
    let mut query = sqlx::query_scalar::<_, i64>(&sql);
    for id in &set {
        query = query.bind(id);
    }
    let count = query.bind(user_id).fetch_one(&state.pool).await?;
    if count != set.len() as i64 {
        return Err(AppError::BadRequest("one or more linked cards not found".into()));
    }
    Ok(())
}

async fn get_card(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(card_id): Path<String>,
) -> AppResult<Json<CardResponse>> {
    let card = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ? AND user_id = ?")
        .bind(&card_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("card not found".into()))?;
    let mut resp = CardResponse::from(&card);
    let links = load_card_links(&state, &[card_id]).await?;
    resp.linked_card_ids = links.get(&resp.id).cloned().unwrap_or_default();
    Ok(Json(resp))
}

async fn create_card(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Json(req): Json<CreateCardRequest>,
) -> AppResult<Json<CardResponse>> {
    if req.front.is_empty() || req.back.is_empty() {
        return Err(AppError::BadRequest("front and back required".into()));
    }

    // verify deck ownership
    let deck = sqlx::query_as::<_, crate::models::Deck>(
        "SELECT * FROM decks WHERE id = ? AND user_id = ?",
    )
    .bind(&req.deck_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("deck not found".into()))?;

    validate_links(&state, &id, "", &req.linked_card_ids).await?;

    let card_id = crate::models::new_id();
    let now = Utc::now().naive_utc();
    let tags = tags_to_string(&req.tags);
    let media = media_to_string(&req.media);
    let managed = req.managed;

    let mut tx = state.pool.begin().await?;

    let card = sqlx::query_as::<_, Card>(
        "INSERT INTO cards (
            id, user_id, deck_id, front, back, tags, media, managed, state, due,
            stability, difficulty, elapsed_days, scheduled_days, reps, lapses,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(&card_id)
    .bind(&id)
    .bind(&deck.id)
    .bind(&req.front)
    .bind(&req.back)
    .bind(&tags)
    .bind(&media)
    .bind(managed)
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
    .fetch_one(&mut *tx)
    .await?;

    for linked_id in &req.linked_card_ids {
        sqlx::query("INSERT INTO card_links (card_id, linked_card_id) VALUES (?, ?)")
            .bind(&card_id)
            .bind(linked_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    let mut resp = CardResponse::from(&card);
    resp.linked_card_ids = req.linked_card_ids;
    Ok(Json(resp))
}

async fn update_card(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(card_id): Path<String>,
    Json(req): Json<UpdateCardRequest>,
) -> AppResult<Json<CardResponse>> {
    let existing = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ? AND user_id = ?")
        .bind(&card_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("card not found".into()))?;

    let front = req.front.unwrap_or(existing.front);
    let back = req.back.unwrap_or(existing.back);
    let tags = req.tags.map(|t| tags_to_string(&t)).unwrap_or(existing.tags);
    let media = req.media.map(|m| media_to_string(&m)).unwrap_or(existing.media);
    let deck_id = req.deck_id.unwrap_or(existing.deck_id);
    let managed = req.managed.unwrap_or(existing.managed);
    let now = Utc::now().naive_utc();

    if let Some(ref links) = req.linked_card_ids {
        validate_links(&state, &id, &card_id, links).await?;
    }

    let mut tx = state.pool.begin().await?;

    let card = sqlx::query_as::<_, Card>(
        "UPDATE cards SET front = ?, back = ?, tags = ?, media = ?, deck_id = ?, managed = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *",
    )
    .bind(&front)
    .bind(&back)
    .bind(&tags)
    .bind(&media)
    .bind(&deck_id)
    .bind(managed)
    .bind(now)
    .bind(&card_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    let linked_card_ids = if let Some(links) = req.linked_card_ids {
        sqlx::query("DELETE FROM card_links WHERE card_id = ?")
            .bind(&card_id)
            .execute(&mut *tx)
            .await?;
        for linked_id in &links {
            sqlx::query("INSERT INTO card_links (card_id, linked_card_id) VALUES (?, ?)")
                .bind(&card_id)
                .bind(linked_id)
                .execute(&mut *tx)
                .await?;
        }
        links
    } else {
        load_card_links(&state, &[card_id.clone()]).await?.get(&card_id).cloned().unwrap_or_default()
    };

    tx.commit().await?;

    let mut resp = CardResponse::from(&card);
    resp.linked_card_ids = linked_card_ids;
    Ok(Json(resp))
}

async fn delete_card(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(card_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let result = sqlx::query("DELETE FROM cards WHERE id = ? AND user_id = ?")
        .bind(&card_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("card not found".into()));
    }
    Ok(Json(serde_json::json!({"deleted": true})))
}
