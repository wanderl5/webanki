use anyhow::Result;
use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database_url: String,
    pub jwt_secret: String,
    pub host: String,
    pub port: u16,
    pub desired_retention: f32,
    pub ai_service_url: String,
    pub media_dir: PathBuf,
}

impl AppConfig {
    pub fn from_env() -> Result<Self> {
        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://web-anki.db".to_string());
        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| {
            eprintln!("WARNING: JWT_SECRET not set, using hardcoded development secret");
            "dev-secret-change-me".to_string()
        });
        let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);
        let desired_retention = env::var("DESIRED_RETENTION")
            .ok()
            .and_then(|r| r.parse().ok())
            .unwrap_or(0.9f32)
            .clamp(0.7, 0.97);
        let ai_service_url = env::var("AI_SERVICE_URL")
            .unwrap_or_else(|_| "http://localhost:8001".to_string());
        let media_dir = env::var("MEDIA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./media"));

        Ok(Self {
            database_url,
            jwt_secret,
            host,
            port,
            desired_retention,
            ai_service_url,
            media_dir,
        })
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
