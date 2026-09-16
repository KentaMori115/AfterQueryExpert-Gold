#!/bin/bash
# Capture the committed work as the submission artifact: the diff between the
# starting commit and the final HEAD.
set -uo pipefail
cd /app || exit 0
mkdir -p /logs/artifacts
git config --global --add safe.directory /app 2>/dev/null || true
git diff --binary dcb5ed4892e0875ce4929893411d2eb565c6c567 HEAD > /logs/artifacts/model.patch 2>/dev/null || true
echo "[pre_artifacts] captured $(wc -c < /logs/artifacts/model.patch) bytes"
