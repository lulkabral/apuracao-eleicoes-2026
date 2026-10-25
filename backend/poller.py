"""Coordenador de Coleta Assíncrona (Polling) e Geração de Snapshots por Disputa.

Estratégia em conformidade com a Resolução TSE nº 23.751/2026:
- Descobre os códigos do pleito e estados com 2º turno de governador via `ele-c.json` (EA11).
- Consulta `EA14`/`EA15` (`-ab.json`) para identificar apenas UFs e municípios cujo timestamp
  `dt`/`ht` mudou antes de buscar os arquivos `EA20` (`-u.json`).
- A cada ciclo (60s), valida e publica os snapshots estáticos JSON no diretório de CDN.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from backend.alerts import AlertManager
from backend.baseline_1t import Baseline1TStore, extract_ea20_summary
from backend.config import Settings
from backend.db import Database
from backend.fixtures_2022 import (
    build_2022_replay_frames,
    generate_2026_simulated_ea20_step,
)
from backend.models import DisputeSnapshot, ElectionCatalogSnapshot
from backend.normalizer import build_dispute_snapshot
from backend.publisher import SnapshotPublisher, _atomic_write_json
from backend.tse_client import DiscoveredElectionConfig, TSEClient, UF_NAMES


class ElectionPoller:
    """Serviço de coleta periódica, normalização, validação e publicação de snapshots."""

    def __init__(
        self,
        settings: Settings,
        db: Database,
        client: TSEClient,
        baseline_store: Baseline1TStore,
        publisher: SnapshotPublisher,
        alert_manager: AlertManager,
    ) -> None:
        self.settings = settings
        self.db = db
        self.client = client
        self.baseline_store = baseline_store
        self.publisher = publisher
        self.alert_manager = alert_manager

        self.discovered: DiscoveredElectionConfig | None = None
        self.cycle_count: int = 0
        self.last_success_ts: float | None = None
        self.last_error_ts: float | None = None
        self.last_error_message: str | None = None
        self._last_ab_timestamps: dict[str, str] = {}
        self._cached_child_2t: dict[str, dict[str, dict[str, Any]]] = {}
        self._cached_cands_2t_meta: dict[str, list[dict[str, Any]]] = {}
        self._task: asyncio.Task[None] | None = None
        self._running: bool = False
        # Impede dois ciclos simultâneos (loop + chamada manual) escrevendo os mesmos arquivos.
        self._cycle_lock = asyncio.Lock()

    def _forget_ab_timestamps(self, prefix: str) -> None:
        """Força rebaixar no próximo ciclo as localidades cujo timestamp começa com `prefix`."""
        for key in [k for k in self._last_ab_timestamps if k.startswith(prefix)]:
            del self._last_ab_timestamps[key]

    async def initialize(self) -> DiscoveredElectionConfig:
        """Executa descoberta inicial do pleito, carrega cache do 1º turno e gera pacote Replay 2022."""
        self.discovered = await self.client.discover_election_config()
        await self.baseline_store.ensure_loaded(self.client, self.discovered)

        # Publica o bundle estático do Replay 2022 para estar sempre pronto no CDN
        replay_frames = build_2022_replay_frames(self.client, self.settings)
        self.publisher.publish_replay_2022_bundle(replay_frames)
        return self.discovered

    async def run_single_cycle(
        self,
        sim_progress: float | None = None,
        sim_hms: str | None = None,
        force_exact_tie: bool = False,
    ) -> ElectionCatalogSnapshot:
        """Executa um ciclo completo (serializado por lock)."""
        async with self._cycle_lock:
            return await self._run_single_cycle_unlocked(
                sim_progress=sim_progress,
                sim_hms=sim_hms,
                force_exact_tie=force_exact_tie,
            )

    async def _run_single_cycle_unlocked(
        self,
        sim_progress: float | None = None,
        sim_hms: str | None = None,
        force_exact_tie: bool = False,
    ) -> ElectionCatalogSnapshot:
        """Executa um ciclo completo de atualização para Presidente e todos os Governadores em 2º turno."""
        t0 = time.time()
        self.client.cycle_fallbacks.clear()
        try:
            if self.discovered is None:
                await self.initialize()
            assert self.discovered is not None

            discovered = self.discovered
            base_data = self.baseline_store.data
            published_snapshots: list[DisputeSnapshot] = []

            # Cada disputa é isolada: erro em Governador-XX não derruba Presidente nem as demais.
            sim_kwargs: dict[str, Any] = {
                "discovered": discovered,
                "base_data": base_data,
                "sim_progress": sim_progress,
                "sim_hms": sim_hms,
                "force_exact_tie": force_exact_tie,
            }
            jobs: list[tuple[str, Any]] = [
                ("presidente", lambda: self._process_presidente(**sim_kwargs))
            ]
            for uf_code in discovered.gov_2t_ufs:
                jobs.append(
                    (
                        f"governador-{uf_code.lower()}",
                        lambda uf_code=uf_code: self._process_governador_uf(
                            uf_code=uf_code, **sim_kwargs
                        ),
                    )
                )

            failed: list[str] = []
            for dispute_id, job in jobs:
                try:
                    published_snapshots.append(await job())
                except Exception as exc:
                    failed.append(dispute_id)
                    self.db.log_event(
                        level="ERROR",
                        component="poller",
                        message=f"{dispute_id} falhou neste ciclo; mantendo o último snapshot válido: {exc}",
                    )
                    kept = self.db.get_latest_snapshot(dispute_id)
                    if kept is not None:
                        published_snapshots.append(kept)

            if not published_snapshots:
                raise RuntimeError("Nenhuma disputa pôde ser processada neste ciclo.")

            now = time.time()
            hms = sim_hms or time.strftime("%H:%M:%S", time.localtime(now))
            iso = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now))

            catalog = self.publisher.publish_catalog(
                snapshots=published_snapshots,
                cycle=discovered.cycle,
                generated_at_iso=iso,
                generated_at_hms=hms,
            )

            self.cycle_count += 1
            tse_fallbacks = len(self.client.cycle_fallbacks)
            # Só é "sucesso" se TODAS as disputas processaram e NENHUM arquivo veio do cache por
            # erro. Assim o alerta de 5 min dispara quando o TSE/rede cair, em vez de o site
            # seguir dizendo "atualizado" com dado velho.
            if not failed and tse_fallbacks == 0:
                self.last_success_ts = now
            else:
                self.db.log_event(
                    level="ERROR",
                    component="poller",
                    message=(
                        f"Ciclo parcial: {len(failed)} disputa(s) com erro, "
                        f"{tse_fallbacks} arquivo(s) do TSE servidos do cache local."
                    ),
                    details={"failed": failed, "fallback_urls": self.client.cycle_fallbacks[:20]},
                )
            duration_ms = round((now - t0) * 1000.0, 1)

            self.db.set_poller_state(
                "summary",
                {
                    "cycle_count": self.cycle_count,
                    "last_success_ts": self.last_success_ts,
                    "last_success_iso": iso,
                    "last_success_hms": hms,
                    "last_duration_ms": duration_ms,
                    "discovered_gov_ufs": discovered.gov_2t_ufs,
                    "source_mode": self.settings.tse_source_mode,
                },
            )
            # status.json público (formato que a StatusPage espera), servido pelo CDN.
            healthy = self.last_success_ts == now
            _atomic_write_json(
                self.settings.snapshot_dir / "status.json",
                {
                    "status": "healthy" if healthy else "degraded",
                    "running": self._running,
                    "poll_cycles": self.cycle_count,
                    "consecutive_errors": len(failed) + tse_fallbacks,
                    "last_poll_iso": iso,
                    "last_success_iso": (
                        time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(self.last_success_ts))
                        if self.last_success_ts
                        else None
                    ),
                    "tse_client_stats": dict(self.client.stats),
                },
            )
            return catalog
        except Exception as exc:
            self.last_error_ts = time.time()
            self.last_error_message = str(exc)
            self.db.log_event(
                level="ERROR",
                component="poller",
                message=f"Erro no ciclo de coleta: {exc}",
            )
            raise

    async def _process_presidente(
        self,
        discovered: DiscoveredElectionConfig,
        base_data: dict[str, Any],
        sim_progress: float | None = None,
        sim_hms: str | None = None,
        force_exact_tie: bool = False,
    ) -> DisputeSnapshot:
        dispute_id = "presidente"
        macro_1t = base_data["pres_1t"]["br"]
        child_1t_ufs = base_data["pres_1t"]["ufs"]

        all_ufs = sorted(child_1t_ufs.keys())
        child_meta_list = [
            {
                "code_tse": uf_c,
                "code_ibge": uf_c.upper(),
                "uf": uf_c,
                "name": UF_NAMES.get(uf_c, uf_c.upper()),
                "is_capital": False,
                "scope_type": "uf",
            }
            for uf_c in all_ufs
        ]

        if sim_progress is not None or self.settings.tse_source_mode == "sim_2026":
            prog = sim_progress if sim_progress is not None else 0.65
            hms = sim_hms or time.strftime("%H:%M:%S")
            cands_meta = await self._get_2t_candidates_meta(
                dispute_id, discovered.pres_code_2t, "1", "br", discovered.cycle
            )
            macro_2t_payload, child_2t_summaries = generate_2026_simulated_ea20_step(
                macro_1t_summary=macro_1t,
                child_1t_summaries=child_1t_ufs,
                cands_2t_meta=cands_meta,
                ele_code_2t=discovered.pres_code_2t,
                cargo_code="1",
                uf_scope="br",
                progress=prog,
                hms=hms,
                force_exact_tie=force_exact_tie,
            )
        else:
            # Modo Live: consulta br-c0001-e006258-u.json e br-e006258-ab.json
            br_u_url = self.client.url_resultado_u(
                discovered.pres_code_2t, "1", "br", cycle=discovered.cycle
            )
            br_ab_url = self.client.url_acompanhamento_ab(
                discovered.pres_code_2t, "br", cycle=discovered.cycle
            )
            macro_2t_payload, br_ab_payload = await asyncio.gather(
                self.client.fetch_json(br_u_url),
                self.client.fetch_json(br_ab_url),
            )
            self._cached_cands_2t_meta[dispute_id] = extract_ea20_summary(
                macro_2t_payload
            )["candidates_meta"]

            cached_ufs = self._cached_child_2t.setdefault(dispute_id, {})
            ufs_to_fetch: list[str] = []
            pending_ts: dict[str, str] = {}

            for abr_item in br_ab_payload.get("abr", []):
                uf_c = str(abr_item.get("cdabr", "")).lower()
                if uf_c == "br" or uf_c not in child_1t_ufs:
                    continue
                ab_key = f"pres_uf_{uf_c}"
                dt_ht = f"{abr_item.get('dt', '')}_{abr_item.get('ht', '')}_{abr_item.get('s', {}).get('st', '0')}"
                if (
                    uf_c not in cached_ufs
                    or self._last_ab_timestamps.get(ab_key) != dt_ht
                ):
                    ufs_to_fetch.append(uf_c)
                    # O timestamp só é gravado DEPOIS que o download der certo (abaixo).
                    pending_ts[ab_key] = dt_ht

            if ufs_to_fetch:
                async def _fetch_uf_2t(u_code: str) -> tuple[str, dict[str, Any]]:
                    url = self.client.url_resultado_u(
                        discovered.pres_code_2t, "1", u_code, cycle=discovered.cycle
                    )
                    pay = await self.client.fetch_json(url, raise_on_error=True)
                    return u_code, extract_ea20_summary(pay)

                # return_exceptions=True: uma UF com erro não derruba as outras 26.
                fetched_list = await asyncio.gather(
                    *[_fetch_uf_2t(u) for u in ufs_to_fetch], return_exceptions=True
                )
                for u_code, result in zip(ufs_to_fetch, fetched_list):
                    if isinstance(result, BaseException):
                        # Conta como "não atualizado" (impede marcar o ciclo como 100% ok).
                        self.client.cycle_fallbacks.append(f"presidente/{u_code}")
                        self.db.log_event(
                            level="WARNING",
                            component="poller",
                            message=f"Presidente/{u_code.upper()}: download falhou, nova tentativa no próximo ciclo: {result}",
                        )
                        continue
                    cached_ufs[u_code] = result[1]
                    self._last_ab_timestamps[f"pres_uf_{u_code}"] = pending_ts[f"pres_uf_{u_code}"]

            child_2t_summaries = cached_ufs

        prev_snap = self.db.get_latest_snapshot(dispute_id)
        existing_tl = self.db.get_timeline(dispute_id, is_replay=False)

        candidate_snap = build_dispute_snapshot(
            dispute_id=dispute_id,
            cargo_code="1",
            uf="BR",
            election_code_2t=discovered.pres_code_2t,
            election_code_1t=discovered.pres_code_1t,
            macro_2t_payload=macro_2t_payload,
            macro_1t_summary=macro_1t,
            child_2t_summaries=child_2t_summaries,
            child_1t_summaries=child_1t_ufs,
            child_meta_list=child_meta_list,
            client=self.client,
            settings=self.settings,
            previous_snapshot=prev_snap,
            existing_timeline=existing_tl,
            cycle_index=self.cycle_count,
            is_replay=False,
            override_hms=sim_hms,
        )

        val_result, published_snap = self.publisher.validate_and_publish(candidate_snap)
        if not val_result.is_valid or val_result.warnings:
            # Sem isso, uma UF que veio "atrasada" da CDN ficava presa no cache e travava a
            # disputa em "Atualização em verificação" até o TSE mudar aquela UF de novo.
            self._forget_ab_timestamps("pres_uf_")
        return published_snap

    async def _process_governador_uf(
        self,
        uf_code: str,
        discovered: DiscoveredElectionConfig,
        base_data: dict[str, Any],
        sim_progress: float | None = None,
        sim_hms: str | None = None,
        force_exact_tie: bool = False,
    ) -> DisputeSnapshot:
        uf_l = uf_code.lower()
        dispute_id = f"governador-{uf_l}"
        macro_1t = base_data["gov_1t"]["ufs"][uf_l]
        child_1t_muns = base_data["gov_1t"]["mun"][uf_l]
        muns_catalog = base_data["municipalities_by_uf"].get(uf_l, [])

        child_meta_list = [
            {
                "code_tse": m["cd"],
                "code_ibge": m["cdi"],
                "uf": uf_l,
                "name": m["nm"],
                "is_capital": bool(m["c"]),
                "scope_type": "mu",
            }
            for m in muns_catalog
        ]

        if sim_progress is not None or self.settings.tse_source_mode == "sim_2026":
            prog = sim_progress if sim_progress is not None else 0.65
            hms = sim_hms or time.strftime("%H:%M:%S")
            cands_meta = await self._get_2t_candidates_meta(
                dispute_id, discovered.gov_code_2t, "3", uf_l, discovered.cycle
            )
            macro_2t_payload, child_2t_summaries = generate_2026_simulated_ea20_step(
                macro_1t_summary=macro_1t,
                child_1t_summaries=child_1t_muns,
                cands_2t_meta=cands_meta,
                ele_code_2t=discovered.gov_code_2t,
                cargo_code="3",
                uf_scope=uf_l,
                progress=prog,
                hms=hms,
                force_exact_tie=force_exact_tie,
            )
        else:
            # Modo Live: consulta <uf>-c0003-e006260-u.json e <uf>-e006260-ab.json (EA15)
            uf_u_url = self.client.url_resultado_u(
                discovered.gov_code_2t, "3", uf_l, cycle=discovered.cycle
            )
            uf_ab_url = self.client.url_acompanhamento_ab(
                discovered.gov_code_2t, uf_l, cycle=discovered.cycle
            )
            macro_2t_payload, uf_ab_payload = await asyncio.gather(
                self.client.fetch_json(uf_u_url),
                self.client.fetch_json(uf_ab_url),
            )
            self._cached_cands_2t_meta[dispute_id] = extract_ea20_summary(
                macro_2t_payload
            )["candidates_meta"]

            cached_muns = self._cached_child_2t.setdefault(dispute_id, {})
            muns_to_fetch: list[str] = []
            pending_ts: dict[str, str] = {}

            for abr_item in uf_ab_payload.get("abr", []):
                if str(abr_item.get("tpabr")) != "mun":
                    continue
                m_cd = str(abr_item.get("cdabr", ""))
                s_blk = abr_item.get("s") or {}
                e_blk = abr_item.get("e") or {}
                st_count = int(s_blk.get("st", 0) or 0)
                ab_key = f"gov_{uf_l}_{m_cd}"
                dt_ht = f"{abr_item.get('dt', '')}_{abr_item.get('ht', '')}_{st_count}"

                # Se st == 0 (0% apurado no município), o próprio EA15 (-ab.json) já fornece
                # ts, st=0, te, c=0 sem precisar baixar centenas de arquivos -u.json zerados!
                if st_count == 0 and m_cd not in cached_muns:
                    cached_muns[m_cd] = {
                        "dt": str(abr_item.get("dt", "")),
                        "ht": str(abr_item.get("ht", "")),
                        "ts": int(s_blk.get("ts", 0) or 0),
                        "st": 0,
                        "pstn": "0",
                        "te": int(e_blk.get("te", 0) or 0),
                        "est": 0,
                        "c": 0,
                        "vv": 0,
                        "vb": 0,
                        "tvn": 0,
                        "candidates_votes": {},
                    }
                    self._last_ab_timestamps[ab_key] = dt_ht
                elif self._last_ab_timestamps.get(ab_key) != dt_ht:
                    muns_to_fetch.append(m_cd)
                    pending_ts[ab_key] = dt_ht  # gravado só após sucesso

            if muns_to_fetch:
                async def _fetch_mun_2t(m_code: str) -> tuple[str, dict[str, Any]]:
                    url = self.client.url_resultado_u(
                        discovered.gov_code_2t,
                        "3",
                        uf_l,
                        m_code,
                        cycle=discovered.cycle,
                    )
                    pay = await self.client.fetch_json(url, raise_on_error=True)
                    return m_code, extract_ea20_summary(pay)

                fetched_muns = await asyncio.gather(
                    *[_fetch_mun_2t(m) for m in muns_to_fetch], return_exceptions=True
                )
                for m_code, result in zip(muns_to_fetch, fetched_muns):
                    if isinstance(result, BaseException):
                        self.client.cycle_fallbacks.append(f"governador-{uf_l}/{m_code}")
                        self.db.log_event(
                            level="WARNING",
                            component="poller",
                            message=f"Governador-{uf_l.upper()}/{m_code}: download falhou, nova tentativa no próximo ciclo: {result}",
                        )
                        continue
                    cached_muns[m_code] = result[1]
                    key = f"gov_{uf_l}_{m_code}"
                    self._last_ab_timestamps[key] = pending_ts[key]

            child_2t_summaries = cached_muns

        prev_snap = self.db.get_latest_snapshot(dispute_id)
        existing_tl = self.db.get_timeline(dispute_id, is_replay=False)

        candidate_snap = build_dispute_snapshot(
            dispute_id=dispute_id,
            cargo_code="3",
            uf=uf_l.upper(),
            election_code_2t=discovered.gov_code_2t,
            election_code_1t=discovered.gov_code_1t,
            macro_2t_payload=macro_2t_payload,
            macro_1t_summary=macro_1t,
            child_2t_summaries=child_2t_summaries,
            child_1t_summaries=child_1t_muns,
            child_meta_list=child_meta_list,
            client=self.client,
            settings=self.settings,
            previous_snapshot=prev_snap,
            existing_timeline=existing_tl,
            cycle_index=self.cycle_count,
            is_replay=False,
            override_hms=sim_hms,
        )

        val_result, published_snap = self.publisher.validate_and_publish(candidate_snap)
        if not val_result.is_valid or val_result.warnings:
            self._forget_ab_timestamps(f"gov_{uf_l}_")
        return published_snap

    async def _get_2t_candidates_meta(
        self,
        dispute_id: str,
        ele_code_2t: str,
        cargo_code: str,
        uf_l: str,
        cycle: str,
    ) -> list[dict[str, Any]]:
        if dispute_id in self._cached_cands_2t_meta:
            return self._cached_cands_2t_meta[dispute_id]
        url = self.client.url_resultado_u(ele_code_2t, cargo_code, uf_l, cycle=cycle)
        payload = await self.client.fetch_json(url, min_interval_seconds=3600)
        meta = extract_ea20_summary(payload)["candidates_meta"]
        self._cached_cands_2t_meta[dispute_id] = meta
        return meta

    async def get_or_build_pres_municipalities_for_uf(
        self, uf_code: str
    ) -> list[dict[str, Any]]:
        """Retorna os municípios de uma UF para o mapa/ranking Presidencial (sob demanda com cache)."""
        if self.discovered is None:
            await self.initialize()
        assert self.discovered is not None
        uf_l = uf_code.lower()

        muns_1t = await self.baseline_store.ensure_pres_municipalities_1t_for_uf(
            self.client, self.discovered, uf_l
        )
        muns_catalog = self.baseline_store.data.get("municipalities_by_uf", {}).get(
            uf_l, []
        )
        ab_url = self.client.url_acompanhamento_ab(
            self.discovered.pres_code_2t, uf_l, cycle=self.discovered.cycle
        )
        ab_payload = await self.client.fetch_json(ab_url, min_interval_seconds=60)
        ab_by_mun = {
            str(item.get("cdabr")): item
            for item in ab_payload.get("abr", [])
            if str(item.get("tpabr")) == "mun"
        }

        pres_snap = self.db.get_latest_snapshot("presidente")
        c1_num = pres_snap.candidates[0].number if pres_snap else "13"
        c2_num = pres_snap.candidates[1].number if pres_snap else "22"
        c1_name = pres_snap.candidates[0].ballot_name if pres_snap else "LULA"
        c2_name = (
            pres_snap.candidates[1].ballot_name if pres_snap else "FLAVIO BOLSONARO"
        )

        items: list[dict[str, Any]] = []
        for m in muns_catalog:
            m_cd = m["cd"]
            m1t = muns_1t.get(m_cd, {})
            ab_m = ab_by_mun.get(m_cd, {})
            s_blk = ab_m.get("s") or {}
            e_blk = ab_m.get("e") or {}

            ts_m = int(s_blk.get("ts") or m1t.get("ts") or 1)
            st_m = int(s_blk.get("st") or 0)
            pct_m = round(float(str(s_blk.get("pstn", "0")).replace(",", ".")), 2)
            te_m = int(e_blk.get("te") or m1t.get("te") or 1)
            c_2t = int(e_blk.get("c") or 0)
            c_1t = int(m1t.get("c", 0))
            vv_1t = int(m1t.get("vv", 0))
            bn_1t = float(m1t.get("blank_null_rate", 0.048))

            v1_1t = int(m1t.get("candidates_votes", {}).get(c1_num, 0))
            v2_1t = int(m1t.get("candidates_votes", {}).get(c2_num, 0))
            sum_two_1t = v1_1t + v2_1t
            c1_pct_1t = round(v1_1t / vv_1t * 100.0, 2) if vv_1t > 0 else 0.0
            c2_pct_1t = round(v2_1t / vv_1t * 100.0, 2) if vv_1t > 0 else 0.0
            c1_norm_1t = (
                round(v1_1t / sum_two_1t * 100.0, 2) if sum_two_1t > 0 else 50.0
            )
            leader_slot = 1 if v1_1t > v2_1t else (2 if v2_1t > v1_1t else 0)
            leader_name = (
                c1_name if leader_slot == 1 else (c2_name if leader_slot == 2 else "Empate")
            )
            rem_valid = max(0, int(round(max(0, c_1t - c_2t) * (1.0 - bn_1t))))

            items.append(
                {
                    "code_tse": m_cd,
                    "code_ibge": m["cdi"],
                    "uf": uf_l.upper(),
                    "name": m["nm"],
                    "is_capital": bool(m["c"]),
                    "scope_type": "mu",
                    "updated_at": f"{ab_m.get('dt', '')} {ab_m.get('ht', '')}".strip(),
                    "total_sections": ts_m,
                    "counted_sections": st_m,
                    "pct_counted": pct_m,
                    "pct_remaining": round(max(0.0, 100.0 - pct_m), 2),
                    "low_reliability": pct_m < 30.0,
                    "total_electorate": te_m,
                    "turnout_votes_2t": c_2t,
                    "turnout_votes_1t": c_1t,
                    "valid_votes_2t": 0,
                    "blank_votes_2t": 0,
                    "null_votes_2t": 0,
                    "blank_null_rate_1t": bn_1t,
                    "cand1_votes_2t": 0,
                    "cand2_votes_2t": 0,
                    "cand1_pct_2t": 0.0,
                    "cand2_pct_2t": 0.0,
                    "margin_2t_pp": 0.0,
                    "cand1_votes_1t": v1_1t,
                    "cand2_votes_1t": v2_1t,
                    "valid_votes_1t": vv_1t,
                    "cand1_pct_1t": c1_pct_1t,
                    "cand2_pct_1t": c2_pct_1t,
                    "cand1_norm_1t": c1_norm_1t,
                    "cand2_norm_1t": round(100.0 - c1_norm_1t, 2),
                    "leader_1t_slot": leader_slot,
                    "leader_1t_name": leader_name,
                    "margin_1t_pp": round(abs(c1_pct_1t - c2_pct_1t), 2),
                    "cand1_swing_pp": None,
                    "cand2_swing_pp": None,
                    "net_swing_cand1_pp": None,
                    "estimated_remaining_valid_votes": rem_valid,
                    "changed_in_last_cycle": False,
                    "delta_pct_counted_last_cycle": 0.0,
                    "source_json_url": self.client.url_resultado_u(
                        self.discovered.pres_code_2t,
                        "1",
                        uf_l,
                        m_cd,
                        cycle=self.discovered.cycle,
                    ),
                    "source_portal_url": self.client.url_portal_tse(
                        self.discovered.pres_code_2t, uf_l, m_cd
                    ),
                }
            )
        return items

    async def publish_pres_municipal_files(self) -> None:
        """Gera presidente/mun/<uf>.json com dados REAIS (EA15 + 1º turno).

        Substitui os arquivos simulados versionados. Votos do 2º turno por município não são
        baixados (seriam 5.570 arquivos por ciclo); o mapa municipal fica cinza ("sem votos")
        em vez de mostrar números inventados, e o ranking "Onde falta contar" usa o % apurado real.
        """
        if self.discovered is None:
            return
        out_dir = self.settings.snapshot_dir / "presidente" / "mun"
        for uf_l in sorted(self.baseline_store.data.get("municipalities_by_uf", {})):
            if uf_l in {"zz", "br"}:
                continue
            try:
                items = await self.get_or_build_pres_municipalities_for_uf(uf_l)
            except Exception as exc:
                self.db.log_event(
                    level="WARNING",
                    component="poller",
                    message=f"Municípios de {uf_l.upper()} não publicados neste ciclo: {exc}",
                )
                continue
            _atomic_write_json(
                out_dir / f"{uf_l}.json",
                {
                    "dispute_id": "presidente",
                    "uf": uf_l.upper(),
                    "uf_name": UF_NAMES.get(uf_l, uf_l.upper()),
                    "generated_at_hms": time.strftime("%H:%M:%S"),
                    "localities": items,
                },
            )

    def start_background_loop(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop_background_loop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while self._running:
            try:
                await self.run_single_cycle()
                # A cada ~5 min (e logo no 1º ciclo) atualiza os 27 arquivos municipais de Presidente.
                last_mun = getattr(self, "_last_mun_publish_ts", 0.0)
                if self.settings.tse_source_mode == "live" and time.time() - last_mun >= 300:
                    self._last_mun_publish_ts = time.time()
                    await self.publish_pres_municipal_files()
            except Exception as exc:
                self.db.log_event(
                    level="ERROR", component="poller", message=f"Falha no loop: {exc}"
                )
            await self.alert_manager.check_and_notify_staleness(self.last_success_ts)
            await asyncio.sleep(self.settings.tse_poll_interval_seconds)
