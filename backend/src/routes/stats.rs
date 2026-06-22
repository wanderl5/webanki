use crate::{
    error::AppResult,
    models::StatsResponse,
    routes::auth::CurrentUser,
    state::AppState,
};
use axum::{extract::State, routing::get, Json, Router};
use chrono::Utc;

pub fn routes() -> Router<AppState> {
    Router::new().route("/", get(get_stats))
}

async fn get_stats(
    State(state): State<AppState>,
    CurrentUser { id }: CurrentUser,
) -> AppResult<Json<StatsResponse>> {
    let now = Utc::now().naive_utc();
    let today_start = now.date().and_hms_opt(0, 0, 0).unwrap_or(now);

    let total_cards: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cards WHERE user_id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    let due_today: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM cards WHERE user_id = ? AND due <= ?")
            .bind(&id)
            .bind(now)
            .fetch_one(&state.pool)
            .await?;

    let reviewed_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT card_id) FROM reviews WHERE user_id = ? AND reviewed_at >= ?",
    )
    .bind(&id)
    .bind(today_start)
    .fetch_one(&state.pool)
    .await?;

    let new_cards: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM cards WHERE user_id = ? AND reps = 0",
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    // Approximate retention as fraction of due cards with retrievability above 0.5
    let retention: f64 = sqlx::query_scalar(
        "SELECT COALESCE(AVG(CASE WHEN stability > 0 AND scheduled_days > 0 THEN 1.0 ELSE 0.0 END), 0.0) FROM cards WHERE user_id = ? AND reps > 0",
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(StatsResponse {
        total_cards,
        due_today,
        reviewed_today,
        new_cards,
        retention,
    }))
}
