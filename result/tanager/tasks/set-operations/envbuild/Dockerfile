FROM rust:1.92-slim-bookworm
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
ENV CARGO_TERM_COLOR=never CARGO_INCREMENTAL=0 RUST_BACKTRACE=1
RUN apt-get update && apt-get install -y --no-install-recommends git python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN cargo install cargo-nextest --locked --version 0.9.143 && cargo-nextest nextest --version
RUN cargo build --all-targets --locked && cargo build --release --locked
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
