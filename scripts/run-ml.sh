#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/ml"
exec .venv/bin/uvicorn app.main:app --host "${ML_HOST:-127.0.0.1}" --port "${ML_PORT:-8000}"
