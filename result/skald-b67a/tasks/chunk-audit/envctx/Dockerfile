# Local mirror of the published environment image, rebuilt from the Step lines
# of `gold_bot.py env-log 2G9D18szl7aNlQIbAKTv 1`. The platform builds the real
# one; this is what lets the verifier be exercised here before a submission.
FROM rust:1.92-slim-bookworm

RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }

COPY repo/ /app
WORKDIR /app
ENV CARGO_TERM_COLOR=never \
    CARGO_INCREMENTAL=0 \
    RUST_BACKTRACE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential=12.9 \
        pkg-config=1.8.1-1 \
    && rm -rf /var/lib/apt/lists/*

RUN cargo install cargo-nextest --version 0.9.140 --locked

WORKDIR /app
RUN cargo fetch --locked
RUN cargo build --locked --all-targets \
    && cargo nextest list --workspace >/dev/null
RUN git config --global --add safe.directory /app && { cd /app && git config core.hooksPath /dev/null; } || true
