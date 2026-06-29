use crate::{
    error::{AppError, AppResult},
    models::{Card, CardResponse, Deck, Rating, ReviewRequest, ReviewResponse, StudyQueueItem},
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
    #[serde(default)]
    include_subdecks: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    mastery: Option<String>,
    #[serde(default)]
    managed: Option<String>,
    #[serde(default)]
    search: Option<String>,
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

fn mastery_level(card: &Card) -> &'static str {
    if card.state == "New" || card.reps == 0 {
        return "Unlearned";
    }
    let lapse_ratio = if card.reps > 0 {
        card.lapses as f64 / card.reps as f64
    } else {
        0.0
    };
    if card.state == "Relearning" || card.difficulty >= 7.5 || lapse_ratio > 0.35 || card.lapses >= 3
    {
        return "Weak";
    }
    if card.reps >= 5
        && lapse_ratio <= 0.1
        && card.difficulty < 4.5
        && card.stability >= 30.0
        && card.state == "Review"
    {
        return "Mastered";
    }
    if card.state == "Learning" || card.difficulty >= 5.5 || lapse_ratio > 0.15 {
        return "Consolidating";
    }
    "Familiar"
}

fn collect_descendant_deck_ids(deck_id: &str, decks: &[Deck]) -> Vec<String> {
    let mut result = vec![deck_id.to_string()];
    let mut queue = vec![deck_id.to_string()];
    while let Some(current) = queue.pop() {
        for d in decks {
            if d.parent_id.as_ref() == Some(&current) && !result.contains(&d.id) {
                result.push(d.id.clone());
                queue.push(d.id.clone());
            }
        }
    }
    result
}

async fn study_queue(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
    Query(query): Query<QueueQuery>,
) -> AppResult<Json<Vec<StudyQueueItem>>> {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let now = Utc::now().naive_utc();

    let include_subdecks = query
        .include_subdecks
        .as_deref()
        .map(|s| s == "true")
        .unwrap_or(false);

    let deck_ids: Option<Vec<String>> = if let Some(deck_id) = &query.deck_id {
        if include_subdecks {
            let decks = sqlx::query_as::<_, Deck>("SELECT * FROM decks WHERE user_id = ?")
                .bind(&id)
                .fetch_all(&state.pool)
                .await?;
            Some(collect_descendant_deck_ids(deck_id, &decks))
        } else {
            Some(vec![deck_id.clone()])
        }
    } else {
        None
    };

    let mut cards: Vec<Card> = if let Some(deck_ids) = &deck_ids {
        if deck_ids.len() == 1 {
            sqlx::query_as::<_, Card>(
                "SELECT * FROM cards WHERE user_id = ? AND deck_id = ? ORDER BY due ASC",
            )
            .bind(&id)
            .bind(&deck_ids[0])
            .fetch_all(&state.pool)
            .await?
        } else {
            let placeholders = deck_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT * FROM cards WHERE user_id = ? AND deck_id IN ({}) ORDER BY due ASC",
                placeholders
            );
            let mut q = sqlx::query_as::<_, Card>(&sql);
            q = q.bind(&id);
            for deck_id in deck_ids {
                q = q.bind(deck_id);
            }
            q.fetch_all(&state.pool).await?
        }
    } else {
        sqlx::query_as::<_, Card>("SELECT * FROM cards WHERE user_id = ? ORDER BY due ASC")
            .bind(&id)
            .fetch_all(&state.pool)
            .await?
    };

    // Apply filters in Rust
    let managed_values: Vec<bool> = query
        .managed
        .as_deref()
        .map(|s| {
            s.split(',')
                .filter_map(|v| match v.trim() {
                    "true" => Some(true),
                    "false" => Some(false),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    if !managed_values.is_empty() {
        cards.retain(|c| managed_values.iter().any(|&m| m == c.managed));
    }
    let state_values: Vec<String> = query
        .state
        .as_deref()
        .map(|s| s.split(',').map(|v| v.trim().to_string()).collect())
        .unwrap_or_default();
    if !state_values.is_empty() {
        cards.retain(|c| state_values.iter().any(|s| s == &c.state));
    }
    let mastery_values: Vec<String> = query
        .mastery
        .as_deref()
        .map(|s| s.split(',').map(|v| v.trim().to_string()).collect())
        .unwrap_or_default();
    if !mastery_values.is_empty() {
        cards.retain(|c| mastery_values.iter().any(|m| m == mastery_level(c)));
    }
    if let Some(search) = query.search {
        let lower = search.to_lowercase();
        cards.retain(|c| {
            c.front.to_lowercase().contains(&lower)
                || c.back.to_lowercase().contains(&lower)
                || c.tags.to_lowercase().contains(&lower)
        });
    }

    let mut items: Vec<StudyQueueItem> = cards
        .iter()
        .take(limit as usize)
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
