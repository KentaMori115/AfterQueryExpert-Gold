#!/bin/bash
# Capture the committed work as the submission artifact: the diff between the
# starting commit and the final HEAD.
set -uo pipefail
cd /app || exit 0
mkdir -p /logs/artifacts
git config --global --add safe.directory /app 2>/dev/null || true
git diff --binary 474ce0944456bafbaa719a5e2304d56eaeccd768 HEAD > /logs/artifacts/model.patch 2>/dev/null || true
echo "[pre_artifacts] captured $(wc -c < /logs/artifacts/model.patch) bytes"
