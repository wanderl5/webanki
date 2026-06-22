use crate::{
    error::{AppError, AppResult},
    models::{Card, CardResponse, Rating, ReviewRequest, ReviewResponse, StudyQueueItem},
    routes::auth::CurrentUser,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::{Duration, NaiveDate, NaiveDateTime, Utc};
use fsrs::{FSRS, MemoryState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/queue", get(study_queue))
        .route("/plan", get(review_plan))
        .route("/:id/review", post(review_card))
}

#[derive(Debug, Deserialize)]
struct QueueQuery {
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    deck_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlanQuery {
    #[serde(default = "default_plan_days")]
    days: i64,
}

fn default_plan_days() -> i64 {
    30
}

#[derive(Debug, Serialize)]
struct ReviewPlanItem {
    date: String,
    count: i64,
    cards: Vec<CardResponse>,
}

async fn review_plan(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Query(query): Query<PlanQuery>,
) -> AppResult<Json<Vec<ReviewPlanItem>>> {
    let days = query.days.clamp(1, 365);
    let now = Utc::now().naive_utc();
    let end = now + Duration::days(days);

    let cards = sqlx::query_as::<_, Card>(
        "SELECT * FROM cards WHERE user_id = ? AND managed = 1 AND due <= ? AND reps > 0 ORDER BY due ASC",
    )
    .bind(&id)
    .bind(end)
    .fetch_all(&state.pool)
    .await?;

    let mut grouped: BTreeMap<NaiveDate, Vec<CardResponse>> = BTreeMap::new();
    for card in &cards {
        let date = card.due.date();
        grouped
            .entry(date)
            .or_default()
            .push(CardResponse::from(card));
    }

    let items: Vec<ReviewPlanItem> = grouped
        .into_iter()
        .map(|(date, cards)| ReviewPlanItem {
            date: date.to_string(),
            count: cards.len() as i64,
            cards,
        })
        .collect();

    Ok(Json(items))
}

async fn study_queue(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Query(query): Query<QueueQuery>,
) -> AppResult<Json<Vec<StudyQueueItem>>> {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let now = Utc::now().naive_utc();

    let cards = if let Some(deck_id) = &query.deck_id {
        sqlx::query_as::<_, Card>(
            "SELECT * FROM cards WHERE user_id = ? AND deck_id = ? AND managed = 1 ORDER BY due ASC LIMIT ?",
        )
        .bind(&id)
        .bind(deck_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, Card>(
            "SELECT * FROM cards WHERE user_id = ? AND managed = 1 ORDER BY due ASC LIMIT ?",
        )
        .bind(&id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    };

    let mut items: Vec<StudyQueueItem> = cards
        .iter()
        .map(|card| {
            let retrievability = compute_retrievability(&state, card, now);
            StudyQueueItem {
                card: CardResponse::from(card),
                retrievability,
            }
        })
        .collect();

    // Order: 1) due cards by retrievability asc, 2) new cards, 3) future cards by retrievability asc
    items.sort_by(|a, b| {
        let a_due = a.card.due <= now;
        let b_due = b.card.due <= now;
        let a_new = a.card.reps == 0;
        let b_new = b.card.reps == 0;

        match (a_due, b_due, a_new, b_new) {
            (true, false, _, _) => std::cmp::Ordering::Less,
            (false, true, _, _) => std::cmp::Ordering::Greater,
            (true, true, _, _) => a
                .retrievability
                .partial_cmp(&b.retrievability)
                .unwrap_or(std::cmp::Ordering::Equal),
            (false, false, true, false) => std::cmp::Ordering::Less,
            (false, false, false, true) => std::cmp::Ordering::Greater,
            _ => a
                .retrievability
                .partial_cmp(&b.retrievability)
                .unwrap_or(std::cmp::Ordering::Equal),
        }
    });

    Ok(Json(items))
}

fn fsrs() -> crate::error::AppResult<FSRS> {
    FSRS::new(Some(&[])).map_err(Into::into)
}

fn compute_retrievability(_state: &AppState, card: &Card, now: NaiveDateTime) -> f32 {
    if card.reps == 0 {
        return 1.0;
    }
    let last_review = card.last_review.unwrap_or(card.created_at);
    let days_elapsed = (now - last_review).num_days().max(0) as u32;
    let memory_state = MemoryState {
        stability: card.stability as f32,
        difficulty: card.difficulty as f32,
    };
    fsrs()
        .map(|fsrs| fsrs.current_retrievability(memory_state, days_elapsed))
        .unwrap_or(1.0)
}

async fn review_card(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Path(card_id): Path<String>,
    Json(req): Json<ReviewRequest>,
) -> AppResult<Json<ReviewResponse>> {
    let card = sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE id = ? AND user_id = ?")
        .bind(&card_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("card not found".into()))?;

    let now = Utc::now();
    let now_naive = now.naive_utc();

    let (memory_state, days_elapsed) = if card.reps == 0 {
        (None, 0u32)
    } else {
        let last_review = card.last_review.unwrap_or(card.created_at);
        let elapsed = (now_naive - last_review).num_days().max(0) as u32;
        (
            Some(MemoryState {
                stability: card.stability as f32,
                difficulty: card.difficulty as f32,
            }),
            elapsed,
        )
    };

    let next_states = fsrs()?
        .next_states(memory_state, state.config.desired_retention, days_elapsed)?;

    let item_state = match req.rating {
        Rating::Again => &next_states.again,
        Rating::Hard => &next_states.hard,
        Rating::Good => &next_states.good,
        Rating::Easy => &next_states.easy,
    };

    let interval_days = item_state.interval.round().max(1.0) as i64;
    let new_due = now_naive + Duration::days(interval_days);
    let new_state = next_state_name(&card.state, req.rating);
    let new_reps = card.reps + 1;
    let new_lapses = if req.rating.is_again() {
        card.lapses + 1
    } else {
        card.lapses
    };

    let updated = sqlx::query_as::<_, Card>(
        "UPDATE cards SET
            state = ?, due = ?, stability = ?, difficulty = ?,
            elapsed_days = ?, scheduled_days = ?, reps = ?, lapses = ?,
            last_review = ?, updated_at = ?
        WHERE id = ? AND user_id = ? RETURNING *",
    )
    .bind(&new_state)
    .bind(new_due)
    .bind(item_state.memory.stability as f64)
    .bind(item_state.memory.difficulty as f64)
    .bind(days_elapsed as i64)
    .bind(interval_days)
    .bind(new_reps)
    .bind(new_lapses)
    .bind(now_naive)
    .bind(now_naive)
    .bind(&card_id)
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    // Insert review log
    let review_id = crate::models::new_id();
    sqlx::query(
        "INSERT INTO reviews (id, user_id, card_id, rating, state, elapsed_days, scheduled_days, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&review_id)
    .bind(&id)
    .bind(&card_id)
    .bind(req.rating.as_u32() as i64)
    .bind(&new_state)
    .bind(days_elapsed as i64)
    .bind(interval_days)
    .bind(now_naive)
    .execute(&state.pool)
    .await?;

    Ok(Json(ReviewResponse {
        card: CardResponse::from(&updated),
        interval_days,
    }))
}

fn next_state_name(current: &str, rating: Rating) -> String {
    match (current, rating) {
        ("New", Rating::Again) => "Learning".to_string(),
        ("New", _) => "Review".to_string(),
        ("Review", Rating::Again) => "Relearning".to_string(),
        _ => "Review".to_string(),
    }
}
