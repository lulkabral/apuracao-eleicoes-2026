"""Zera banco e snapshots de runtime antes da apuração real.

Rodar NA VM, com o poller parado, na véspera (sábado à noite):
    docker compose -f deploy/docker-compose.prod.yml run --rm poller python scripts/reset_producao.py
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import get_settings  # noqa: E402
from backend.db import Database  # noqa: E402

settings = get_settings()
if settings.tse_source_mode != "live":
    sys.exit("Abortado: em produção TSE_SOURCE_MODE precisa ser 'live'.")

db = Database(settings.db_path)
db.clear_dispute_history()  # apaga latest_snapshots, snapshots_history e narrator_feed

for child in settings.snapshot_dir.iterdir():
    if child.name in {"catalog.json", "status.json"} or child.name.startswith(
        ("presidente", "governador-")
    ):
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

print("OK: banco e snapshots de produção zerados. Pode subir o poller.")
