# Local mirror of the platform environment image, rebuilt from the ten Step
# lines in env-log.v3.txt (gold-repo-tanager-2z9ohw:v3). Two deliberate
# differences, both noted rather than silent:
#
#   * cargo-nextest is not installed. The platform image has it (Step 8), and
#     nothing in this task's verifier uses it: the block compiles with
#     `cargo test --no-run` and runs the test binaries directly, so a report
#     never passes through a tool the submission could point elsewhere.
#   * the repo arrives as a snapshot without .git, so the git config in Step 10
#     is applied by the harness that mounts /app rather than baked here.
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
RUN git config --global --add safe.directory /app
