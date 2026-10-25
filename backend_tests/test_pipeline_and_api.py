"""Testes de integração da camada de dados, cliente TSE, ciclo 0% -> 100% de 2026 e endpoints FastAPI."""

from __future__ import annotations

from pathlib import Path
import os
import shutil
import pytest
import httpx

from backend.config import Settings, ROOT_DIR
from backend.main import create_app


@pytest.mark.skipif(
    os.getenv("RUN_TSE_INTEGRATION") != "1",
    reason="Integração real: acessa o TSE e grava em backend/data. Use RUN_TSE_INTEGRATION=1.",
)
@pytest.mark.asyncio
async def test_full_2026_pipeline_0_to_100_and_api(tmp_path: Path) -> None:
    """Executa a descoberta real de 2026 no servidor TSE, carrega o cache do 1º turno,
    roda o ciclo completo de 0% -> 100% (incluindo empate) para Presidente e os 6 Governadores,
    e valida todos os endpoints e arquivos estáticos gerados.
    """
    # Reaproveita cache do 1º turno se já existir em backend/data para acelerar repetições
    persistent_data_dir = ROOT_DIR / "backend" / "data"
    persistent_data_dir.mkdir(parents=True, exist_ok=True)
    persistent_baseline = persistent_data_dir / "baseline_1t_2026.json"

    test_data_dir = tmp_path / "data"
    test_data_dir.mkdir(parents=True, exist_ok=True)
    if persistent_baseline.exists():
        shutil.copy2(persistent_baseline, test_data_dir / "baseline_1t_2026.json")

    settings = Settings(
        tse_source_mode="live",
        data_dir=test_data_dir,
        snapshot_dir=tmp_path / "snapshots",
        fixtures_dir=tmp_path / "fixtures",
        rate_limit_requests_per_minute=200,
    )

    app = create_app(custom_settings=settings, start_poller=False)
    core = app.state.core

    # 1. Inicializa descoberta (EA11) e cache de 1º turno (EA12/EA20)
    discovered = await core.poller.initialize()
    if not persistent_baseline.exists() and (test_data_dir / "baseline_1t_2026.json").exists():
        shutil.copy2(test_data_dir / "baseline_1t_2026.json", persistent_baseline)

    assert discovered.cycle == "ele2026"
    assert discovered.pres_code_1t == "6257"
    assert discovered.pres_code_2t == "6258"
    assert discovered.gov_code_1t == "6259"
    assert discovered.gov_code_2t == "6260"
    assert set(discovered.gov_2t_ufs) == {"ac", "am", "df", "es", "rn", "to"}

    # 2. Ciclo em modo live (atualmente 0% apurado no servidor do TSE)
    cat_live = await core.poller.run_single_cycle()
    assert len(cat_live.disputes) == 7  # Presidente + 6 Governadores
    assert (settings.snapshot_dir / "catalog.json").exists()
    assert (settings.snapshot_dir / "presidente" / "latest.json").exists()
    for uf in discovered.gov_2t_ufs:
        assert (settings.snapshot_dir / f"governador-{uf}" / "latest.json").exists()

    # 3. Testa progressão simulada completa 0% -> 25% -> 50% (empate) -> 75% -> 100% em todas as 7 disputas
    core.db.clear_dispute_history()
    steps = [
        (0.0, "17:00:00", False),
        (0.25, "17:45:00", False),
        (0.50, "18:30:00", True),   # Testa empate exato em 50% das urnas
        (0.75, "19:15:00", False),
        (1.00, "20:30:00", False),
    ]

    for prog, hms, is_tie in steps:
        if is_tie:
            # Limpa histórico antes e depois do passo de empate para não conflitar monotonicidade
            core.db.clear_dispute_history()
        cat = await core.poller.run_single_cycle(
            sim_progress=prog, sim_hms=hms, force_exact_tie=is_tie
        )
        for item in cat.disputes:
            snap = core.db.get_latest_snapshot(item.dispute_id)
            assert snap is not None
            assert snap.validation_status == "ok"
            if prog == 0.0:
                assert snap.sections.pct_counted == 0.0
                assert snap.turnaround.status_code == "waiting_0pct"
            elif is_tie:
                assert snap.candidates[0].votes == snap.candidates[1].votes
                assert snap.turnaround.status_code == "exact_tie"
            elif prog == 1.0:
                assert snap.sections.pct_counted == 100.0
                assert snap.turnaround.estimated_remaining_valid_votes_r == 0
                # Em 100% simulado com vencedor oficial no TSE (e=='s'), verifica atribuição obrigatória
                elected_cands = [c for c in snap.candidates if c.tse_elected_flag]
                assert len(elected_cands) == 1
                assert elected_cands[0].tse_official_attribution == "Eleito (segundo o TSE)"
        if is_tie:
            core.db.clear_dispute_history()

    # 4. Testa os endpoints HTTP da API FastAPI usando AsyncClient + ASGITransport
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        r_health = await ac.get("/health")
        assert r_health.status_code == 200
        assert r_health.json()["status"] == "ok"

        r_status = await ac.get("/api/v1/status")
        assert r_status.status_code == 200
        status_json = r_status.json()
        assert status_json["status"] == "healthy"
        assert set(status_json["discovered_gov_2t_ufs"]) == {"ac", "am", "df", "es", "rn", "to"}

        r_cat = await ac.get("/api/v1/catalog")
        assert r_cat.status_code == 200
        assert len(r_cat.json()["disputes"]) == 7

        # Testa compressão Brotli em /api/v1/disputes/presidente
        r_pres = await ac.get(
            "/api/v1/disputes/presidente", headers={"Accept-Encoding": "br"}
        )
        assert r_pres.status_code == 200
        assert r_pres.headers.get("content-encoding") == "br"
        pres_data = r_pres.json()
        assert pres_data["dispute_id"] == "presidente"
        assert len(pres_data["candidates"]) == 2
        assert len(pres_data["localities"]) == 28

        # Testa recálculo da Calculadora da Virada com ajuste de comparecimento
        r_turn = await ac.get(
            "/api/v1/disputes/governador-ac/turnaround?turnout_adjustment_pct=-5.0"
        )
        assert r_turn.status_code == 200
        assert r_turn.json()["disclaimer"] == "Estimativa do site, não é resultado oficial"

        # Testa carregamento sob demanda de municípios para Presidente (UF = AC)
        r_mun = await ac.get("/api/v1/presidente/municipalities/ac")
        assert r_mun.status_code == 200
        assert len(r_mun.json()["municipalities"]) == 22

        # Testa bundle de Replay 2022
        r_rep = await ac.get("/api/v1/replay/2022")
        assert r_rep.status_code == 200
        assert r_rep.json()["total_frames"] == 21

        # Testa headers de CORS para domínios Vercel e Localhost
        r_vercel = await ac.get("/health", headers={"Origin": "https://apuracao-eleicoes-2026.vercel.app"})
        assert r_vercel.status_code == 200
        assert r_vercel.headers.get("access-control-allow-origin") == "https://apuracao-eleicoes-2026.vercel.app"

        r_local = await ac.get("/health", headers={"Origin": "http://localhost:3000"})
        assert r_local.status_code == 200
        assert r_local.headers.get("access-control-allow-origin") == "http://localhost:3000"

    await core.client.close()
