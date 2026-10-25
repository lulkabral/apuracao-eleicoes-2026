import { useState } from 'react'
import {
  ArrowUpDown,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
  Search,
} from 'lucide-react'
import type { DisputeSnapshot, LocalityDataItem } from '../../types/election'
import { StateFlag } from '../common/StateFlag'
import { getDisputePairThemes } from '../../utils/candidatePalette'
import {
  formatCompactNumber,
  formatOfficialCandidateName,
  formatPct,
  formatPP,
} from '../../utils/formatters'

interface WhereVotesRemainProps {
  snapshot: DisputeSnapshot
}

type SortByMode = 'remaining_votes' | 'pct_remaining'

export function WhereVotesRemain({ snapshot }: WhereVotesRemainProps) {
  const [cand1, cand2] = snapshot.candidates
  const [theme1, theme2] = getDisputePairThemes(cand1, cand2)
  const { pending_summary: pending } = snapshot

  const [sortBy, setSortBy] = useState<SortByMode>('remaining_votes')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isExpanded, setIsExpanded] = useState<boolean>(false)

  // Para Presidente: permite expandir uma UF e ver o ranking dos municípios dela
  const [selectedPresUf, setSelectedPresUf] = useState<string | null>(null)
  const [presMunList, setPresMunList] = useState<LocalityDataItem[] | null>(
    null,
  )
  const [loadingPresMun, setLoadingPresMun] = useState<boolean>(false)

  const handleDrillDownPresUf = async (ufCode: string) => {
    const ufLower = ufCode.toLowerCase()
    if (ufLower === 'zz') return
    setSelectedPresUf(ufCode.toUpperCase())
    setLoadingPresMun(true)
    try {
      const staticRes = await fetch(
        `/snapshots/presidente/mun/${ufLower}.json`,
      )
      if (staticRes.ok) {
        const staticData = (await staticRes.json()) as {
          localities?: LocalityDataItem[]
          municipalities?: LocalityDataItem[]
        }
        setPresMunList(staticData.localities ?? staticData.municipalities ?? [])
        return
      }
      const res = await fetch(`/api/v1/presidente/municipalities/${ufLower}`)
      if (res.ok) {
        const data = (await res.json()) as {
          municipalities: LocalityDataItem[]
        }
        setPresMunList(data.municipalities)
      } else {
        setPresMunList([])
      }
    } catch {
      setPresMunList([])
    } finally {
      setLoadingPresMun(false)
    }
  }

  const activeLocalities =
    snapshot.cargo_code === '1' && selectedPresUf && presMunList
      ? presMunList
      : snapshot.localities

  const filteredLocalities = activeLocalities
    .filter((loc) => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.trim().toLowerCase()
      return (
        loc.name.toLowerCase().includes(q) ||
        loc.uf.toLowerCase().includes(q) ||
        loc.code_tse.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sortBy === 'remaining_votes') {
        if (b.estimated_remaining_valid_votes !== a.estimated_remaining_valid_votes) {
          return (
            b.estimated_remaining_valid_votes - a.estimated_remaining_valid_votes
          )
        }
        return b.pct_remaining - a.pct_remaining
      }
      if (b.pct_remaining !== a.pct_remaining) {
        return b.pct_remaining - a.pct_remaining
      }
      return (
        b.estimated_remaining_valid_votes - a.estimated_remaining_valid_votes
      )
    })

  const visibleCards = isExpanded ? filteredLocalities : filteredLocalities.slice(0, 3)

  return (
    <section
      aria-label="Onde ainda falta contar"
      data-testid="where-votes-remain"
      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 dark:border-[#1F1F24] dark:bg-[#0A0A0C]"
    >
      {/* 1. Cabeçalho Limpo: Título + Ícone ⓘ com Tooltip Dinâmico + Toggle Feature Flag */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm">
            <BarChart3 className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            <span
              className="absolute -top-1 -right-1 flex h-2.5 w-2.5"
              title="Indicador de votos pendentes"
            >
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
          </div>
          <span className="text-base font-bold text-slate-900 sm:text-lg dark:text-white">
            Onde ainda falta contar
          </span>

          {/* Ícone ⓘ discreto com Tooltip dinâmico */}
          <div className="group relative inline-flex items-center">
            <button
              type="button"
              className="rounded-full p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none dark:text-slate-500 dark:hover:text-slate-300"
              aria-label="Informações sobre os votos pendentes"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-72 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200 shadow-2xl group-hover:block group-focus-within:block">
              <p className="font-medium text-white">
                Distribuição dos Votos Restantes
              </p>
              <p className="mt-1 text-slate-300">
                Total de votos válidos ainda a apurar cruzado com a preferência
                eleitoral registrada no 1º turno de 2026 em cada localidade.
              </p>
              <div className="mt-2 rounded border border-amber-500/30 bg-amber-950/60 px-2 py-1 text-[11px] font-semibold text-amber-300">
                {pending.disclaimer}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Barra Empilhada Compacta: Votos restantes onde Cand 1 vs Cand 2 venceu no 1ºT */}
      <div
        data-testid="stacked-pending-bar-card"
        className="mt-3.5 shrink-0 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-[#1F1F24] dark:bg-[#0F0F12]"
      >
        <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            Onde estão os votos que faltam?
          </span>
          <span className="font-bold text-slate-900 dark:text-white">
            Total est. restante:{' '}
            <strong className="text-amber-600 dark:text-amber-400">
              {formatCompactNumber(pending.total_remaining_valid_votes)}
            </strong>{' '}
            votos
          </span>
        </div>

        <div
          className="mt-2 flex h-3.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="img"
          aria-label={`Divisão dos votos restantes: ${formatPct(pending.pct_remaining_in_cand1_1t_lead)} onde ${cand1.ballot_name} liderou, e ${formatPct(pending.pct_remaining_in_cand2_1t_lead)} onde ${cand2.ballot_name} liderou.`}
        >
          {pending.total_remaining_valid_votes > 0 ? (
            <>
              <div
                className={`h-full ${theme1.barClass} pattern-cand1-stripes transition-all duration-500`}
                style={{ width: `${pending.pct_remaining_in_cand1_1t_lead}%` }}
                title={`Onde ${cand1.ballot_name} liderou no 1ºT: ${formatCompactNumber(pending.remaining_in_cand1_1t_lead)} (${formatPct(pending.pct_remaining_in_cand1_1t_lead)})`}
              />
              <div
                className={`h-full ${theme2.barClass} pattern-cand2-dots transition-all duration-500`}
                style={{ width: `${pending.pct_remaining_in_cand2_1t_lead}%` }}
                title={`Onde ${cand2.ballot_name} liderou no 1ºT: ${formatCompactNumber(pending.remaining_in_cand2_1t_lead)} (${formatPct(pending.pct_remaining_in_cand2_1t_lead)})`}
              />
            </>
          ) : (
            <div className="h-full w-full bg-slate-400 dark:bg-slate-600" />
          )}
        </div>

        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div
            className={`flex flex-col items-center justify-center py-2 px-3 gap-0.5 text-center rounded-lg border ${theme1.borderClass} ${theme1.cardBgClass} w-full min-w-0`}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300">
              <span className={`h-2 w-2 shrink-0 rounded-full ${theme1.barClass}`} aria-hidden="true" />
              <span>Onde {formatOfficialCandidateName(cand1.ballot_name)} liderou no 1ºT</span>
            </div>
            <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tracking-tight font-mono">
              {formatCompactNumber(pending.remaining_in_cand1_1t_lead)} ({formatPct(pending.pct_remaining_in_cand1_1t_lead, 0)})
            </div>
          </div>

          <div
            className={`flex flex-col items-center justify-center py-2 px-3 gap-0.5 text-center rounded-lg border ${theme2.borderClass} ${theme2.cardBgClass} w-full min-w-0`}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300">
              <span className={`h-2 w-2 shrink-0 rounded-full ${theme2.barClass}`} aria-hidden="true" />
              <span>Onde {formatOfficialCandidateName(cand2.ballot_name)} liderou no 1ºT</span>
            </div>
            <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white tracking-tight font-mono">
              {formatCompactNumber(pending.remaining_in_cand2_1t_lead)} ({formatPct(pending.pct_remaining_in_cand2_1t_lead, 0)})
            </div>
          </div>
        </div>
      </div>

      {/* 3. Barra de Controles: Busca + Ordenação (visíveis apenas quando expandido) */}
      {isExpanded && (
        <div className="mt-3 shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5 dark:border-[#1F1F24]">
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  snapshot.cargo_code === '1' && !selectedPresUf
                    ? 'Buscar UF (ex.: SP, BA)...'
                    : 'Buscar município...'
                }
                aria-label="Filtrar localidade por nome ou sigla"
                className="w-40 sm:w-52 rounded-lg border border-slate-300 bg-white py-1 pl-8 pr-2.5 text-base sm:text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-600 focus:outline-none dark:border-[#1F1F24] dark:bg-[#0F0F12] dark:text-slate-100"
              />
            </div>

            {selectedPresUf && (
              <button
                type="button"
                onClick={() => {
                  setSelectedPresUf(null)
                  setPresMunList(null)
                }}
                className="rounded-lg border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                ← Voltar às UFs
              </button>
            )}
          </div>

          <button
            type="button"
            data-testid="toggle-pending-sort-btn"
            onClick={() =>
              setSortBy((prev) =>
                prev === 'remaining_votes'
                  ? 'pct_remaining'
                  : 'remaining_votes',
              )
            }
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-[#1F1F24] dark:bg-[#0F0F12] dark:text-slate-200"
          >
            <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
            <span>
              {sortBy === 'remaining_votes' ? 'Mais votos rest.' : '% urnas pend.'}
            </span>
          </button>
        </div>
      )}

      {/* 4. Lista de Cartões Visuais (Top 3 por padrão, todos com scroll quando expandido) */}
      <div
        className={`mt-2.5 space-y-1.5 pr-1 scrollbar-thin [scrollbar-width:thin] ${
          isExpanded ? 'max-h-[360px] overflow-y-auto' : ''
        }`}
        data-testid="pending-localities-table"
      >
        {selectedPresUf && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 dark:bg-[#0F0F12] dark:border dark:border-[#1F1F24] dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <StateFlag
                uf={selectedPresUf}
                className="w-5 h-3.5 rounded-xs object-cover ring-1 ring-black/10 dark:ring-white/15 shadow-2xs"
                alt={`Bandeira oficial de ${selectedPresUf}`}
              />
              Municípios de <strong>{selectedPresUf}</strong>
            </span>
            {loadingPresMun && <span className="text-[11px] animate-pulse">Carregando...</span>}
          </div>
        )}

        {visibleCards.map((loc) => {
          const isLead1 = loc.leader_1t_slot === 1
          const isLead2 = loc.leader_1t_slot === 2
          const pillClass = isLead1
            ? theme1.softPillClass
            : isLead2
              ? theme2.softPillClass
              : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'

          return (
            <div
              key={`${loc.uf}-${loc.code_tse}`}
              className="flex flex-col gap-1.5 rounded-xl border border-slate-200/90 bg-slate-50/70 p-2 transition hover:bg-slate-50 dark:border-[#1F1F24] dark:bg-[#0F0F12]/80 dark:hover:bg-[#0F0F12]"
            >
              {/* Linha Superior: Bandeira + Nome legível ("São Paulo • SP") + Badge de Liderança */}
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <StateFlag
                    uf={loc.uf}
                    className="w-6 h-4 shrink-0 rounded object-cover ring-1 ring-black/10 dark:ring-white/15 shadow-2xs"
                    alt={`Bandeira oficial de ${loc.name} (${loc.uf})`}
                  />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      className="text-xs font-bold text-slate-900 dark:text-white truncate"
                      title={`${loc.name} • ${loc.uf}`}
                    >
                      {loc.name} <span className="font-normal text-slate-400">• {loc.uf}</span>
                    </span>
                    {loc.low_reliability && (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1 py-0.2 text-[9px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-300"
                        title="Menos de 30% das urnas apuradas"
                      >
                        &lt;30%
                      </span>
                    )}
                  </div>
                  {snapshot.cargo_code === '1' &&
                    loc.scope_type === 'uf' &&
                    loc.code_tse.toLowerCase() !== 'zz' && (
                      <button
                        type="button"
                        onClick={() => void handleDrillDownPresUf(loc.code_tse)}
                        className="shrink-0 inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        title={`Ver municípios de ${loc.name}`}
                      >
                        Cidades
                        <ChevronRight className="h-2.5 w-2.5" aria-hidden="true" />
                      </button>
                    )}
                </div>

                {/* Badge de Liderança no 1º Turno */}
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${pillClass}`}
                  title={`Líder no 1º turno: ${loc.leader_1t_name.replace(/\bFLAVIO\b/g, 'FLÁVIO')} com margem de ${formatPP(loc.margin_1t_pp)}`}
                >
                  <span className="whitespace-nowrap font-bold">
                    {loc.leader_1t_slot === 1
                      ? (cand1.ballot_name.includes('LULA') ? 'LULA' : cand1.ballot_name)
                      : loc.leader_1t_slot === 2
                        ? (cand2.ballot_name.toUpperCase().includes('FLAVIO') || cand2.ballot_name.toUpperCase().includes('FLÁVIO') ? 'FLÁVIO' : cand2.ballot_name)
                        : loc.leader_1t_name.replace(/\bFLAVIO\b/g, 'FLÁVIO')}
                  </span>
                  <span className="opacity-80">+{formatPP(loc.margin_1t_pp)}</span>
                </span>
              </div>

              {/* Linha Intermediária: Apurado à esquerda vs Votos Pendentes à direita */}
              <div className="flex items-center justify-between gap-2 text-[11px] min-w-0">
                <span className="truncate text-slate-600 dark:text-slate-400">
                  <strong className="font-mono text-slate-800 dark:text-slate-200">
                    {formatPct(loc.pct_counted, 1)}
                  </strong>{' '}
                  apurado
                </span>
                <span className="shrink-0 font-extrabold text-slate-900 dark:text-white">
                  Faltam {formatCompactNumber(loc.estimated_remaining_valid_votes)} votos
                </span>
              </div>

              {/* Barra de Progresso da Localidade em largura total */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, loc.pct_counted))}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* 5. Botão de Expandir / Colapsar Lista */}
      <div className="mt-3 pt-2.5 border-t border-slate-200/80 flex justify-end dark:border-[#1F1F24]">
        <button
          type="button"
          data-testid="toggle-pending-expand-btn"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <span>{isExpanded ? 'Ver menos' : `Ver todos (${filteredLocalities.length})`}</span>
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </section>
  )
}
