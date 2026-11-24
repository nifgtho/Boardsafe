#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
    echo "Falta el entorno local. Cree .venv con Python 3.11+ e instale .[test]." >&2
    exit 1
fi
.venv/bin/python -m app.cli migrate
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app
