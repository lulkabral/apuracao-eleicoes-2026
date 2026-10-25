"""Aplicação FastAPI — Backend e Publicador de Snapshots "Apuração 2º Turno" (Eleições 2026)."""

from __future__ import annotations

from collections import defaultdict, deque
from contextlib import asynccontextmanager
import json
import os
import re
import time
from typing import Any

import brotli
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.alerts import AlertManager
from backend.baseline_1t import Baseline1TStore
from backend.calculator import calculate_turnaround
from backend.config import Settings, get_settings
from backend.db import Database
from backend.poller import ElectionPoller
from backend.publisher import SnapshotPublisher, _atomic_write_json
from backend.tse_client import TSEClient


class AppState:
    """Estado global compartilhado da aplicação."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.started_at = time.time()
        self.db = Database(self.settings.db_path)
        self.client = TSEClient(self.settings, self.db)
        self.baseline_store = Baseline1TStore(self.settings.baseline_1t_path)
        self.publisher = SnapshotPublisher(self.settings, self.db)
        self.alert_manager = AlertManager(self.settings, self.db)
        self.poller = ElectionPoller(
            settings=self.settings,
            db=self.db,
            client=self.client,
            baseline_store=self.baseline_store,
            publisher=self.publisher,
            alert_manager=self.alert_manager,
        )


def create_app(custom_settings: Settings | None = None, start_poller: bool = True) -> FastAPI:
    state = AppState(custom_settings)

    # Trava de segurança: simulação nunca pode rodar com a configuração de produção,
    # porque usa os MESMOS códigos de eleição (6258/6260) e grava no mesmo diretório.
    if os.getenv("APP_ENV") == "production" and state.settings.tse_source_mode != "live":
        raise RuntimeError(
            "APP_ENV=production exige TSE_SOURCE_MODE=live. Simulação só fora de produção."
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.core = state
        if start_poller and os.getenv("DISABLE_STARTUP_POLLER") != "1":
            try:
                await state.poller.run_single_cycle()
            except Exception as exc:
                state.db.log_event(
                    level="ERROR",
                    component="startup",
                    message=f"Falha no ciclo inicial: {exc}",
                )
            state.poller.start_background_loop()
        yield
        await state.poller.stop_background_loop()
        await state.client.close()

    app = FastAPI(
        title="Apuração 2º Turno 2026 — Backend & Snapshot Service",
        version="1.0.0",
        description=(
            "Serviço independente de agregação, validação de sanidade e geração de snapshots "
            "estáticos para acompanhamento do 2º turno das eleições brasileiras de 2026. "
            "Fonte oficial: TSE (https://resultados.tse.jus.br)."
        ),
        lifespan=lifespan,
    )
    app.state.core = state

    # CORS restrito aos domínios autorizados e deployments da Vercel (*.vercel.app)
    cors_kwargs: dict[str, Any] = {
        "allow_credentials": False,
        "allow_methods": ["GET", "HEAD", "OPTIONS"],
        "allow_headers": ["*"],
    }
    if "*" in state.settings.cors_origins:
        cors_kwargs["allow_origins"] = ["*"]
    else:
        cors_kwargs["allow_origins"] = state.settings.cors_origins
        if state.settings.cors_origin_regex:
            cors_kwargs["allow_origin_regex"] = state.settings.cors_origin_regex

    app.add_middleware(CORSMiddleware, **cors_kwargs)

    # Compressão GZip padrão (além de suporte Brotli em endpoints JSON pesados)
    app.add_middleware(GZipMiddleware, minimum_size=512)

    # Rate Limiting simples por IP em memória (janela deslizante de 60s)
    ip_buckets: dict[str, deque[float]] = defaultdict(deque)

    def _real_client_ip(request: Request) -> str:
        # Atrás de Cloudflare/Caddy, request.client.host é o IP do PROXY (o mesmo para todos).
        # Só confie nestes cabeçalhos porque a origem aceita tráfego apenas do proxy.
        return (
            request.headers.get("cf-connecting-ip")
            or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "unknown")
        )

    @app.middleware("http")
    async def rate_limit_and_cache_headers(request: Request, call_next):
        # Arquivos estáticos e healthcheck ficam fora do limite (quem protege é o CDN).
        if request.url.path.startswith("/snapshots/") or request.url.path == "/health":
            response = await call_next(request)
            if request.url.path.startswith("/snapshots/"):
                # Sem s-maxage: no Cloudflare, s-maxage desliga stale-while-revalidate/stale-if-error.
                response.headers["Cache-Control"] = (
                    "public, max-age=15, stale-while-revalidate=30, stale-if-error=3600"
                )
            return response

        client_ip = _real_client_ip(request)
        now = time.time()
        if len(ip_buckets) > 50_000:  # evita crescimento infinito de memória
            ip_buckets.clear()
        bucket = ip_buckets[client_ip]
        while bucket and (now - bucket[0]) > 60.0:
            bucket.popleft()

        if len(bucket) >= state.settings.rate_limit_requests_per_minute:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Limite de requisições por minuto excedido. Tente novamente em instantes."
                },
                headers={"Retry-After": "15"},
            )
        bucket.append(now)

        response: Response = await call_next(request)
        if request.url.path.startswith("/snapshots/"):
            response.headers["Cache-Control"] = (
                "public, max-age=30, stale-while-revalidate=60"
            )
        return response

    @app.get("/health")
    async def healthcheck() -> dict[str, Any]:
        now = time.time()
        last_ok = state.poller.last_success_ts
        elapsed = round(now - last_ok, 1) if last_ok else None
        return {
            "status": "ok",
            "uptime_seconds": round(now - state.started_at, 1),
            "cycle_count": state.poller.cycle_count,
            "last_success_ts": last_ok,
            "seconds_since_last_update": elapsed,
            "source_mode": state.settings.tse_source_mode,
        }

    @app.get("/api/v1/status")
    async def system_status(request: Request) -> dict[str, Any]:
        now = time.time()
        last_ok = state.poller.last_success_ts
        # Não dispara alertas a cada visita (o loop do poller já faz isso).
        elapsed = round(now - last_ok, 1) if last_ok else None
        staleness = {
            "stale": bool(elapsed and elapsed >= state.settings.stale_warning_seconds),
            "critical_stale": bool(elapsed and elapsed >= state.settings.alert_stale_seconds),
            "elapsed_seconds": elapsed,
        }
        poller_summary = state.db.get_poller_state("summary") or {}
        # Eventos internos (URLs, mensagens de erro) só com o token de operação.
        ops_token = os.getenv("OPS_TOKEN", "")
        is_ops = bool(ops_token) and request.headers.get("x-ops-token") == ops_token
        recent_events = state.db.get_recent_events(limit=25) if is_ops else []
        recent_errors = state.db.get_recent_events(limit=10, level="ERROR") if is_ops else []

        return {
            "service": "Apuração 2º Turno 2026",
            "status": "degraded" if staleness.get("critical_stale") else "healthy",
            "uptime_seconds": round(now - state.started_at, 1),
            "source_mode": state.settings.tse_source_mode,
            "tse_base_url": state.settings.tse_base_url,
            "poll_interval_seconds": state.settings.tse_poll_interval_seconds,
            "min_file_interval_seconds": state.settings.tse_min_file_interval_seconds,
            "cycle_count": state.poller.cycle_count,
            "last_success_ts": last_ok,
            "last_success_iso": poller_summary.get("last_success_iso"),
            "last_success_hms": poller_summary.get("last_success_hms"),
            "last_duration_ms": poller_summary.get("last_duration_ms"),
            "seconds_since_last_update": staleness.get("elapsed_seconds"),
            "is_stale_3min": staleness.get("stale"),
            "is_critical_stale_5min": staleness.get("critical_stale"),
            "discovered_gov_2t_ufs": poller_summary.get("discovered_gov_ufs", []),
            "feature_flags": {
                "reference_scenario": state.settings.feature_reference_scenario,
                "narrator": state.settings.feature_narrator,
                "replay": state.settings.feature_replay,
            },
            "recent_errors": recent_errors,
            "recent_events": recent_events,
        }

    @app.get("/api/v1/catalog")
    async def get_catalog() -> dict[str, Any]:
        cat_path = state.settings.snapshot_dir / "catalog.json"
        if not cat_path.exists():
            # Requisição pública nunca dispara coleta no TSE.
            raise HTTPException(status_code=503, detail="Catálogo ainda não publicado.")
        return json.loads(cat_path.read_text(encoding="utf-8"))

    @app.get("/api/v1/disputes/{dispute_id}")
    async def get_dispute_snapshot(dispute_id: str, request: Request) -> Response:
        dispute_id = dispute_id.lower()
        if dispute_id != "presidente" and not re.fullmatch(r"governador-[a-z]{2}", dispute_id):
            raise HTTPException(status_code=404, detail="Disputa inválida.")
        snap_path = state.settings.snapshot_dir / dispute_id / "latest.json"
        if not snap_path.exists():
            snap = state.db.get_latest_snapshot(dispute_id.lower())
            if snap is None:
                raise HTTPException(
                    status_code=404, detail=f"Disputa '{dispute_id}' não encontrada."
                )
            raw_bytes = snap.model_dump_json().encode("utf-8")
        else:
            raw_bytes = snap_path.read_bytes()

        accept_enc = request.headers.get("accept-encoding", "")
        if "br" in accept_enc and len(raw_bytes) > 1024:
            compressed = brotli.compress(raw_bytes, quality=4)
            return Response(
                content=compressed,
                media_type="application/json",
                headers={
                    "Content-Encoding": "br",
                    "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
                    # Sem Vary, o CDN pode entregar Brotli a quem não suporta (tela em branco).
                    "Vary": "Accept-Encoding",
                },
            )
        return Response(
            content=raw_bytes,
            media_type="application/json",
            headers={
                "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
                "Vary": "Accept-Encoding",
            },
        )

    @app.get("/api/v1/disputes/{dispute_id}/turnaround")
    async def recalculate_dispute_turnaround(
        dispute_id: str,
        turnout_adjustment_pct: float = Query(
            default=0.0,
            ge=-30.0,
            le=20.0,
            description="Ajuste percentual sobre o comparecimento esperado do 1º turno (ex.: -5.0 para 5% menor)",
        ),
    ) -> dict[str, Any]:
        snap = state.db.get_latest_snapshot(dispute_id.lower())
        if snap is None:
            raise HTTPException(
                status_code=404, detail=f"Disputa '{dispute_id}' não encontrada."
            )
        res = calculate_turnaround(
            cand1=snap.candidates[0],
            cand2=snap.candidates[1],
            turnout_votes_2t=snap.electorate.turnout_votes,
            blank_votes_2t=snap.votes.blank_votes,
            null_votes_2t=snap.votes.null_votes,
            turnout_votes_1t=snap.electorate.turnout_1t,
            total_electorate_2t=snap.electorate.total_electorate,
            blank_null_rate_1t=snap.votes.blank_null_rate_1t,
            pct_counted=snap.sections.pct_counted,
            turnout_adjustment_pct=turnout_adjustment_pct,
            localities=snap.localities,
        )
        return res.model_dump()

    @app.get("/api/v1/presidente/municipalities/{uf}")
    async def get_pres_municipalities(uf: str) -> dict[str, Any]:
        uf_l = uf.lower().strip()
        if len(uf_l) != 2:
            raise HTTPException(status_code=400, detail="Sigla de UF inválida.")
        # Só lê o arquivo que o poller pré-gera (publish_pres_municipal_files).
        # Antes, qualquer visitante podia disparar centenas de downloads no TSE.
        mun_snap_path = state.settings.snapshot_dir / "presidente" / "mun" / f"{uf_l}.json"
        if not mun_snap_path.exists():
            raise HTTPException(status_code=404, detail="Municípios ainda não publicados.")
        data = json.loads(mun_snap_path.read_text(encoding="utf-8"))
        data.setdefault("municipalities", data.get("localities", []))
        return data

    @app.get("/api/v1/replay/2022")
    async def get_replay_2022() -> dict[str, Any]:
        replay_path = state.settings.snapshot_dir / "replay-2022" / "presidente.json"
        if not replay_path.exists():
            raise HTTPException(status_code=503, detail="Replay ainda não publicado.")
        return json.loads(replay_path.read_text(encoding="utf-8"))

    # Monta o diretório de snapshots estáticos em /snapshots para servir localmente como CDN
    state.settings.snapshot_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/snapshots",
        StaticFiles(directory=str(state.settings.snapshot_dir)),
        name="snapshots",
    )

    return app


app = create_app()
