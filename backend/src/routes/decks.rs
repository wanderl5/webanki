use crate::{
    error::{AppError, AppResult},
    models::{CreateDeckRequest, Deck, DeckWithCount, UpdateDeckRequest},
    routes::auth::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use chrono::Utc;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_decks).post(create_deck))
        .route("/search", get(search_decks))
        .route("/:id", get(get_deck).put(update_deck).delete(delete_deck))
        .route("/:id/cards", get(list_deck_cards))
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: String,
}

async fn search_decks(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<Vec<DeckWithCount>>> {
    let pattern = format!("%{q}%", q = query.q);
    let decks = sqlx::query_as::<_, DeckWithCount>(
        "SELECT d.*, COUNT(c.id) as card_count
         FROM decks d
         LEFT JOIN cards c ON c.deck_id = d.id
         WHERE d.user_id = ? AND (
             d.name LIKE ? OR
             d.id IN (
                 SELECT DISTINCT deck_id FROM cards
                 WHERE user_id = ? AND (front LIKE ? OR back LIKE ? OR tags LIKE ?)
             )
         )
         GROUP BY d.id
         ORDER BY d.name",
    )
    .bind(&id)
    .bind(&pattern)
    .bind(&id)
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(decks))
}

async fn list_decks(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
) -> AppResult<Json<Vec<DeckWithCount>>> {
    let decks = sqlx::query_as::<_, DeckWithCount>(
        "SELECT d.*, COUNT(c.id) as card_count
         FROM decks d
         LEFT JOIN cards c ON c.deck_id = d.id
         WHERE d.user_id = ?
         GROUP BY d.id
         ORDER BY d.name",
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(decks))
}

async fn create_deck(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Json(req): Json<CreateDeckRequest>,
) -> AppResult<Json<Deck>> {
    if req.name.is_empty() {
        return Err(AppError::BadRequest("deck name required".into()));
    }
    let config = serde_json::to_string(&req.config).unwrap_or_else(|_| "{}".to_string());
    let deck_id = crate::models::new_id();
    let now = Utc::now().naive_utc();

    let deck = sqlx::query_as::<_, Deck>(
        "INSERT INTO decks (id, user_id, parent_id, name, config, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(&deck_id)
    .bind(&id)
    .bind(&req.parent_id)
    .bind(&req.name)
    .bind(&config)
    .bind(now)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(deck))
}

async fn get_deck(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(deck_id): Path<String>,
) -> AppResult<Json<Deck>> {
    let deck = sqlx::query_as::<_, Deck>("SELECT * FROM decks WHERE id = ? AND user_id = ?")
        .bind(&deck_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("deck not found".into()))?;
    Ok(Json(deck))
}

async fn would_create_cycle(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    deck_id: &str,
    new_parent_id: &str,
) -> AppResult<bool> {
    let mut current = new_parent_id.to_string();
    loop {
        if current == deck_id {
            return Ok(true);
        }
        let parent: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT parent_id FROM decks WHERE id = ? AND user_id = ?",
        )
        .bind(&current)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
        match parent {
            Some((Some(p),)) => current = p,
            _ => return Ok(false),
        }
    }
}

async fn update_deck(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(deck_id): Path<String>,
    Json(req): Json<UpdateDeckRequest>,
) -> AppResult<Json<Deck>> {
    if let Some(ref parent_id) = req.parent_id {
        if parent_id == &deck_id {
            return Err(AppError::BadRequest("deck cannot be its own parent".into()));
        }
        if would_create_cycle(&state.pool, &id, &deck_id, parent_id).await? {
            return Err(AppError::BadRequest(
                "cannot move deck into its own subtree".into(),
            ));
        }
    }

    let deck = sqlx::query_as::<_, Deck>(
        "UPDATE decks SET name = ?, parent_id = ? WHERE id = ? AND user_id = ? RETURNING *",
    )
    .bind(&req.name)
    .bind(&req.parent_id)
    .bind(&deck_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("deck not found".into()))?;
    Ok(Json(deck))
}

async fn delete_deck(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(deck_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let result = sqlx::query("DELETE FROM decks WHERE id = ? AND user_id = ?")
        .bind(&deck_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("deck not found".into()));
    }
    Ok(Json(serde_json::json!({"deleted": true})))
}

#[derive(Debug, Deserialize)]
struct DeckCardsQuery {
    #[serde(default)]
    managed: Option<bool>,
}

async fn list_deck_cards(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(deck_id): Path<String>,
    Query(query): Query<DeckCardsQuery>,
) -> AppResult<Json<Vec<crate::models::CardResponse>>> {
    let mut sql =
        "SELECT * FROM cards WHERE deck_id = ? AND user_id = ?".to_string();
    if let Some(managed) = query.managed {
        sql.push_str(&format!(" AND managed = {}", if managed { 1 } else { 0 }));
    }
    sql.push_str(" ORDER BY created_at DESC");

    let cards = sqlx::query_as::<_, crate::models::Card>(&sql)
        .bind(&deck_id)
        .bind(&id)
        .fetch_all(&state.pool)
        .await?;

    let card_ids: Vec<String> = cards.iter().map(|c| c.id.clone()).collect();
    let links = crate::routes::cards::load_card_links(&state, &card_ids).await?;

    let responses: Vec<crate::models::CardResponse> = cards
        .iter()
        .map(|c| {
            let mut resp = crate::models::CardResponse::from(c);
            resp.linked_card_ids = links.get(&resp.id).cloned().unwrap_or_default();
            resp
        })
        .collect();

    Ok(Json(responses))
}
