use crate::config::AppConfig;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{migrate::MigrateDatabase, SqlitePool};
use std::str::FromStr;

pub async fn init_db(config: &AppConfig) -> anyhow::Result<SqlitePool> {
    if !sqlx::Sqlite::database_exists(&config.database_url).await.unwrap_or(false) {
        sqlx::Sqlite::create_database(&config.database_url).await?;
    }

    let options = SqliteConnectOptions::from_str(&config.database_url)?
        .foreign_keys(true)
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}
