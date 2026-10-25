"""Baixa UMA vez o 1º turno municipal de Presidente das 27 UFs (≈5.570 arquivos do TSE)
e grava em backend/data/baseline_1t_2026.json. Rodar no sábado, na VM, antes da eleição:

    docker compose -f deploy/docker-compose.prod.yml run --rm poller python scripts/prewarm_municipios.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.baseline_1t import Baseline1TStore  # noqa: E402
from backend.config import get_settings  # noqa: E402
from backend.db import Database  # noqa: E402
from backend.tse_client import TSEClient  # noqa: E402


async def main() -> None:
    settings = get_settings()
    db = Database(settings.db_path)
    client = TSEClient(settings, db)
    store = Baseline1TStore(settings.baseline_1t_path)
    discovered = await client.discover_election_config()
    await store.ensure_loaded(client, discovered)
    for uf in sorted(store.data["municipalities_by_uf"]):
        if uf in {"zz", "br"}:
            continue
        muns = await store.ensure_pres_municipalities_1t_for_uf(client, discovered, uf)
        print(f"{uf.upper()}: {len(muns)} municípios em cache")
    await client.close()


asyncio.run(main())
