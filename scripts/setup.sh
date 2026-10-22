#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "== Node dependencies (workspace root) =="
npm install

echo "== ML venv + deps =="
bash services/ml/run.sh --check-only 2>/dev/null || true
if [ ! -x services/ml/.venv/bin/python ]; then
  python3 -m venv --without-pip services/ml/.venv
  curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip-tranergy.py
  services/ml/.venv/bin/python /tmp/get-pip-tranergy.py -q
fi
services/ml/.venv/bin/pip install -q -r services/ml/requirements.txt

echo "== Prisma generate + push =="
(cd services/api && npx prisma generate && npx prisma db push)

echo "Setup complete. Next steps:"
echo "  1. Put your Supabase DATABASE_URL in .env (and services/api/.env)"
echo "  2. npm run chain:anvil        (terminal A)"
echo "  3. npm run chain:deploy       (terminal B, after anvil is up)"
echo "  4. npm run dev:ml             (terminal C)"
echo "  5. npm run dev:api            (terminal D)"
echo "  6. npm run dev:web            (terminal E)"
echo "Then open http://localhost:3000 and create your users/facilities on the Setup page."
