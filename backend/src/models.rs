use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

// ---------- Database models ----------

#[derive(Debug, FromRow, Serialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub username: String,
    pub password_hash: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, FromRow, Serialize)]
pub struct Deck {
    pub id: String,
    pub user_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub config: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, FromRow, Serialize)]
pub struct DeckWithCount {
    pub id: String,
    pub user_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub config: String,
    pub created_at: NaiveDateTime,
    pub card_count: i64,
}

#[derive(Debug, FromRow, Serialize)]
pub struct Card {
    pub id: String,
    pub user_id: String,
    pub deck_id: String,
    pub front: String,
    pub back: String,
    pub tags: String,
    pub media: String,
    pub managed: bool,
    pub state: String,
    pub due: NaiveDateTime,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub last_review: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

impl Card {
    pub fn tags_vec(&self) -> Vec<String> {
        serde_json::from_str(&self.tags).unwrap_or_default()
    }

    pub fn media_vec(&self) -> Vec<MediaItem> {
        serde_json::from_str(&self.media).unwrap_or_default()
    }
}

#[derive(Debug, FromRow, Serialize)]
pub struct Review {
    pub id: String,
    pub user_id: String,
    pub card_id: String,
    pub rating: i64,
    pub state: String,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub reviewed_at: NaiveDateTime,
}

// ---------- Request / Response DTOs ----------

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub email: String,
    pub username: String,
}

impl From<&User> for UserResponse {
    fn from(u: &User) -> Self {
        Self {
            id: u.id.clone(),
            email: u.email.clone(),
            username: u.username.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateDeckRequest {
    pub name: String,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub config: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct UpdateDeckRequest {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub url: String,
    #[serde(rename = "type")]
    pub media_type: String, // "image" | "audio"
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateCardRequest {
    pub deck_id: String,
    pub front: String,
    pub back: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub media: Vec<MediaItem>,
    #[serde(default = "default_managed")]
    pub managed: bool,
    #[serde(default)]
    pub linked_card_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCardRequest {
    pub front: Option<String>,
    pub back: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    pub deck_id: Option<String>,
    #[serde(default)]
    pub media: Option<Vec<MediaItem>>,
    #[serde(default)]
    pub managed: Option<bool>,
    #[serde(default)]
    pub linked_card_ids: Option<Vec<String>>,
}

fn default_managed() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct CardResponse {
    pub id: String,
    pub deck_id: String,
    pub front: String,
    pub back: String,
    pub tags: Vec<String>,
    pub media: Vec<MediaItem>,
    pub managed: bool,
    pub state: String,
    pub due: NaiveDateTime,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub last_review: Option<NaiveDateTime>,
    pub linked_card_ids: Vec<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

impl From<&Card> for CardResponse {
    fn from(c: &Card) -> Self {
        Self {
            id: c.id.clone(),
            deck_id: c.deck_id.clone(),
            front: c.front.clone(),
            back: c.back.clone(),
            tags: c.tags_vec(),
            media: c.media_vec(),
            managed: c.managed,
            state: c.state.clone(),
            due: c.due,
            stability: c.stability,
            difficulty: c.difficulty,
            elapsed_days: c.elapsed_days,
            scheduled_days: c.scheduled_days,
            reps: c.reps,
            lapses: c.lapses,
            last_review: c.last_review,
            linked_card_ids: Vec::new(),
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ReviewRequest {
    pub rating: Rating,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum Rating {
    Again = 1,
    Hard = 2,
    Good = 3,
    Easy = 4,
}

impl Rating {
    pub fn as_u32(self) -> u32 {
        self as u32
    }

    pub fn is_again(self) -> bool {
        matches!(self, Rating::Again)
    }
}

#[derive(Debug, Serialize)]
pub struct StudyQueueItem {
    #[serde(flatten)]
    pub card: CardResponse,
    pub retrievability: f32,
}

#[derive(Debug, Serialize)]
pub struct ReviewResponse {
    pub card: CardResponse,
    pub interval_days: i64,
}

#[derive(Debug, Deserialize)]
pub struct TextImportRequest {
    pub deck_id: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    pub imported: usize,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct UrlImportRequest {
    pub deck_id: String,
    pub url: String,
    #[serde(default)]
    pub use_ai: bool,
}

#[derive(Debug, Deserialize)]
pub struct PreviewImportRequest {
    pub deck_id: String,
    pub text: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub use_ai: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardCandidate {
    pub front: String,
    pub back: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: String, // "rule" | "ai" | "pdf" | "url" | "apkg"
}

#[derive(Debug, Serialize)]
pub struct PreviewImportResponse {
    pub deck_id: String,
    pub cards: Vec<CardCandidate>,
    pub ai_fallback_used: bool,
    pub source: String,
}

#[derive(Debug, Deserialize)]
pub struct CommitImportRequest {
    pub deck_id: String,
    pub cards: Vec<CardCandidate>,
}

#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub total_cards: i64,
    pub due_today: i64,
    pub reviewed_today: i64,
    pub new_cards: i64,
    pub retention: f64,
}

// ---------- Helpers ----------

pub fn tags_to_string(tags: &[String]) -> String {
    serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string())
}

pub fn media_to_string(media: &[MediaItem]) -> String {
    serde_json::to_string(media).unwrap_or_else(|_| "[]".to_string())
}

pub fn new_id() -> String {
    new_uuid()
}

pub fn utc_now() -> DateTime<Utc> {
    now_utc()
}
