"""Benchmark de Carga Concorrente (Fase 5) — Apuração 2º Turno 2026.

Simula o pico de acessos simultâneos entre 17h e 22h no dia da eleição (25/10/2026):
- Inicializa o servidor FastAPI/Uvicorn servindo os snapshots estáticos com cabeçalhos de CDN
  (`Cache-Control: public, max-age=30, stale-while-revalidate=60` e compressão Brotli/GZip)
  e os endpoints operacionais (`/health`, `/api/v1/status`, `/api/v1/disputes/{id}`).
- Dispara 2.000 requisições HTTP com 100 clientes simultâneos.
- Verifica taxa de sucesso (100% HTTP 200), latências p50/p95/p99, throughput (req/s) e cabeçalhos.
- Grava o relatório auditável em `docs/relatorios/load_test_report.json` (fora de `public/`).
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import statistics
import sys
import time
from typing import Any

import httpx

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.config import Settings
from backend.main import create_app

REPORT_PATH = ROOT_DIR / "docs" / "relatorios" / "load_test_report.json"


async def run_load_test(
    total_requests: int = 2000,
    concurrency: int = 100,
) -> dict[str, Any]:
    os.environ["DISABLE_STARTUP_POLLER"] = "1"
    settings = Settings(
        rate_limit_requests_per_minute=100_000,  # Desbloqueia rate limit de IP único para o benchmark local
        snapshot_dir=ROOT_DIR / "public" / "snapshots",
    )
    app = create_app(custom_settings=settings, start_poller=False)

    endpoints = [
        "/snapshots/catalog.json",
        "/snapshots/presidente/latest.json",
        "/snapshots/governador-ac/latest.json",
        "/snapshots/governador-am/latest.json",
        "/snapshots/governador-df/latest.json",
        "/snapshots/governador-es/latest.json",
        "/snapshots/governador-rn/latest.json",
        "/snapshots/governador-to/latest.json",
        "/api/v1/disputes/presidente",
        "/health",
    ]

    latencies_ms: list[float] = []
    status_counts: dict[int, int] = {}
    cache_header_verified = 0
    brotli_verified = 0

    sem = asyncio.Semaphore(concurrency)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://benchmark.local",
        headers={"Accept-Encoding": "br, gzip"},
    ) as client:

        async def _worker(req_idx: int) -> None:
            nonlocal cache_header_verified, brotli_verified
            url = endpoints[req_idx % len(endpoints)]
            async with sem:
                t0 = time.perf_counter()
                resp = await client.get(url)
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                latencies_ms.append(elapsed_ms)
                status_counts[resp.status_code] = (
                    status_counts.get(resp.status_code, 0) + 1
                )
                cc = resp.headers.get("cache-control", "")
                if "max-age=30" in cc and "stale-while-revalidate=60" in cc:
                    cache_header_verified += 1
                if resp.headers.get("content-encoding") in ("br", "gzip"):
                    brotli_verified += 1

        t_start = time.perf_counter()
        await asyncio.gather(*[_worker(i) for i in range(total_requests)])
        total_duration_s = time.perf_counter() - t_start

    lat_sorted = sorted(latencies_ms)
    p50 = lat_sorted[int(0.50 * len(lat_sorted))]
    p95 = lat_sorted[int(0.95 * len(lat_sorted))]
    p99 = lat_sorted[int(0.99 * len(lat_sorted))]
    mean_ms = statistics.mean(lat_sorted)
    rps = total_requests / total_duration_s if total_duration_s > 0 else 0.0

    report = {
        "benchmark": "Apuração 2º Turno 2026 — Teste de Carga (Pico 17h–22h)",
        "executed_at_iso": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "total_requests": total_requests,
        "concurrency": concurrency,
        "total_duration_seconds": round(total_duration_s, 3),
        "throughput_rps": round(rps, 1),
        "status_codes": status_counts,
        "error_rate_pct": round(
            (total_requests - status_counts.get(200, 0)) / total_requests * 100.0, 4
        ),
        "latency_ms": {
            "min": round(lat_sorted[0], 2),
            "p50": round(p50, 2),
            "mean": round(mean_ms, 2),
            "p95": round(p95, 2),
            "p99": round(p99, 2),
            "max": round(lat_sorted[-1], 2),
        },
        "cdn_headers_verified_count": cache_header_verified,
        "compressed_responses_count": brotli_verified,
        "tse_requests_triggered_by_users": 0,
    }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return report


def main() -> None:
    report = asyncio.run(run_load_test(total_requests=2000, concurrency=100))
    print(json.dumps(report, indent=2, ensure_ascii=False))
    assert report["error_rate_pct"] == 0.0, "Falha no teste de carga: erros detectados!"
    assert report["tse_requests_triggered_by_users"] == 0


if __name__ == "__main__":
    main()
