#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  python3 -m venv --without-pip .venv
  curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
  .venv/bin/python /tmp/get-pip.py -q
  rm -f .venv/.deps-installed
fi

if [ ! -f .venv/.deps-installed ]; then
  .venv/bin/pip install -q -r requirements.txt
  touch .venv/.deps-installed
fi

export PYTHONPATH="${PWD}${PYTHONPATH:+:$PYTHONPATH}"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${ML_PORT:-8000}"
