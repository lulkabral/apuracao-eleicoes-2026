"""Cliente HTTP Assíncrono do TSE (Resolução TSE nº 23.751/2026, arts. 264 a 269).

- Nunca fixa no código quais estados têm 2º turno de governador: descobre de `ele-c.json` (EA11).
- Envia `If-None-Match` (ETag) e `If-Modified-Since` quando disponíveis.
- Respeita intervalo mínimo de ~45-60s por arquivo e semáforo de concorrência.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from backend.config import Settings
from backend.db import Database

UF_NAMES: dict[str, str] = {
    "ac": "Acre",
    "al": "Alagoas",
    "am": "Amazonas",
    "ap": "Amapá",
    "ba": "Bahia",
    "ce": "Ceará",
    "df": "Distrito Federal",
    "es": "Espírito Santo",
    "go": "Goiás",
    "ma": "Maranhão",
    "mg": "Minas Gerais",
    "ms": "Mato Grosso do Sul",
    "mt": "Mato Grosso",
    "pa": "Pará",
    "pb": "Paraíba",
    "pe": "Pernambuco",
    "pi": "Piauí",
    "pr": "Paraná",
    "rj": "Rio de Janeiro",
    "rn": "Rio Grande do Norte",
    "ro": "Rondônia",
    "rr": "Roraima",
    "rs": "Rio Grande do Sul",
    "sc": "Santa Catarina",
    "se": "Sergipe",
    "sp": "São Paulo",
    "to": "Tocantins",
    "zz": "Exterior",
    "br": "Brasil",
}


@dataclass
class DiscoveredElectionConfig:
    """Metadados descobertos dinamicamente a partir do arquivo oficial ele-c.json (EA11)."""

    cycle: str
    election_date_1t: str
    election_date_2t: str
    pres_code_1t: str
    pres_code_2t: str
    gov_code_1t: str
    gov_code_2t: str
    gov_2t_ufs: list[str] = field(default_factory=list)


def pad_election_code(code: str | int) -> str:
    """Formata código de eleição com 6 dígitos e zeros à esquerda (ex.: '6258' -> '006258')."""
    return f"{int(str(code).strip()):06d}"


def pad_cargo_code(code: str | int) -> str:
    """Formata código de cargo com 4 dígitos e zeros à esquerda (ex.: '1' -> '0001')."""
    return f"{int(str(code).strip()):04d}"


def pad_mun_code(code: str | int) -> str:
    """Formata código de município TSE com 5 dígitos e zeros à esquerda (ex.: '1392' -> '01392')."""
    return f"{int(str(code).strip()):05d}"


class TSEClient:
    """Cliente oficial de coleta com cache ETag/If-Modified-Since e controle de cadência."""

    def __init__(self, settings: Settings, db: Database) -> None:
        self.settings = settings
        self.db = db
        self._semaphore = asyncio.Semaphore(settings.tse_max_concurrent_requests)
        self._client: httpx.AsyncClient | None = None
        # URLs que, neste ciclo, falharam e foram servidas do cache local (dado possivelmente velho)
        self.cycle_fallbacks: list[str] = []
        self.stats = {"requests_total": 0, "not_modified_304": 0, "errors_total": 0}

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.settings.tse_request_timeout_seconds),
                headers={
                    "User-Agent": "Apuracao2Turno2026-Aggregator/1.0 (+https://resultados.tse.jus.br)",
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate, br",
                },
                follow_redirects=True,
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # Construtores de URLs oficiais (EA11, EA12, EA14, EA15, EA20)
    # ------------------------------------------------------------------
    def url_ele_c(self) -> str:
        """EA11: Arquivo de Configuração de Eleições."""
        return f"{self.settings.tse_base_url}/{self.settings.tse_environment}/comum/config/ele-c.json"

    def url_mun_cm(self, election_code: str, cycle: str | None = None) -> str:
        """EA12: Arquivo de Configuração de Municípios."""
        cyc = cycle or self.settings.tse_cycle
        e6 = pad_election_code(election_code)
        return (
            f"{self.settings.tse_base_url}/{self.settings.tse_environment}/"
            f"{cyc}/{election_code}/config/mun-e{e6}-cm.json"
        )

    def url_acompanhamento_ab(
        self, election_code: str, uf: str = "br", cycle: str | None = None
    ) -> str:
        """EA14 (uf='br') ou EA15 (uf='<sigla>'): Arquivo de Acompanhamento."""
        cyc = cycle or self.settings.tse_cycle
        uf_l = uf.lower()
        e6 = pad_election_code(election_code)
        return (
            f"{self.settings.tse_base_url}/{self.settings.tse_environment}/"
            f"{cyc}/{election_code}/dados/{uf_l}/{uf_l}-e{e6}-ab.json"
        )

    def url_resultado_u(
        self,
        election_code: str,
        cargo_code: str,
        uf: str = "br",
        mun_code_tse: str | None = None,
        cycle: str | None = None,
    ) -> str:
        """EA20: Arquivo de Resultado Unificado (Nacional, UF ou Município)."""
        cyc = cycle or self.settings.tse_cycle
        uf_l = uf.lower()
        c4 = pad_cargo_code(cargo_code)
        e6 = pad_election_code(election_code)
        if mun_code_tse:
            m5 = pad_mun_code(mun_code_tse)
            prefix = f"{uf_l}{m5}"
        else:
            prefix = uf_l
        return (
            f"{self.settings.tse_base_url}/{self.settings.tse_environment}/"
            f"{cyc}/{election_code}/dados/{uf_l}/{prefix}-c{c4}-e{e6}-u.json"
        )

    def url_portal_tse(
        self, election_code: str, uf: str = "br", mun_code_tse: str | None = None
    ) -> str:
        """URL amigável do Portal Oficial de Resultados do TSE para 'ver na fonte'."""
        e6 = pad_election_code(election_code)
        uf_l = uf.lower()
        if mun_code_tse:
            m5 = pad_mun_code(mun_code_tse)
            return (
                f"https://resultados.tse.jus.br/oficial/app/index.html"
                f"#/eleicao;e=e{e6};uf={uf_l};mu={m5}/resultados"
            )
        return (
            f"https://resultados.tse.jus.br/oficial/app/index.html"
            f"#/eleicao;e=e{e6};uf={uf_l};ufbu={uf_l}/resultados"
        )

    def url_foto_candidato(
        self, election_code: str, uf: str, sqcand: str, cycle: str | None = None
    ) -> str:
        """URL oficial do arquivo de foto de urna no TSE (apenas para espelhamento no backend).

        Convenção TSE: /<ambiente>/<ciclo>/<cd_pleito>/fotos/<uf>/f<cd_pleito><sqcand>_div.jpg
        """
        cyc = cycle or self.settings.tse_cycle
        uf_l = uf.lower()
        return (
            f"{self.settings.tse_base_url}/{self.settings.tse_environment}/"
            f"{cyc}/{election_code}/fotos/{uf_l}/f{election_code}{sqcand}_div.jpg"
        )

    # ------------------------------------------------------------------
    # Busca HTTP com Cache ETag / If-Modified-Since e Rate Limit
    # ------------------------------------------------------------------
    async def fetch_json(
        self,
        url: str,
        min_interval_seconds: int | None = None,
        force_refresh: bool = False,
        raise_on_error: bool = False,
    ) -> dict[str, Any]:
        """Busca um arquivo JSON do TSE respeitando o intervalo mínimo e os cabeçalhos condicionais."""
        interval = (
            self.settings.tse_min_file_interval_seconds
            if min_interval_seconds is None
            else min_interval_seconds
        )
        now = time.time()
        cached = self.db.get_http_cache(url)

        if (
            cached is not None
            and not force_refresh
            and (now - cached["last_checked_ts"]) < interval
        ):
            return cached["payload"]

        headers: dict[str, str] = {}
        if cached is not None and not force_refresh:
            if cached.get("etag"):
                headers["If-None-Match"] = str(cached["etag"])
            if cached.get("last_modified"):
                headers["If-Modified-Since"] = str(cached["last_modified"])

        async with self._semaphore:
            try:
                client = await self._get_client()
                resp = await client.get(url, headers=headers)
                self.stats["requests_total"] += 1

                if resp.status_code == 304 and cached is not None:
                    self.stats["not_modified_304"] += 1
                    self.db.touch_http_cache(url, checked_ts=time.time())
                    return cached["payload"]

                resp.raise_for_status()
                payload = resp.json()
                etag = resp.headers.get("etag") or resp.headers.get("ETag")
                last_mod = resp.headers.get("last-modified") or resp.headers.get(
                    "Last-Modified"
                )
                self.db.set_http_cache(
                    url=url,
                    payload=payload,
                    etag=etag,
                    last_modified=last_mod,
                    checked_ts=time.time(),
                )
                return payload
            except Exception as exc:
                self.db.log_event(
                    level="WARNING",
                    component="tse_client",
                    message=f"Falha ao consultar {url}: {exc}",
                    details={"url": url, "has_cache_fallback": cached is not None},
                )
                self.stats["errors_total"] += 1
                if cached is not None and not raise_on_error:
                    # Continua servindo o último dado, mas AVISA o poller que ele pode estar velho.
                    self.cycle_fallbacks.append(url)
                    return cached["payload"]
                raise

    # ------------------------------------------------------------------
    # Descoberta dinâmica de eleições e estados com 2º turno (EA11)
    # ------------------------------------------------------------------
    @staticmethod
    def parse_ele_c_config(
        ele_c_payload: dict[str, Any], target_cycle: str = "ele2026"
    ) -> DiscoveredElectionConfig:
        """Analisa o JSON de `ele-c.json` (EA11) para descobrir os códigos do 1º e 2º turno
        e os estados que têm 2º turno para Governador, sem fixar siglas no código.
        """
        pres_1t = ""
        pres_2t = ""
        gov_1t = ""
        gov_2t = ""
        dt_1t = "04/10/2026"
        dt_2t = "25/10/2026"
        gov_2t_ufs: list[str] = []

        for pl in ele_c_payload.get("pl", []):
            if pl.get("c") != target_cycle:
                continue
            dt = str(pl.get("dt", ""))
            for ele in pl.get("e", []):
                turno = str(ele.get("t", ""))
                cd = str(ele.get("cd", ""))
                cdt2 = str(ele.get("cdt2", ""))
                abrs = ele.get("abr", [])

                has_pres = any(
                    str(cp.get("cd")) == "1"
                    for abr in abrs
                    for cp in abr.get("cp", [])
                )
                has_gov = any(
                    str(cp.get("cd")) == "3"
                    for abr in abrs
                    for cp in abr.get("cp", [])
                )

                if turno == "1" and has_pres:
                    pres_1t = cd
                    if cdt2:
                        pres_2t = cdt2
                    dt_1t = dt
                elif turno == "2" and has_pres:
                    pres_2t = cd
                    dt_2t = dt

                if turno == "1" and has_gov and cdt2:
                    gov_1t = cd
                    gov_2t = cdt2
                elif turno == "2" and has_gov:
                    gov_2t = cd
                    dt_2t = dt
                    for abr in abrs:
                        uf_code = str(abr.get("cd", "")).lower().strip()
                        if (
                            uf_code
                            and uf_code != "br"
                            and any(str(cp.get("cd")) == "3" for cp in abr.get("cp", []))
                        ):
                            if uf_code not in gov_2t_ufs:
                                gov_2t_ufs.append(uf_code)

        # Ordena alfabeticamente as siglas de UF descobertas para consistência na UI
        gov_2t_ufs.sort()

        if not (pres_1t and pres_2t):
            raise ValueError(
                f"Não foi possível descobrir códigos de Presidente para o ciclo {target_cycle} em ele-c.json"
            )

        return DiscoveredElectionConfig(
            cycle=target_cycle,
            election_date_1t=dt_1t,
            election_date_2t=dt_2t,
            pres_code_1t=pres_1t,
            pres_code_2t=pres_2t,
            gov_code_1t=gov_1t,
            gov_code_2t=gov_2t,
            gov_2t_ufs=gov_2t_ufs,
        )

    async def discover_election_config(
        self, force_refresh: bool = False
    ) -> DiscoveredElectionConfig:
        payload = await self.fetch_json(
            self.url_ele_c(), min_interval_seconds=300, force_refresh=force_refresh
        )
        return self.parse_ele_c_config(payload, target_cycle=self.settings.tse_cycle)
