use crate::{
    error::{AppError, AppResult},
    models::{AuthResponse, LoginRequest, RegisterRequest, User, UserResponse},
    state::AppState,
};
use axum::{
    async_trait,
    extract::{FromRequestParts, State},
    http::{request::Parts, HeaderMap},
    routing::post,
    Json, RequestPartsExt, Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
}

async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<Json<AuthResponse>> {
    if req.email.is_empty() || req.password.len() < 6 {
        return Err(AppError::BadRequest(
            "email required and password must be at least 6 chars".into(),
        ));
    }

    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ?")
        .bind(&req.email)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_some() {
        return Err(AppError::BadRequest("email already registered".into()));
    }

    let password_hash = hash(&req.password, DEFAULT_COST)?;
    let id = crate::models::new_id();
    let now = Utc::now().naive_utc();

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
    )
    .bind(&id)
    .bind(&req.email)
    .bind(&req.username)
    .bind(&password_hash)
    .bind(now)
    .fetch_one(&state.pool)
    .await?;

    let token = create_token(&state.config.jwt_secret, &user.id)?;
    Ok(Json(AuthResponse {
        token,
        user: UserResponse::from(&user),
    }))
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = ?")
        .bind(&req.email)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("invalid credentials".into()))?;

    if !verify(&req.password, &user.password_hash)? {
        return Err(AppError::Unauthorized("invalid credentials".into()));
    }

    let token = create_token(&state.config.jwt_secret, &user.id)?;
    Ok(Json(AuthResponse {
        token,
        user: UserResponse::from(&user),
    }))
}

fn create_token(secret: &str, user_id: &str) -> AppResult<String> {
    let exp = Utc::now()
        .checked_add_signed(chrono::Duration::days(7))
        .expect("valid exp")
        .timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn decode_token(secret: &str, token: &str) -> AppResult<String> {
    let token = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| AppError::Unauthorized(format!("invalid token: {e}")))?;
    Ok(token.claims.sub)
}

#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub id: String,
}

#[async_trait]
impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let headers: HeaderMap = parts
            .extract()
            .await
            .map_err(|_| AppError::Unauthorized("missing headers".into()))?;
        let auth = headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing Authorization header".into()))?;
        let token = auth
            .strip_prefix("Bearer ")
            .ok_or_else(|| AppError::Unauthorized("invalid Authorization format".into()))?;

        let user_id = decode_token(&state.config.jwt_secret, token)?;
        Ok(CurrentUser { id: user_id })
    }
}
