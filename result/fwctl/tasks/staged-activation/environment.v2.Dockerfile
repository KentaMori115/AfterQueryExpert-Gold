FROM rust:1.96-slim-bookworm@sha256:e18a79fc84dfcfc3ab5ba72290398a644c135c97eaa881447fddc354ee4701a3

RUN apt-get -o Acquire::ForceIPv4=true update \
    && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
        ca-certificates=20250419~deb12u1 \
        git=1:2.39.5-0+deb12u3 \
        libudev-dev=252.39-1~deb12u2 \
        pkg-config=1.8.1-1 \
        python3=3.11.2-1+b1 \
    && rm -rf /var/lib/apt/lists/*

RUN rustup component add --toolchain 1.96.1-x86_64-unknown-linux-gnu clippy rustfmt

# Populate the crates.io cache from the checked-in Cargo.lock. Both the agent
# and the verifier run with allow_internet = false, so without this layer no
# cargo invocation resolves and the workspace cannot be compiled or tested at
# all. Verified: with it, `cargo test --workspace --all-targets --locked
# --offline` passes 162 cases inside `docker run --network none`.
RUN cargo fetch --locked
