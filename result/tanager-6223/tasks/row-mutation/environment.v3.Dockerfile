# Local mirror of the platform environment image v3 for this repository, taken
# from `gold_bot.py env-log 2Z9OHwYvfPnfAYyrEo0D 3` step by step. The one
# omission is `cargo install cargo-nextest`, which the verifier block never
# calls: it compiles for minutes and would change nothing this checks.
FROM rust:1.92-slim-bookworm
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
ENV CARGO_TERM_COLOR=never \
    CARGO_INCREMENTAL=0 \
    RUST_BACKTRACE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN cargo build --all-targets --locked \
 && cargo build --release --locked
# The platform copies a git checkout into /app; the snapshot we unpack has no
# .git, so one is made here. Nothing downstream reads its sha: verify_task.sh
# mounts its own /app with its own history over this one.
RUN git config --global --add safe.directory /app \
 && cd /app && git init -q -b main \
 && git -c user.email=b@l -c user.name=b add -A \
 && git -c user.email=b@l -c user.name=b commit -q -m base \
 && git config core.hooksPath /dev/null
