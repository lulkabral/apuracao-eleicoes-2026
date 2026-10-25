import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Info,
  Users,
  Vote,
} from 'lucide-react'
import type { DisputeSnapshot } from '../../types/election'
import { StateFlag } from '../common/StateFlag'
import { getDisputePairThemes } from '../../utils/candidatePalette'
import {
  formatCompactNumber,
  formatInt,
  formatOfficialCandidateName,
  formatPct,
  formatPP,
  formatSignedPP,
} from '../../utils/formatters'
import { CountingSpeedometer } from './CountingSpeedometer'

interface NeutralScoreboardProps {
  snapshot: DisputeSnapshot
  scoreboardRef?: React.RefObject<HTMLElement | null>
}

export function NeutralScoreboard({
  snapshot,
  scoreboardRef,
}: NeutralScoreboardProps) {
  const [cand1, cand2] = snapshot.candidates
  const [theme1, theme2] = getDisputePairThemes(cand1, cand2)
  const { sections, electorate, votes } = snapshot
  const voteDiff = Math.abs(cand1.votes - cand2.votes)
  const marginPP = Math.abs(cand1.pct_valid - cand2.pct_valid)

  const totalPct = cand1.pct_valid + cand2.pct_valid
  const bar1Width = totalPct > 0 ? (cand1.pct_valid / totalPct) * 100 : 50
  const bar2Width = 100 - bar1Width

  const leader =
    cand1.votes > cand2.votes
      ? cand1
      : cand2.votes > cand1.votes
        ? cand2
        : null
  const leaderTheme =
    cand1.votes > cand2.votes
      ? theme1
      : cand2.votes > cand1.votes
        ? theme2
        : null

  const remainingVotesEst =
    snapshot.pending_summary?.total_remaining_valid_votes ??
    snapshot.turnaround?.estimated_remaining_valid_votes_r ??
    0
  const remainingSections =
    sections.remaining_sections ??
    Math.max(0, sections.total_sections - sections.counted_sections)

  // Tendência da margem de liderança calculada com os dados existentes da timeline
  const marginTrend = useMemo(() => {
    const timeline = snapshot.timeline ?? []
    if (timeline.length < 2) return null
    const latest = timeline[timeline.length - 1]
    const prev = timeline[timeline.length - 2]
    const diffLatest = Math.abs(latest.cand1_pct - latest.cand2_pct)
    const diffPrev = Math.abs(prev.cand1_pct - prev.cand2_pct)
    const delta = diffLatest - diffPrev
    return {
      delta,
      formatted: `${delta >= 0 ? '▲ +' : '▼ -'}${formatPP(Math.abs(delta))}`,
    }
  }, [snapshot.timeline])

  // Animação de destaque quando o líder muda
  const prevLeaderSeqRef = useRef<number | null>(leader?.seq ?? null)
  const [leaderJustChanged, setLeaderJustChanged] = useState(false)

  useEffect(() => {
    if (
      leader &&
      prevLeaderSeqRef.current !== null &&
      prevLeaderSeqRef.current !== leader.seq
    ) {
      setLeaderJustChanged(true)
      const t = window.setTimeout(() => setLeaderJustChanged(false), 3000)
      prevLeaderSeqRef.current = leader.seq
      return () => window.clearTimeout(t)
    }
    if (leader) {
      prevLeaderSeqRef.current = leader.seq
    }
  }, [leader])

  const formatUrnasCount = (val: number): string => {
    if (val >= 1_000_000) {
      return `${(val / 1_000_000).toFixed(1).replace('.', ',')} mi`
    }
    if (val >= 1_000) {
      return `${(val / 1_000).toFixed(1).replace('.', ',')} mil`
    }
    return formatInt(val)
  }

  return (
    <section
      ref={scoreboardRef}
      aria-label={`Placar oficial de votos apurados para ${snapshot.cargo_name} (${snapshot.uf_name})`}
      data-testid="neutral-scoreboard"
      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs sm:p-4 dark:border-[#1F1F24] dark:bg-[#0A0A0C]"
    >
        {/* Cabeçalho da Disputa + Componente Unificado de Ritmo e Progresso */}
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-white shadow-xs dark:bg-white dark:text-slate-950">
                2º Turno • {snapshot.cargo_name}
              </span>
              <div className="flex items-center gap-2">
                <StateFlag
                  uf={snapshot.uf}
                  className="w-7 h-5 sm:w-8 sm:h-5.5 rounded object-cover shadow-xs ring-1 ring-black/10 dark:ring-white/20"
                  alt={`Bandeira de ${snapshot.uf_name}`}
                />
                <h2 className="text-xl sm:text-2xl font-extrabold text-slate-950 dark:text-white tracking-tight">
                  {snapshot.cargo_code === '1'
                    ? 'Presidente da República — Brasil'
                    : `Governador — ${snapshot.uf_name} (${snapshot.uf})`}
                </h2>
              </div>
              <div
                className="group relative inline-flex cursor-help"
                tabIndex={0}
                aria-label="Informações sobre o placar oficial"
              >
                <Info className="h-4 w-4 text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200" />
                <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-100 shadow-lg group-hover:block group-focus:block dark:border-[#1F1F24] dark:bg-[#0F0F12]">
                  Ordem oficial do TSE (seq) • Dados oficiais em tempo real
                </div>
              </div>
            </div>
          </div>

          {/* Componente Unificado: Anel Circular com % Apurado + Ritmo em Urnas/min */}
          <div className="flex items-center justify-start lg:justify-end">
            <CountingSpeedometer snapshot={snapshot} />
          </div>
        </div>

      {/* Barra Frente a Frente de Duelo com Marcador Central dos 50% */}
      <div className="mt-2 sm:mt-2.5">
        <div className="relative flex h-4 sm:h-5 w-full overflow-hidden rounded-full bg-slate-200 shadow-inner dark:bg-[#1F1F24]">
          <div
            className={`h-full transition-all duration-500 ${theme1.barClass}`}
            style={{ width: `${bar1Width}%` }}
          />
          <div
            className={`h-full transition-all duration-500 ${theme2.barClass}`}
            style={{ width: `${bar2Width}%` }}
          />
          {/* Pino Central Destacado nos 50% */}
          <div
            className="pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(255,255,255,0.95)] z-10 dark:bg-white"
            aria-hidden="true"
          />
          <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 rounded-full bg-slate-900 border border-white px-1.5 py-0.2 text-[9px] font-black text-white shadow-md dark:bg-black dark:border-white">
            50%
          </div>
        </div>
      </div>

      {/* Linha única de diferença para Tablet (600 a 1099px) */}
      <div
        className="mt-2 hidden min-[600px]:flex min-[1100px]:hidden items-center justify-between rounded-xl border border-amber-400/60 bg-amber-500/[0.08] dark:border-amber-500/40 dark:bg-amber-950/25 px-3.5 py-1.5 text-xs font-semibold shadow-2xs"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Diferença:
          </span>
          <strong className="font-mono text-sm font-black text-slate-900 dark:text-white">
            {formatCompactNumber(voteDiff)} ({formatInt(voteDiff)} votos)
          </strong>
        </div>
        {leader && marginPP > 0 && (
          <span className={`font-bold px-2.5 py-0.5 rounded-full text-xs ${leaderTheme?.badgeClass ?? ''}`}>
            +{formatPP(marginPP)} para {formatOfficialCandidateName(leader.ballot_name)}
          </span>
        )}
      </div>

      {/* Cartões dos Candidatos com Bloco de Diferença Centralizado */}
      <div className="mt-2 min-[600px]:mt-2.5 grid grid-cols-1 min-[600px]:grid-cols-2 min-[1100px]:grid-cols-[1fr_210px_1fr] gap-2 min-[600px]:gap-2.5 min-[1100px]:items-stretch">
        {/* Candidato 1 */}
        {(() => {
          const cand = cand1
          const theme = theme1
          const isCadu =
            cand.sqcand === '200002534001' ||
            cand.ballot_name.toUpperCase().includes('CADU')
          const primaryPhotoSrc = isCadu
            ? '/avatars/cadu-xavier-real.jpg?v=3'
            : `/avatars/${cand.sqcand}.jpg?v=3`
          const fallbackSvgSrc = isCadu
            ? '/avatars/cadu-xavier-real.jpg?v=3'
            : `/avatars/${cand.sqcand}.svg?v=3`
          const rawSrc =
            cand.photo_url && cand.photo_url.startsWith('/avatars/')
              ? cand.photo_url
              : primaryPhotoSrc
          const avatarSrc = isCadu
            ? '/avatars/cadu-xavier-real.jpg?v=3'
            : rawSrc.includes('?')
              ? rawSrc
              : `${rawSrc}?v=3`
          const tseOfficialPhotoUrl =
            cand.tse_photo_url ??
            `https://resultados.tse.jus.br/oficial/${snapshot.cycle}/${snapshot.election_code_2t}/fotos/${snapshot.uf.toLowerCase()}/f${snapshot.election_code_2t}${cand.sqcand}_div.jpg`

          return (
            <article
              key={cand.number}
              data-testid={`candidate-card-${cand.seq}`}
              data-theme-color={theme.key}
              className={`flex flex-col justify-between rounded-xl border-2 p-2.5 min-[600px]:p-3 transition ${theme.borderClass} ${theme.cardBgClass}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="relative h-12 w-12 min-[600px]:h-14 min-[600px]:w-14 min-[1100px]:h-[72px] min-[1100px]:w-[72px] shrink-0">
                      <img
                        src={avatarSrc}
                        data-tse-photo-url={tseOfficialPhotoUrl}
                        alt={`Foto oficial de ${cand.ballot_name} (${cand.party_acronym} - ${cand.number})`}
                        title={`Foto oficial TSE (${cand.tse_photo_filename ?? `f${snapshot.election_code_2t}${cand.sqcand}_div.jpg`})`}
                        data-testid={`candidate-photo-${cand.seq}`}
                        loading="eager"
                        decoding="async"
                        onError={(e) => {
                          const target = e.currentTarget
                          if (!target.src.endsWith(fallbackSvgSrc)) {
                            target.src = fallbackSvgSrc
                          }
                        }}
                        className={`h-12 w-12 min-[600px]:h-14 min-[600px]:w-14 min-[1100px]:h-[72px] min-[1100px]:w-[72px] rounded-xl bg-slate-200 object-cover object-top shadow-xs ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#0A0A0C] dark:bg-slate-800 ${theme.avatarRingClass}`}
                      />
                      <span
                        className={`-bottom-1 -right-1 absolute inline-flex h-4 min-w-4 items-center justify-center rounded px-1 font-mono text-[10px] font-black shadow-xs ${theme.badgeClass}`}
                        title={`Número de urna ${cand.number}`}
                      >
                        {cand.number}
                      </span>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm min-[600px]:text-base font-black leading-tight text-slate-900 dark:text-white">
                          {formatOfficialCandidateName(cand.ballot_name)}
                        </h3>
                        <span
                          className={`rounded border px-1.5 py-0.2 font-mono text-[10px] font-bold ${theme.softPillClass}`}
                        >
                          {cand.party_acronym} • {cand.number}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                        {cand.vice_name
                          ? `Vice: ${cand.vice_name} (${cand.vice_party})`
                          : cand.party_name}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      data-testid={`candidate-pct-${cand.seq}`}
                      className={`font-mono text-2xl min-[600px]:text-[32px] min-[1100px]:text-[28px] lg:text-[32px] font-black tracking-tight ${theme.textAccentClass}`}
                    >
                      {formatPct(cand.pct_valid)}
                    </div>
                    <div className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {formatCompactNumber(cand.votes)} votos
                    </div>
                  </div>
                </div>

                {/* Status Oficial do TSE */}
                {cand.tse_elected_flag && cand.tse_official_attribution && (
                  <div
                    data-testid={`tse-official-elected-badge-${cand.seq}`}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/70 dark:text-emerald-200"
                  >
                    <span>{cand.tse_official_attribution}</span>
                  </div>
                )}

                {/* Barra de votos válidos */}
                <div className="mt-2 h-1.5 min-[600px]:h-2 w-full overflow-hidden rounded-full bg-slate-200/90 dark:bg-[#1F1F24]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${theme.barClass}`}
                    style={{
                      width: `${Math.min(100, Math.max(0, cand.pct_valid))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Comparativo 1º turno em linha única com alto contraste */}
              <div className="mt-2 border-t border-slate-200/80 pt-1.5 text-xs font-medium text-slate-800 dark:border-[#1F1F24] dark:text-slate-200">
                <span>
                  1º turno <strong className="font-mono text-slate-900 dark:text-white">{formatPct(cand.pct_valid_1t)}</strong> → agora <strong className="font-mono text-slate-900 dark:text-white">{formatPct(cand.pct_valid)}</strong>
                  {cand.swing_pp !== null && (
                    <span className="font-mono font-bold ml-1 text-slate-900 dark:text-white">
                      ({formatSignedPP(cand.swing_pp)})
                    </span>
                  )}
                </span>
              </div>
            </article>
          )
        })()}

        {/* Mobile: Pílula compacta de linha única entre os candidatos (<600px) */}
        <div
          className={`flex min-[600px]:hidden items-center justify-between rounded-full border-2 px-3 py-1.5 text-xs font-semibold shadow-2xs transition-all duration-300 ${
            leader
              ? 'border-amber-400/70 bg-amber-500/10 dark:border-amber-500/50 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100'
              : 'border-slate-300/80 bg-slate-50/80 dark:border-[#1F1F24] dark:bg-[#0F0F12] text-slate-700 dark:text-slate-300'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300/90">
              Diferença:
            </span>
            <strong className="font-mono text-xs font-black text-amber-950 dark:text-amber-100">
              {formatCompactNumber(voteDiff)} votos
            </strong>
          </div>
          {leader && marginPP > 0 && (
            <span className="font-bold text-amber-900 dark:text-amber-200">
              +{formatPP(marginPP)} {formatOfficialCandidateName(leader.ballot_name)}
            </span>
          )}
        </div>

        {/* Desktop (>=1100px): Destaque central da DIFERENÇA DE VOTOS */}
        <div
          className={`hidden min-[1100px]:flex flex-col justify-between items-center rounded-xl border-2 p-3 text-center transition-all duration-300 relative border-amber-400/60 bg-amber-500/[0.07] dark:border-amber-500/40 dark:bg-amber-950/25 shadow-2xs ${
            leaderJustChanged ? 'ring-4 ring-amber-400 animate-pulse' : ''
          }`}
        >
          {/* Seta e badge indicando o líder */}
          <div className="flex items-center gap-1.5">
            {leader?.seq === cand1.seq && (
              <ArrowLeft className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-pulse shrink-0" aria-hidden="true" />
            )}
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Diferença
            </span>
            {leader?.seq === cand2.seq && (
              <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-pulse shrink-0" aria-hidden="true" />
            )}
          </div>

          <div className="my-0.5">
            <strong className="font-mono text-3xl font-black tracking-tight text-slate-950 dark:text-white leading-none">
              {formatCompactNumber(voteDiff)}
            </strong>
            <span className="block font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
              {formatInt(voteDiff)} votos
            </span>
          </div>

          {/* Pílula do Líder */}
          <div>
            {leader && leaderTheme && marginPP > 0 ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${leaderTheme.badgeClass}`}
              >
                {formatOfficialCandidateName(leader.ballot_name)} +{formatPP(marginPP)} na frente
              </span>
            ) : (
              <span className="font-mono text-[11px] font-semibold text-slate-400">
                {/* "Empate técnico" é termo de pesquisa; aqui há contagem exata */}
                {votes.valid_votes === 0 ? 'Aguardando votos' : 'Empate'}
              </span>
            )}
          </div>

          {/* Linha de Tendência */}
          {marginTrend && (
            <div className="border-t border-amber-200/40 dark:border-white/10 pt-1.5 w-full flex items-center justify-center gap-1 font-mono text-[10px] font-bold">
              <span className={marginTrend.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {marginTrend.formatted}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-sans">
                nas últimas atualizações
              </span>
            </div>
          )}
        </div>

        {/* Candidato 2 */}
        {(() => {
          const cand = cand2
          const theme = theme2
          const isCadu =
            cand.sqcand === '200002534001' ||
            cand.ballot_name.toUpperCase().includes('CADU')
          const primaryPhotoSrc = isCadu
            ? '/avatars/cadu-xavier-real.jpg?v=3'
            : `/avatars/${cand.sqcand}.jpg?v=3`
          const fallbackSvgSrc = isCadu
            ? '/avatars/cadu-xavier-real.jpg?v=3'
            : `/avatars/${cand.sqcand}.svg?v=3`
          const rawSrc =
            cand.photo_url && cand.photo_url.startsWith('/avatars/')
              ? cand.photo_url
              : primaryPhotoSrc
          const avatarSrc = isCadu
            ? '/avatars/cadu-xavier-real.jpg?v=3'
            : rawSrc.includes('?')
              ? rawSrc
              : `${rawSrc}?v=3`
          const tseOfficialPhotoUrl =
            cand.tse_photo_url ??
            `https://resultados.tse.jus.br/oficial/${snapshot.cycle}/${snapshot.election_code_2t}/fotos/${snapshot.uf.toLowerCase()}/f${snapshot.election_code_2t}${cand.sqcand}_div.jpg`

          return (
            <article
              key={cand.number}
              data-testid={`candidate-card-${cand.seq}`}
              data-theme-color={theme.key}
              className={`flex flex-col justify-between rounded-xl border-2 p-2.5 min-[600px]:p-3 transition ${theme.borderClass} ${theme.cardBgClass}`}
            >
              <div>
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="relative h-12 w-12 min-[600px]:h-14 min-[600px]:w-14 min-[1100px]:h-[72px] min-[1100px]:w-[72px] shrink-0">
                      <img
                        src={avatarSrc}
                        data-tse-photo-url={tseOfficialPhotoUrl}
                        alt={`Foto oficial de ${cand.ballot_name} (${cand.party_acronym} - ${cand.number})`}
                        title={`Foto oficial TSE (${cand.tse_photo_filename ?? `f${snapshot.election_code_2t}${cand.sqcand}_div.jpg`})`}
                        data-testid={`candidate-photo-${cand.seq}`}
                        loading="eager"
                        decoding="async"
                        onError={(e) => {
                          const target = e.currentTarget
                          if (!target.src.endsWith(fallbackSvgSrc)) {
                            target.src = fallbackSvgSrc
                          }
                        }}
                        className={`h-12 w-12 min-[600px]:h-14 min-[600px]:w-14 min-[1100px]:h-[72px] min-[1100px]:w-[72px] rounded-xl bg-slate-200 object-cover object-top shadow-xs ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#0A0A0C] dark:bg-slate-800 ${theme.avatarRingClass}`}
                      />
                      <span
                        className={`-bottom-1 -right-1 absolute inline-flex h-4 min-w-4 items-center justify-center rounded px-1 font-mono text-[10px] font-black shadow-xs ${theme.badgeClass}`}
                        title={`Número de urna ${cand.number}`}
                      >
                        {cand.number}
                      </span>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm min-[600px]:text-base font-black leading-tight text-slate-900 dark:text-white">
                          {formatOfficialCandidateName(cand.ballot_name)}
                        </h3>
                        <span
                          className={`rounded border px-1.5 py-0.2 font-mono text-[10px] font-bold ${theme.softPillClass}`}
                        >
                          {cand.party_acronym} • {cand.number}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                        {cand.vice_name
                          ? `Vice: ${cand.vice_name} (${cand.vice_party})`
                          : cand.party_name}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      data-testid={`candidate-pct-${cand.seq}`}
                      className={`font-mono text-2xl min-[600px]:text-[32px] min-[1100px]:text-[28px] lg:text-[32px] font-black tracking-tight ${theme.textAccentClass}`}
                    >
                      {formatPct(cand.pct_valid)}
                    </div>
                    <div className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {formatCompactNumber(cand.votes)} votos
                    </div>
                  </div>
                </div>

                {/* Status Oficial do TSE */}
                {cand.tse_elected_flag && cand.tse_official_attribution && (
                  <div
                    data-testid={`tse-official-elected-badge-${cand.seq}`}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/70 dark:text-emerald-200"
                  >
                    <span>{cand.tse_official_attribution}</span>
                  </div>
                )}

                {/* Barra de votos válidos */}
                <div className="mt-2 h-1.5 min-[600px]:h-2 w-full overflow-hidden rounded-full bg-slate-200/90 dark:bg-[#1F1F24]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${theme.barClass}`}
                    style={{
                      width: `${Math.min(100, Math.max(0, cand.pct_valid))}%`,
                    }}
                  />
                </div>
              </div>

              {/* Comparativo 1º turno em linha única com alto contraste */}
              <div className="mt-2 border-t border-slate-200/80 pt-1.5 text-xs font-medium text-slate-800 dark:border-[#1F1F24] dark:text-slate-200">
                <span>
                  1º turno <strong className="font-mono text-slate-900 dark:text-white">{formatPct(cand.pct_valid_1t)}</strong> → agora <strong className="font-mono text-slate-900 dark:text-white">{formatPct(cand.pct_valid)}</strong>
                  {cand.swing_pp !== null && (
                    <span className="font-mono font-bold ml-1 text-slate-900 dark:text-white">
                      ({formatSignedPP(cand.swing_pp)})
                    </span>
                  )}
                </span>
              </div>
            </article>
          )
        })()}
      </div>

      {/* Faixa Única de Métricas em Linha (~46 a 54px) */}
      <div className="mt-2.5 sm:mt-3 grid grid-cols-3 gap-1.5 sm:gap-2.5">
        {/* Chip 1: Votos Válidos (Verde) */}
        <div className="flex items-center gap-1.5 sm:gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-1.5 sm:px-3 sm:py-1.5 min-h-[46px] sm:min-h-[54px] text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-950/30 dark:text-emerald-100 min-w-0">
          <div className="flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <span className="block text-[8.5px] sm:text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 leading-tight">
              Válidos
            </span>
            <strong className="font-mono text-xs sm:text-base font-black text-emerald-950 dark:text-white leading-tight">
              {formatCompactNumber(votes.valid_votes)}
            </strong>
            <span className="font-mono text-[9px] sm:text-[10.5px] text-emerald-700/90 dark:text-emerald-300/90 leading-tight">
              Faltam ~{formatCompactNumber(remainingVotesEst)}
            </span>
          </div>
        </div>

        {/* Chip 2: Comparecimento (Roxo/Índigo) */}
        <div className="flex items-center gap-1.5 sm:gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/10 p-1.5 sm:px-3 sm:py-1.5 min-h-[46px] sm:min-h-[54px] text-indigo-950 dark:border-indigo-500/25 dark:bg-indigo-950/30 dark:text-indigo-100 min-w-0">
          <div className="flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <span className="block text-[8.5px] sm:text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 leading-tight">
              Comparec.
            </span>
            <strong className="font-mono text-xs sm:text-base font-black text-indigo-950 dark:text-white leading-tight">
              {formatPct(electorate.pct_turnout, 1)}
            </strong>
            <span className="font-mono text-[9px] sm:text-[10.5px] text-indigo-700/90 dark:text-indigo-300/90 leading-tight">
              Abstenção: {formatPct(electorate.pct_abstention, 1)}
            </span>
          </div>
        </div>

        {/* Chip 3: Urnas (Âmbar/Laranja) */}
        <div className="flex items-center gap-1.5 sm:gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-1.5 sm:px-3 sm:py-1.5 min-h-[46px] sm:min-h-[54px] text-amber-950 dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-100 min-w-0">
          <div className="flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <Vote className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <span className="block text-[8.5px] sm:text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 leading-tight">
              Urnas
            </span>
            <strong className="font-mono text-xs sm:text-base font-black text-amber-950 dark:text-white leading-tight">
              {formatPct(sections.pct_counted, 1)}
            </strong>
            <span className="font-mono text-[9px] sm:text-[10.5px] text-amber-700/90 dark:text-amber-300/90 leading-tight">
              {remainingSections > 0
                ? `Faltam ${formatUrnasCount(remainingSections)}`
                : '100% apurado'}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
