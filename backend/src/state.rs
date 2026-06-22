use crate::config::AppConfig;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<AppConfig>,
}

impl AppState {
    pub fn new(pool: SqlitePool, config: AppConfig) -> Self {
        Self {
            pool,
            config: Arc::new(config),
        }
    }
}
