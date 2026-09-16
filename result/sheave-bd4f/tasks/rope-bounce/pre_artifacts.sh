#!/bin/bash
# Capture the committed work as the submission artifact: the diff between the
# starting commit and the final HEAD.
set -uo pipefail
cd /app || exit 0
mkdir -p /logs/artifacts
git config --global --add safe.directory /app 2>/dev/null || true
git diff --binary bb4eda665b5ba5e281155e94d4c72fee12ef2797 HEAD > /logs/artifacts/model.patch 2>/dev/null || true
echo "[pre_artifacts] captured $(wc -c < /logs/artifacts/model.patch) bytes"
