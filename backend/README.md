# web-anki backend

Rust backend for the web-based Anki clone.

## Tech stack

- Rust + Axum + Tokio
- SQLite via sqlx with compile-time migrations
- FSRS-5 scheduling via the `fsrs` crate
- JWT authentication with bcrypt password hashing

## Run locally

```bash
cd backend
cargo run
```

The server starts on `http://127.0.0.1:3000` by default.

### Environment variables

| Variable            | Default                        | Description                     |
|---------------------|--------------------------------|---------------------------------|
| `DATABASE_URL`      | `sqlite://web-anki.db`         | SQLite connection URL           |
| `JWT_SECRET`        | `dev-secret-change-me`         | JWT signing secret              |
| `HOST`              | `127.0.0.1`                    | Bind host                       |
| `PORT`              | `3000`                         | Bind port                       |
| `DESIRED_RETENTION` | `0.9`                          | FSRS desired retention (0.7-0.97) |

## API overview

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |
| GET | `/api/decks` | List decks |
| POST | `/api/decks` | Create deck |
| GET | `/api/decks/:id/cards` | Cards in a deck |
| POST | `/api/cards` | Create card |
| PUT | `/api/cards/:id` | Update card |
| DELETE | `/api/cards/:id` | Delete card |
| GET | `/api/study/queue` | Suggested study queue |
| POST | `/api/study/:id/review` | Submit review (Again/Hard/Good/Easy) |
| POST | `/api/import/text` | Import cards from plain text |

## Study queue ordering

1. Due cards (`due <= now`) ordered by lowest current retrievability first.
2. New cards that have never been reviewed.
3. Not-yet-due cards ordered by lowest retrievability first.

There are no strict daily limits; users can study any card at any time.
