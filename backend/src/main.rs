use anyhow::Result;
use axum::Router;
use std::time::Duration;
use tokio::time;
use tower_http::{
    cors::CorsLayer,
    services::ServeDir,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use web_anki_backend::{
    config::AppConfig,
    db::init_db,
    routes,
    routes::media::cleanup_unreferenced_media,
    state::AppState,
};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "web_anki_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = AppConfig::from_env()?;
    let pool = init_db(&config).await?;
    let state = AppState::new(pool, config.clone());

    // Periodically clean up uploaded media files no longer referenced by any card.
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        loop {
            time::sleep(Duration::from_secs(24 * 60 * 60)).await;
            match cleanup_unreferenced_media(&cleanup_state).await {
                Ok(deleted) if !deleted.is_empty() => {
                    tracing::info!("cleaned up {} unreferenced media file(s)", deleted.len())
                }
                Ok(_) => tracing::debug!("no unreferenced media to clean up"),
                Err(e) => tracing::error!("media cleanup failed: {e}"),
            }
        }
    });

    let app = Router::new()
        .route("/", axum::routing::get(root))
        .nest("/api", routes::router())
        .nest_service("/uploads", ServeDir::new(&config.media_dir))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&config.bind_addr()).await?;
    tracing::info!("listening on {}", config.bind_addr());
    axum::serve(listener, app).await?;
    Ok(())
}

async fn root() -> &'static str {
    "web-anki backend is running"
}
