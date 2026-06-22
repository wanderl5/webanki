pub mod auth;
pub mod cards;
pub mod decks;
pub mod export;
pub mod import;
pub mod media;
pub mod stats;
pub mod study;

use axum::Router;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .nest("/auth", auth::routes())
        .nest("/decks", decks::routes())
        .nest("/cards", cards::routes())
        .nest("/study", study::routes())
        .nest("/import", import::routes())
        .nest("/stats", stats::routes())
        .nest("/media", media::routes())
        .nest("/export", export::routes())
}
