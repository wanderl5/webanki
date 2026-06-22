FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock build.rs ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/web-anki-backend /app/web-anki-backend
COPY --from=builder /app/migrations /app/migrations

ENV DATABASE_URL=sqlite://data/app.db
ENV HOST=0.0.0.0
ENV PORT=3000
ENV MEDIA_DIR=./media
ENV AI_SERVICE_URL=http://ai-service:8001

EXPOSE 3000
CMD ["/app/web-anki-backend"]
