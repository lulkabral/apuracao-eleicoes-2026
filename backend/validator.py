"""Validação de sanidade dos dados do TSE antes de publicar qualquer snapshot.

Garante que nenhum número absurdo, soma incoerente ou regressão de apuração seja publicada.
Se falhar, o publicador mantém o snapshot anterior, grava o erro e marca 'Atualização em verificação'.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from backend.models import DisputeSnapshot


@dataclass
class ValidationResult:
    """Resultado da auditoria de sanidade de um DisputeSnapshot."""

    is_valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate_snapshot(
    candidate_snapshot: DisputeSnapshot,
    previous_snapshot: DisputeSnapshot | None = None,
) -> ValidationResult:
    """Executa todas as verificações de sanidade em um novo snapshot antes da publicação."""
    errors: list[str] = []
    warnings: list[str] = []

    sec = candidate_snapshot.sections
    elec = candidate_snapshot.electorate
    votes = candidate_snapshot.votes
    cands = candidate_snapshot.candidates

    # 1. Verificação de número de candidatos no 2º turno (deve haver exatamente 2)
    if len(cands) != 2:
        errors.append(
            f"Quantidade inválida de candidatos no 2º turno: esperado 2, recebido {len(cands)}."
        )

    # 2. Verificação de faixas plausíveis de percentuais [0, 100]
    if not (0.0 <= sec.pct_counted <= 100.0):
        errors.append(
            f"Percentual de seções totalizadas fora da faixa [0, 100]: {sec.pct_counted}."
        )
    if sec.total_sections <= 0:
        errors.append(f"Total de seções inválido: {sec.total_sections}.")
    if sec.counted_sections < 0 or sec.counted_sections > sec.total_sections:
        errors.append(
            f"Seções totalizadas ({sec.counted_sections}) incoerentes com total ({sec.total_sections})."
        )

    # 3. Verificação de eleitorado e comparecimento
    if elec.total_electorate <= 0:
        errors.append(f"Eleitorado total inválido: {elec.total_electorate}.")
    if elec.turnout_votes < 0 or elec.turnout_votes > elec.total_electorate:
        errors.append(
            f"Comparecimento ({elec.turnout_votes}) fora da faixa [0, {elec.total_electorate}]."
        )
    if elec.abstention_votes < 0 or elec.abstention_votes > elec.total_electorate:
        errors.append(
            f"Abstenção ({elec.abstention_votes}) fora da faixa [0, {elec.total_electorate}]."
        )

    # 4. Coerência da soma de votos (candidatos + brancos + nulos + anulados == total de votos)
    if len(cands) == 2:
        sum_cand_votes = cands[0].votes + cands[1].votes
        if cands[0].votes < 0 or cands[1].votes < 0:
            errors.append("Votos negativos detectados para um dos candidatos.")

        # A soma dos votos dos 2 candidatos no 2º turno deve bater com valid_votes
        if abs(sum_cand_votes - votes.valid_votes) > 5:
            errors.append(
                f"Soma de votos dos candidatos ({sum_cand_votes}) diverge de votos válidos ({votes.valid_votes})."
            )

        for c in cands:
            if not (0.0 <= c.pct_valid <= 100.0):
                errors.append(
                    f"Percentual do candidato {c.ballot_name} fora da faixa [0, 100]: {c.pct_valid}."
                )

        if votes.valid_votes > 0:
            pct_sum = cands[0].pct_valid + cands[1].pct_valid
            if not (99.8 <= pct_sum <= 100.2):
                errors.append(
                    f"Soma dos percentuais válidos dos candidatos incoerente: {pct_sum:.4f}%."
                )

    computed_total_votes = (
        votes.valid_votes + votes.blank_votes + votes.null_votes + votes.annulled_votes
    )
    if abs(computed_total_votes - votes.total_votes) > 5:
        errors.append(
            f"Soma (válidos={votes.valid_votes} + brancos={votes.blank_votes} + nulos={votes.null_votes} "
            f"+ anulados={votes.annulled_votes} = {computed_total_votes}) diverge do total de votos ({votes.total_votes})."
        )

    # 5. Verificação de sanidade nas localidades filhas
    for loc in candidate_snapshot.localities:
        if not (0.0 <= loc.pct_counted <= 100.0):
            errors.append(
                f"Localidade {loc.name} ({loc.code_tse}) com % apurado inválido: {loc.pct_counted}."
            )
        if loc.cand1_votes_2t < 0 or loc.cand2_votes_2t < 0 or loc.turnout_votes_2t < 0:
            errors.append(
                f"Localidade {loc.name} ({loc.code_tse}) com votos negativos."
            )
        if (
            loc.valid_votes_2t > 0
            and abs((loc.cand1_votes_2t + loc.cand2_votes_2t) - loc.valid_votes_2t) > 5
        ):
            errors.append(
                f"Localidade {loc.name} ({loc.code_tse}): soma de candidatos diverge dos votos válidos."
            )

    # 6. Verificação de monotonicidade contra o snapshot anterior válido (se mesma eleição/modo)
    if (
        previous_snapshot is not None
        and previous_snapshot.election_code_2t == candidate_snapshot.election_code_2t
        and previous_snapshot.is_replay == candidate_snapshot.is_replay
    ):
        if sec.pct_counted + 1e-6 < previous_snapshot.sections.pct_counted:
            errors.append(
                f"Regressão no % de seções apuradas: {sec.pct_counted}% < anterior {previous_snapshot.sections.pct_counted}%."
            )
        if sec.counted_sections < previous_snapshot.sections.counted_sections:
            errors.append(
                f"Regressão em seções totalizadas: {sec.counted_sections} < anterior {previous_snapshot.sections.counted_sections}."
            )
        if votes.total_votes < previous_snapshot.votes.total_votes:
            errors.append(
                f"Regressão no total de votos: {votes.total_votes} < anterior {previous_snapshot.votes.total_votes}."
            )

        prev_cands_by_num = {c.number: c.votes for c in previous_snapshot.candidates}
        for c in cands:
            prev_v = prev_cands_by_num.get(c.number)
            if prev_v is not None and c.votes < prev_v:
                errors.append(
                    f"Regressão nos votos do candidato {c.ballot_name} ({c.number}): {c.votes} < anterior {prev_v}."
                )

        # O TSE avisa que os EA20 de UFs/municípios podem ficar dessincronizados por alguns
        # segundos na CDN. Regressão em UMA localidade vira aviso (o poller rebaixa no próximo
        # ciclo); só a regressão do total da disputa (acima) bloqueia a publicação.
        prev_locs = {loc.code_tse: loc for loc in previous_snapshot.localities}
        for loc in candidate_snapshot.localities:
            p_loc = prev_locs.get(loc.code_tse)
            if p_loc is not None:
                if loc.pct_counted + 1e-6 < p_loc.pct_counted:
                    warnings.append(
                        f"Regressão de % apurado em {loc.name} ({loc.code_tse}): {loc.pct_counted}% < {p_loc.pct_counted}%."
                    )
                if loc.turnout_votes_2t < p_loc.turnout_votes_2t:
                    warnings.append(
                        f"Regressão de votos em {loc.name} ({loc.code_tse}): {loc.turnout_votes_2t} < {p_loc.turnout_votes_2t}."
                    )
                if loc.cand1_votes_2t < p_loc.cand1_votes_2t or loc.cand2_votes_2t < p_loc.cand2_votes_2t:
                    warnings.append(
                        f"Regressão de votos por candidato em {loc.name} ({loc.code_tse})."
                    )

    return ValidationResult(is_valid=len(errors) == 0, errors=errors, warnings=warnings)
