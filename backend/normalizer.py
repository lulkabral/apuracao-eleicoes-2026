"""Normalizador de dados brutos do TSE (EA14/EA15/EA20) para o modelo interno DisputeSnapshot."""

from __future__ import annotations

import time
from typing import Any

from backend.baseline_1t import extract_ea20_summary
from backend.calculator import (
    calculate_turnaround,
    compute_locality_remaining_valid_votes,
    summarize_pending_and_reference,
)
from backend.config import Settings
from backend.models import (
    CandidateResult,
    DisputeSnapshot,
    ElectorateSummary,
    FeatureFlagsPayload,
    LocalityDataItem,
    SectionsSummary,
    TimelinePoint,
    VotesSummary,
    parse_tse_float,
)
from backend.narrator import generate_narrator_messages
from backend.tse_client import TSEClient, UF_NAMES


def _fmt_br_pct(val: float) -> str:
    return f"{val:.2f}".replace(".", ",")


def build_dispute_snapshot(
    dispute_id: str,
    cargo_code: str,
    uf: str,
    election_code_2t: str,
    election_code_1t: str,
    macro_2t_payload: dict[str, Any],
    macro_1t_summary: dict[str, Any],
    child_2t_summaries: dict[str, dict[str, Any]],
    child_1t_summaries: dict[str, dict[str, Any]],
    child_meta_list: list[dict[str, Any]],
    client: TSEClient,
    settings: Settings,
    previous_snapshot: DisputeSnapshot | None = None,
    existing_timeline: list[TimelinePoint] | None = None,
    cycle_index: int = 0,
    is_replay: bool = False,
    replay_label: str | None = None,
    override_hms: str | None = None,
    override_iso: str | None = None,
) -> DisputeSnapshot:
    """Normaliza os dados de 2º turno e 1º turno de uma disputa em um DisputeSnapshot."""
    now = time.time()
    hms = override_hms or time.strftime("%H:%M:%S", time.localtime(now))
    iso = override_iso or time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now))

    macro_2t = extract_ea20_summary(macro_2t_payload)
    cands_raw = macro_2t["candidates_meta"]
    if len(cands_raw) < 2:
        raise ValueError(
            f"Disputa {dispute_id} possui menos de 2 candidatos no arquivo EA20."
        )

    # Ordem fixa e consistente: segue rigorosamente o campo 'seq' oficial do TSE
    cands_sorted = sorted(cands_raw[:2], key=lambda c: int(c["seq"]))

    c1_num = str(cands_sorted[0]["n"])
    c2_num = str(cands_sorted[1]["n"])

    # Votos do 1º turno na abrangência macro
    cands_1t_votes = macro_1t_summary.get("candidates_votes", {})
    vv_1t = int(macro_1t_summary.get("vv", 0))
    c1_v1t = int(cands_1t_votes.get(c1_num, 0))
    c2_v1t = int(cands_1t_votes.get(c2_num, 0))
    two_cand_sum_1t = c1_v1t + c2_v1t

    candidates: list[CandidateResult] = []
    for idx, c_raw in enumerate(cands_sorted):
        slot = 1 if idx == 0 else 2
        c_num = str(c_raw["n"])
        vap_2t = int(c_raw["vap"])
        pvapn_2t = parse_tse_float(c_raw["pvapn"])
        if macro_2t["vv"] > 0 and pvapn_2t == 0.0 and vap_2t > 0:
            pvapn_2t = round(vap_2t / macro_2t["vv"] * 100.0, 6)

        v_1t = c1_v1t if idx == 0 else c2_v1t
        pct_1t = round(v_1t / vv_1t * 100.0, 2) if vv_1t > 0 else 0.0
        norm_1t = (
            round(v_1t / two_cand_sum_1t * 100.0, 2)
            if two_cand_sum_1t > 0
            else 50.0
        )

        # Status oficial do TSE: só exibir Eleito se e == 's' (com atribuição explícita)
        e_flag = str(c_raw.get("e", "n")).strip().lower() == "s"
        st_text = str(c_raw.get("st", "")).strip()
        official_attr = "Eleito (segundo o TSE)" if e_flag else None

        swing_val = (
            round(pvapn_2t - pct_1t, 2) if macro_2t["vv"] > 0 else None
        )

        sqcand_str = str(c_raw["sqcand"])
        uf_lower = uf.lower()
        tse_photo_fname = f"f{election_code_2t}{sqcand_str}_div.jpg"
        tse_photo_meta_url = (
            f"https://resultados.tse.jus.br/oficial/ele2026/{election_code_2t}/fotos/{uf_lower}/{tse_photo_fname}"
        )
        candidates.append(
            CandidateResult(
                seq=int(c_raw["seq"]),
                number=c_num,
                sqcand=sqcand_str,
                full_name=str(c_raw["nm"]),
                ballot_name=str(c_raw["nmu"]),
                party_acronym=str(c_raw["sg"]),
                party_name=str(c_raw["party_nm"]),
                coalition_name=str(c_raw["coalition_nm"]),
                vice_name=str(c_raw["vice_nmu"]),
                vice_party=str(c_raw["vice_sgp"]),
                votes=vap_2t,
                pct_valid=round(pvapn_2t, 2),
                pct_valid_display=_fmt_br_pct(pvapn_2t),
                tse_elected_flag=e_flag,
                tse_status_text=st_text,
                tse_official_attribution=official_attr,
                votes_1t=v_1t,
                pct_valid_1t=pct_1t,
                pct_two_cand_1t=norm_1t,
                swing_pp=swing_val,
                color_Slot=slot,
                color_slot=slot,
                photo_url=f"/avatars/{sqcand_str}.jpg",
                tse_photo_url=tse_photo_meta_url,
                tse_photo_filename=tse_photo_fname,
            )
        )

    cand1, cand2 = candidates[0], candidates[1]

    pct_counted = round(parse_tse_float(macro_2t["pstn"]), 2)
    sections = SectionsSummary(
        total_sections=int(macro_2t["ts"]),
        counted_sections=int(macro_2t["st"]),
        remaining_sections=max(0, int(macro_2t["ts"]) - int(macro_2t["st"])),
        pct_counted=pct_counted,
        pct_counted_display=_fmt_br_pct(pct_counted),
    )

    turnout_1t_macro = int(macro_1t_summary.get("c", 0))
    te_1t_macro = int(macro_1t_summary.get("te", 0))
    pct_turnout_1t = (
        round(turnout_1t_macro / te_1t_macro * 100.0, 2)
        if te_1t_macro > 0
        else 0.0
    )

    electorate = ElectorateSummary(
        total_electorate=int(macro_2t["te"]),
        counted_electorate=int(macro_2t["est"]),
        turnout_votes=int(macro_2t["c"]),
        pct_turnout=round(parse_tse_float(macro_2t["pcn"]), 2),
        abstention_votes=int(macro_2t["a"]),
        pct_abstention=round(parse_tse_float(macro_2t["pan"]), 2),
        turnout_1t=turnout_1t_macro,
        pct_turnout_1t=pct_turnout_1t,
    )

    bn_rate_1t_macro = float(macro_1t_summary.get("blank_null_rate", 0.048))
    votes = VotesSummary(
        total_votes=int(macro_2t["tv"]),
        valid_votes=int(macro_2t["vv"]),
        pct_valid_votes=round(parse_tse_float(macro_2t["pvvn"]), 2),
        blank_votes=int(macro_2t["vb"]),
        pct_blank_votes=round(parse_tse_float(macro_2t["pvbn"]), 2),
        null_votes=int(macro_2t["tvn"]),
        pct_null_votes=round(parse_tse_float(macro_2t["ptvnn"]), 2),
        annulled_votes=int(macro_2t["annulled"]),
        blank_null_rate_1t=bn_rate_1t_macro,
    )

    # Mapa de localidades anteriores para detectar variação no ciclo
    prev_loc_map: dict[str, LocalityDataItem] = {}
    if previous_snapshot is not None:
        prev_loc_map = {loc.code_tse: loc for loc in previous_snapshot.localities}

    localities: list[LocalityDataItem] = []
    highlighted_code: str | None = None
    max_delta_pct = 0.0

    for meta in child_meta_list:
        code_tse = str(meta["code_tse"]).lower()
        scope_type = meta["scope_type"]  # "uf" ou "mu"
        uf_code = str(meta["uf"]).lower()
        c_2t = child_2t_summaries.get(code_tse, {})
        c_1t = child_1t_summaries.get(code_tse, {})

        ts_loc = int(c_2t.get("ts") or c_1t.get("ts") or 1)
        st_loc = int(c_2t.get("st", 0))
        pct_loc = round(parse_tse_float(c_2t.get("pstn", 0.0)), 2)
        te_loc = int(c_2t.get("te") or c_1t.get("te") or 1)
        turnout_2t_loc = int(c_2t.get("c", 0))
        turnout_1t_loc = int(c_1t.get("c", 0))
        vv_2t_loc = int(c_2t.get("vv", 0))
        vb_2t_loc = int(c_2t.get("vb", 0))
        tvn_2t_loc = int(c_2t.get("tvn", 0))
        bn_1t_loc = float(c_1t.get("blank_null_rate", bn_rate_1t_macro))

        c_2t_votes_map = c_2t.get("candidates_votes", {})
        loc_c1_2t = int(c_2t_votes_map.get(c1_num, 0))
        loc_c2_2t = int(c_2t_votes_map.get(c2_num, 0))

        # Caso o item filho venha apenas do arquivo EA15 (-ab.json) sem detalhamento de candidatos
        # mas já tenha votos apurados, preserva consistência somando aos votos válidos
        if vv_2t_loc == 0 and (loc_c1_2t + loc_c2_2t) > 0:
            vv_2t_loc = loc_c1_2t + loc_c2_2t

        loc_c1_pct_2t = (
            round(loc_c1_2t / vv_2t_loc * 100.0, 2) if vv_2t_loc > 0 else 0.0
        )
        loc_c2_pct_2t = (
            round(loc_c2_2t / vv_2t_loc * 100.0, 2) if vv_2t_loc > 0 else 0.0
        )
        loc_margin_2t = round(loc_c1_pct_2t - loc_c2_pct_2t, 2)

        c_1t_votes_map = c_1t.get("candidates_votes", {})
        loc_vv_1t = int(c_1t.get("vv", 0))
        loc_c1_1t = int(c_1t_votes_map.get(c1_num, 0))
        loc_c2_1t = int(c_1t_votes_map.get(c2_num, 0))
        loc_sum_two_1t = loc_c1_1t + loc_c2_1t

        loc_c1_pct_1t = (
            round(loc_c1_1t / loc_vv_1t * 100.0, 2) if loc_vv_1t > 0 else 0.0
        )
        loc_c2_pct_1t = (
            round(loc_c2_1t / loc_vv_1t * 100.0, 2) if loc_vv_1t > 0 else 0.0
        )
        loc_c1_norm_1t = (
            round(loc_c1_1t / loc_sum_two_1t * 100.0, 2)
            if loc_sum_two_1t > 0
            else 50.0
        )
        loc_c2_norm_1t = round(100.0 - loc_c1_norm_1t, 2)

        if loc_c1_1t > loc_c2_1t:
            leader_slot = 1
            leader_name = cand1.ballot_name
        elif loc_c2_1t > loc_c1_1t:
            leader_slot = 2
            leader_name = cand2.ballot_name
        else:
            leader_slot = 0
            leader_name = "Empate"

        margin_1t_pp = round(abs(loc_c1_pct_1t - loc_c2_pct_1t), 2)

        c1_swing = (
            round(loc_c1_pct_2t - loc_c1_pct_1t, 2) if vv_2t_loc > 0 else None
        )
        c2_swing = (
            round(loc_c2_pct_2t - loc_c2_pct_1t, 2) if vv_2t_loc > 0 else None
        )
        net_swing_c1 = (
            round(loc_c1_pct_2t - loc_c1_norm_1t, 2) if vv_2t_loc > 0 else None
        )

        _, rem_valid_loc, _, _ = compute_locality_remaining_valid_votes(
            turnout_1t=turnout_1t_loc,
            turnout_2t=turnout_2t_loc,
            total_electorate_2t=te_loc,
            blank_votes_2t=vb_2t_loc,
            null_votes_2t=tvn_2t_loc,
            blank_null_rate_1t=bn_1t_loc,
            pct_counted=pct_loc,
            turnout_adjustment_pct=0.0,
        )

        prev_loc = prev_loc_map.get(code_tse)
        delta_pct = (
            round(max(0.0, pct_loc - prev_loc.pct_counted), 2)
            if prev_loc is not None
            else 0.0
        )
        changed = delta_pct > 0.0 or (
            prev_loc is not None and turnout_2t_loc > prev_loc.turnout_votes_2t
        )
        if delta_pct > max_delta_pct:
            max_delta_pct = delta_pct
            highlighted_code = code_tse.upper() if scope_type == "uf" else code_tse

        if scope_type == "uf":
            src_json = client.url_resultado_u(
                election_code_2t, cargo_code, uf_code, cycle=settings.tse_cycle
            )
            src_portal = client.url_portal_tse(election_code_2t, uf_code)
        else:
            src_json = client.url_resultado_u(
                election_code_2t,
                cargo_code,
                uf_code,
                code_tse,
                cycle=settings.tse_cycle,
            )
            src_portal = client.url_portal_tse(election_code_2t, uf_code, code_tse)

        dt_ht = f"{c_2t.get('dt', '')} {c_2t.get('ht', '')}".strip()

        localities.append(
            LocalityDataItem(
                code_tse=code_tse.upper() if scope_type == "uf" else code_tse,
                code_ibge=str(meta.get("code_ibge", "")),
                uf=uf_code.upper(),
                name=str(meta["name"]),
                is_capital=bool(meta.get("is_capital", False)),
                scope_type=scope_type,
                updated_at=dt_ht,
                total_sections=ts_loc,
                counted_sections=st_loc,
                pct_counted=pct_loc,
                pct_remaining=round(max(0.0, 100.0 - pct_loc), 2),
                low_reliability=pct_loc < 30.0,
                total_electorate=te_loc,
                turnout_votes_2t=turnout_2t_loc,
                turnout_votes_1t=turnout_1t_loc,
                valid_votes_2t=vv_2t_loc,
                blank_votes_2t=vb_2t_loc,
                null_votes_2t=tvn_2t_loc,
                blank_null_rate_1t=bn_1t_loc,
                cand1_votes_2t=loc_c1_2t,
                cand2_votes_2t=loc_c2_2t,
                cand1_pct_2t=loc_c1_pct_2t,
                cand2_pct_2t=loc_c2_pct_2t,
                margin_2t_pp=loc_margin_2t,
                cand1_votes_1t=loc_c1_1t,
                cand2_votes_1t=loc_c2_1t,
                valid_votes_1t=loc_vv_1t,
                cand1_pct_1t=loc_c1_pct_1t,
                cand2_pct_1t=loc_c2_pct_1t,
                cand1_norm_1t=loc_c1_norm_1t,
                cand2_norm_1t=loc_c2_norm_1t,
                leader_1t_slot=leader_slot,
                leader_1t_name=leader_name,
                margin_1t_pp=margin_1t_pp,
                cand1_swing_pp=c1_swing,
                cand2_swing_pp=c2_swing,
                net_swing_cand1_pp=net_swing_c1,
                estimated_remaining_valid_votes=rem_valid_loc,
                changed_in_last_cycle=changed,
                delta_pct_counted_last_cycle=delta_pct,
                source_json_url=src_json,
                source_portal_url=src_portal,
            )
        )

    # Calculadora da Virada e Resumo de Pendentes
    turnaround = calculate_turnaround(
        cand1=cand1,
        cand2=cand2,
        turnout_votes_2t=electorate.turnout_votes,
        blank_votes_2t=votes.blank_votes,
        null_votes_2t=votes.null_votes,
        turnout_votes_1t=electorate.turnout_1t,
        total_electorate_2t=electorate.total_electorate,
        blank_null_rate_1t=votes.blank_null_rate_1t,
        pct_counted=sections.pct_counted,
        turnout_adjustment_pct=0.0,
        localities=localities,
    )

    pending_summary, reference_scenario = summarize_pending_and_reference(
        cand1=cand1,
        cand2=cand2,
        localities=localities,
        feature_reference_enabled=settings.feature_reference_scenario,
    )

    # Sincroniza R da calculadora com o total das localidades se disponível
    if pending_summary.total_remaining_valid_votes > 0 and sections.pct_counted < 100.0:
        pass

    # Linha do tempo (inclui o ponto atual)
    timeline = list(existing_timeline or [])
    current_point = TimelinePoint(
        timestamp=hms,
        iso_timestamp=iso,
        pct_counted=sections.pct_counted,
        cand1_pct=cand1.pct_valid,
        cand2_pct=cand2.pct_valid,
        margin_cand1_minus_cand2_pp=round(cand1.pct_valid - cand2.pct_valid, 2),
        cand1_votes=cand1.votes,
        cand2_votes=cand2.votes,
        valid_votes=votes.valid_votes,
    )
    if (
        not timeline
        or abs(timeline[-1].pct_counted - current_point.pct_counted) >= 1e-5
        or timeline[-1].cand1_votes != current_point.cand1_votes
    ):
        timeline.append(current_point)

    narrator_msgs = (
        generate_narrator_messages(
            dispute_id=dispute_id,
            timestamp_hms=hms,
            sections=sections,
            candidates=candidates,
            turnaround=turnaround,
            localities=localities,
            timeline=timeline,
            cycle_index=cycle_index,
        )
        if settings.feature_narrator
        else []
    )

    uf_l = uf.lower()
    cargo_name = "Presidente" if cargo_code == "1" else "Governador"
    uf_display_name = "Brasil" if uf_l == "br" else UF_NAMES.get(uf_l, uf.upper())

    return DisputeSnapshot(
        dispute_id=dispute_id,
        cargo_code="1" if cargo_code == "1" else "3",
        cargo_name=cargo_name,
        uf=uf.upper(),
        uf_name=uf_display_name,
        election_code_2t=election_code_2t,
        election_code_1t=election_code_1t,
        cycle="ele2022" if is_replay else settings.tse_cycle,
        is_replay=is_replay,
        replay_label=replay_label,
        generated_at_iso=iso,
        generated_at_hms=hms,
        tse_file_dg=macro_2t["dg"],
        tse_file_hg=macro_2t["hg"],
        tse_totalization_dt=macro_2t["dt"],
        tse_totalization_ht=macro_2t["ht"],
        validation_status="ok",
        validation_message=None,
        source_json_url=client.url_resultado_u(
            election_code_2t, cargo_code, uf_l, cycle=settings.tse_cycle
        ),
        source_portal_url=client.url_portal_tse(election_code_2t, uf_l),
        # Horário exibido = horário da TOTALIZAÇÃO do TSE (campo ht do EA20), não o relógio
        # do servidor. Se o TSE parar de atualizar, o horário na tela para junto.
        fixed_banner_text=(
            "Resultado parcial até 100% das urnas apuradas. Fonte: TSE. "
            f"Totalização TSE às {macro_2t['ht'] or hms}"
        ),
        sections=sections,
        electorate=electorate,
        votes=votes,
        candidates=candidates,
        turnaround=turnaround,
        pending_summary=pending_summary,
        reference_scenario=reference_scenario,
        localities=localities,
        highlighted_locality_code=highlighted_code,
        timeline=timeline,
        narrator_messages=narrator_msgs,
        feature_flags=FeatureFlagsPayload(
            reference_scenario=settings.feature_reference_scenario,
            narrator=settings.feature_narrator,
            replay=settings.feature_replay,
        ),
    )
