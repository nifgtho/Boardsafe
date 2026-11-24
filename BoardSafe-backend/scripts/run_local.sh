#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BOARDSAFE_DATABASE_URL:=sqlite:///./boardsafe.db}"
export BOARDSAFE_DATABASE_URL
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
