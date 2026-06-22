use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::json;
use sqlx::migrate::MigrateDatabase;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::io::Read;
use std::str::FromStr;
use tower::ServiceExt;

async fn setup_app() -> (axum::Router, web_anki_backend::state::AppState, tempfile::TempDir) {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("test.db");
    let database_url = format!("sqlite://{}", db_path.to_str().unwrap());

    sqlx::Sqlite::create_database(&database_url).await.unwrap();
    let options = SqliteConnectOptions::from_str(&database_url)
        .unwrap()
        .foreign_keys(true)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .unwrap();

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .unwrap();

    let config = web_anki_backend::config::AppConfig {
        database_url,
        jwt_secret: "test-secret".to_string(),
        host: "127.0.0.1".to_string(),
        port: 3000,
        desired_retention: 0.9,
        ai_service_url: "http://localhost:8001".to_string(),
        media_dir: temp_dir.path().join("media"),
    };

    let state = web_anki_backend::state::AppState::new(pool, config.clone());
    let app = axum::Router::new()
        .nest("/api", web_anki_backend::routes::router())
        .with_state(state.clone());

    (app, state, temp_dir)
}

async fn send_json(
    app: &mut axum::Router,
    method: &str,
    uri: &str,
    body: Option<serde_json::Value>,
    token: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        builder = builder.header("Authorization", format!("Bearer {}", t));
    }
    builder = builder.header("Content-Type", "application/json");
    let body = match body {
        Some(v) => Body::from(v.to_string()),
        None => Body::empty(),
    };
    let req = builder.body(body).unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

#[tokio::test]
async fn test_auth_and_deck_crud() {
    let (mut app, _state, _temp_dir) = setup_app().await;

    // Register
    let (status, json) = send_json(
        &mut app,
        "POST",
        "/api/auth/register",
        Some(json!({
            "email": "test@example.com",
            "username": "tester",
            "password": "password123"
        })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = json["token"].as_str().unwrap().to_string();

    // Create deck
    let (status, deck) = send_json(
        &mut app,
        "POST",
        "/api/decks",
        Some(json!({ "name": "Test Deck" })),
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let deck_id = deck["id"].as_str().unwrap();

    // List decks
    let (status, json) = send_json(&mut app, "GET", "/api/decks", None, Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);

    // Create card
    let (status, card) = send_json(
        &mut app,
        "POST",
        "/api/cards",
        Some(json!({
            "deck_id": deck_id,
            "front": "What is 2+2?",
            "back": "4",
            "tags": ["math"]
        })),
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let card_id = card["id"].as_str().unwrap();
    assert_eq!(card["front"], "What is 2+2?");

    // Study queue
    let (status, queue) = send_json(&mut app, "GET", "/api/study/queue", None, Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(queue.as_array().unwrap().len(), 1);

    // Review card
    let (status, json) = send_json(
        &mut app,
        "POST",
        &format!("/api/study/{}/review", card_id),
        Some(json!({ "rating": "Good" })),
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["interval_days"].as_i64().unwrap() > 0);

    // Stats
    let (status, json) = send_json(&mut app, "GET", "/api/stats", None, Some(&token)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["total_cards"], 1);
    assert_eq!(json["reviewed_today"], 1);
}

#[tokio::test]
async fn test_review_plan() {
    let (mut app, _state, _temp_dir) = setup_app().await;

    // Register
    let (status, json) = send_json(
        &mut app,
        "POST",
        "/api/auth/register",
        Some(json!({
            "email": "plan@example.com",
            "username": "planner",
            "password": "password123"
        })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = json["token"].as_str().unwrap().to_string();

    // Create deck and card
    let (_status, deck) = send_json(
        &mut app,
        "POST",
        "/api/decks",
        Some(json!({ "name": "Plan Deck" })),
        Some(&token),
    )
    .await;
    let deck_id = deck["id"].as_str().unwrap();

    let (_status, card) = send_json(
        &mut app,
        "POST",
        "/api/cards",
        Some(json!({
            "deck_id": deck_id,
            "front": "Plan front",
            "back": "Plan back",
            "tags": []
        })),
        Some(&token),
    )
    .await;
    let card_id = card["id"].as_str().unwrap();

    // Plan before review should be empty (reps == 0 excluded)
    let (status, plan) = send_json(
        &mut app,
        "GET",
        "/api/study/plan?days=30",
        None,
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(plan.as_array().unwrap().is_empty());

    // Review card
    let (_status, _json) = send_json(
        &mut app,
        "POST",
        &format!("/api/study/{}/review", card_id),
        Some(json!({ "rating": "Good" })),
        Some(&token),
    )
    .await;

    // Plan after review should contain the card
    let (status, plan) = send_json(
        &mut app,
        "GET",
        "/api/study/plan?days=365",
        None,
        Some(&token),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = plan.as_array().unwrap();
    assert!(!items.is_empty());
    let total: i64 = items.iter().map(|i| i["count"].as_i64().unwrap()).sum();
    assert_eq!(total, 1);
}

#[tokio::test]
async fn test_unauthorized() {
    let (mut app, _state, _temp_dir) = setup_app().await;
    let (status, _json) = send_json(&mut app, "GET", "/api/decks", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

fn tiny_png() -> Vec<u8> {
    // 1x1 transparent PNG
    let data = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0x0f, 0x00, 0x00,
        0x01, 0x01, 0x00, 0x05, 0x18, 0xd8, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
    ];
    data.to_vec()
}

async fn upload_file(
    app: &mut axum::Router,
    token: &str,
    filename: &str,
    data: Vec<u8>,
) -> (StatusCode, serde_json::Value) {
    let boundary = "----WebAnkiTestBoundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
            filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"Content-Type: image/png\r\n\r\n");
    body.extend_from_slice(&data);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let req = Request::builder()
        .method("POST")
        .uri("/api/media/upload")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", format!("multipart/form-data; boundary={}", boundary))
        .body(Body::from(body))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

#[tokio::test]
async fn test_apkg_export_includes_media() {
    let (mut app, _state, _temp_dir) = setup_app().await;

    // Register
    let (_status, json) = send_json(
        &mut app,
        "POST",
        "/api/auth/register",
        Some(json!({
            "email": "export@media.example.com",
            "username": "exporter",
            "password": "password123"
        })),
        None,
    )
    .await;
    let token = json["token"].as_str().unwrap().to_string();

    // Create deck
    let (_status, deck) = send_json(
        &mut app,
        "POST",
        "/api/decks",
        Some(json!({ "name": "Media Export" })),
        Some(&token),
    )
    .await;
    let deck_id = deck["id"].as_str().unwrap();

    // Upload PNG
    let (_status, upload) = upload_file(&mut app, &token, "test.png", tiny_png()).await;
    let url = upload["url"].as_str().unwrap();
    assert!(url.starts_with("/uploads/"));

    // Create card referencing the image
    let front = format!("Question ![]({})", url);
    let (_status, card) = send_json(
        &mut app,
        "POST",
        "/api/cards",
        Some(json!({
            "deck_id": deck_id,
            "front": front,
            "back": "Answer",
            "tags": []
        })),
        Some(&token),
    )
    .await;
    assert!(!card["id"].as_str().unwrap().is_empty());

    // Export apkg
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/export/apkg/{}", deck_id))
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();

    // Verify zip contains media mapping and HTML references the image filename
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).unwrap();
    let mut media_bytes = Vec::new();
    zip.by_name("media").unwrap().read_to_end(&mut media_bytes).unwrap();
    let media_json: serde_json::Value =
        serde_json::from_str(std::str::from_utf8(&media_bytes).unwrap()).unwrap();
    let media_values: Vec<&str> = media_json
        .as_object()
        .unwrap()
        .values()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(!media_values.is_empty());
    let image_name = media_values[0];

    let db_name: String = zip
        .file_names()
        .find(|n| n.ends_with(".anki2"))
        .unwrap()
        .to_string();
    let db_bytes = {
        let mut db_file = zip.by_name(&db_name).unwrap();
        let mut buf = Vec::new();
        db_file.read_to_end(&mut buf).unwrap();
        buf
    };

    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("collection.anki2");
    tokio::fs::write(&db_path, &db_bytes).await.unwrap();
    let pool = SqlitePoolOptions::new()
        .connect_with(SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.to_str().unwrap())).unwrap())
        .await
        .unwrap();
    let row: (String,) = sqlx::query_as("SELECT flds FROM notes")
        .fetch_one(&pool)
        .await
        .unwrap();
    let flds = row.0;
    assert!(flds.contains(&format!(r#"<img src="{}">"#, image_name)));
}
