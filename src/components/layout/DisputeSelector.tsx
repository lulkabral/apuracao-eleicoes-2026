import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  BookOpen,
  Check,
  ChevronDown,
  History,
  Maximize2,
  Minimize2,
  Moon,
  MoreHorizontal,
  Share2,
  SlidersHorizontal,
  Sun,
} from 'lucide-react'
import type {
  DisputeCatalogItem,
  ElectionCatalogSnapshot,
} from '../../types/election'
import type { SimulationStage } from '../../hooks/useElectionSnapshot'
import { SIMULATION_ENABLED } from '../../utils/flags'
import type { ThemeMode } from '../../hooks/useTheme'
import { StateFlag } from '../common/StateFlag'
import { getDisputePairThemes } from '../../utils/candidatePalette'
import { formatPct } from '../../utils/formatters'

interface DisputeSelectorProps {
  catalog: ElectionCatalogSnapshot | null
  selectedDisputeId: string
  onSelectDispute: (disputeId: string, routePath: string) => void
  activeView: 'apuracao' | 'metodologia' | 'status'
  onChangeView: (view: 'apuracao' | 'metodologia' | 'status') => void
  theme: ThemeMode
  onToggleTheme: () => void
  stage: SimulationStage
  onChangeStage: (stage: SimulationStage) => void
  isReplayMode: boolean
  onStartReplay: () => void
  onStopReplay: () => void
  isFocusMode?: boolean
  onToggleFocusMode?: () => void
}

// 'live' é o dado real do TSE — nunca rotular como "65% (Padrão)".
const STAGE_OPTIONS: { id: SimulationStage; label: string }[] = [
  { id: 'live', label: 'Ao vivo (TSE)' },
  { id: '0pct', label: '0%' },
  { id: '25pct', label: '25%' },
  { id: '50tie', label: '50%' },
  { id: '65pct', label: '65%' },
  { id: '88pct', label: '88%' },
  { id: '100pct', label: '100%' },
]

export function DisputeSelector({
  catalog,
  selectedDisputeId,
  onSelectDispute,
  activeView,
  onChangeView,
  theme,
  onToggleTheme,
  stage,
  onChangeStage,
  isReplayMode,
  onStartReplay,
  onStopReplay,
  isFocusMode = false,
  onToggleFocusMode,
}: DisputeSelectorProps) {
  const [copiedShare, setCopiedShare] = useState(false)
  const [isSimulationOpen, setIsSimulationOpen] = useState(false)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)
  const [isGovDropdownOpen, setIsGovDropdownOpen] = useState(false)

  const govDropdownRef = useRef<HTMLDivElement | null>(null)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        govDropdownRef.current &&
        !govDropdownRef.current.contains(e.target as Node)
      ) {
        setIsGovDropdownOpen(false)
      }
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setIsMoreMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsGovDropdownOpen(false)
        setIsMoreMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Sem catálogo ainda: não inventa percentuais. As abas aparecem quando o poller publicar.
  const disputes: DisputeCatalogItem[] = catalog?.disputes ?? []

  const currentDispute: DisputeCatalogItem | undefined =
    disputes.find((d) => d.dispute_id === selectedDisputeId) ?? disputes[0]
  const presDispute = disputes.find((d) => d.cargo_code === '1') ?? disputes[0]
  const govDisputes = disputes.filter((d) => d.cargo_code !== '1')
  // Sem catálogo (C3), currentDispute/presDispute são undefined: nada de abas, sem quebrar a tela.
  const isGovSelected =
    currentDispute !== undefined && currentDispute.cargo_code !== '1'

  const handleShare = async () => {
    if (!currentDispute) return
    const shareUrl = `${window.location.origin}${currentDispute.route_path}`
    const shareTitle = `Apuração 2º Turno 2026 — ${
      currentDispute.cargo_code === '1'
        ? 'Presidente (Brasil)'
        : `Governador (${currentDispute.uf})`
    }`
    const shareText = `Acompanhe o que ainda pode mudar na apuração para ${
      currentDispute.cargo_code === '1'
        ? 'Presidente'
        : `Governador (${currentDispute.uf})`
    }: ${shareUrl}`

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        })
        return
      } catch {
        // Fallback para cópia
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopiedShare(true)
      window.setTimeout(() => setCopiedShare(false), 2500)
    } catch {
      // Ignora erro de clipboard
    }
  }

  return (
    <div className="relative z-50 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-[#1F1F24] dark:bg-[#0A0A0C]/95">
      <div className="mx-auto w-full max-w-[1840px] px-3 py-2 sm:px-4 sm:py-2.5 lg:px-6">
        {/* Linha superior limpa: Título do App + Ações Essenciais */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChangeView('apuracao')}
            className="flex items-center gap-1.5 text-left focus:outline-none"
          >
            <h1 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base dark:text-white">
              Apuração 2º Turno{' '}
              <span className="rounded bg-slate-100 px-1 py-0.2 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                2026
              </span>
            </h1>
          </button>

          {/* Barra de Ações: Compartilhar, Modo Foco, Tema e Menu "⋯ Mais" */}
          <div className="flex items-center gap-1">
            {onToggleFocusMode && (
              <button
                type="button"
                onClick={onToggleFocusMode}
                data-testid="focus-mode-button"
                aria-pressed={isFocusMode}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                  isFocusMode
                    ? 'border-blue-600 bg-blue-600 text-white shadow-xs dark:border-blue-500 dark:bg-blue-500'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
                title="Alternar Modo Foco / Tela Cheia"
              >
                {isFocusMode ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Sair Foco</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Modo Foco</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleShare}
              data-testid="share-dispute-button"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="Compartilhar esta disputa"
              aria-label="Compartilhar link desta disputa"
            >
              {copiedShare ? (
                <>
                  <Check
                    className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">Copiado!</span>
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Compartilhar</span>
                </>
              )}
            </button>

            {/* Menu Dropdown "⋯ Mais" agrupando Metodologia, Status e Simulação */}
            <div ref={moreMenuRef} className="relative">
              <button
                type="button"
                data-testid="more-menu-button"
                onClick={() => setIsMoreMenuOpen((p) => !p)}
                aria-expanded={isMoreMenuOpen}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition ${
                  isMoreMenuOpen || activeView !== 'apuracao' || stage !== 'live'
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
                title="Menu de opções adicionais"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mais</span>
              </button>

              {isMoreMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-[#1F1F24] dark:bg-[#0A0A0C]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false)
                      onChangeView(
                        activeView === 'metodologia' ? 'apuracao' : 'metodologia',
                      )
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Metodologia</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false)
                      onChangeView(activeView === 'status' ? 'apuracao' : 'status')
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Status</span>
                  </button>
                  {/* Simulação: só em builds com VITE_ENABLE_SIMULATION=true (correção C2) */}
                  {SIMULATION_ENABLED && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false)
                        setIsSimulationOpen((prev) => !prev)
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Simulação</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onToggleTheme}
              data-testid="theme-toggle-button"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white p-1 text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              aria-label={
                theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'
              }
              title={
                theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'
              }
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-slate-700" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Seletor de Cargos: Presidente (BR) + Governadores ▾ */}
        <nav
          aria-label="Seletor de disputa (Presidente e Governadores em 2º turno)"
          className="mt-2 flex items-center gap-2"
        >
          {/* Aba Presidente (BR) */}
          {presDispute && (() => {
            const isSelected =
              presDispute.dispute_id === selectedDisputeId && !isReplayMode
            const [t1, t2] = getDisputePairThemes(
              { number: presDispute.cand1_number, ballot_name: presDispute.cand1_name },
              { number: presDispute.cand2_number, ballot_name: presDispute.cand2_name },
            )
            return (
              <button
                key={presDispute.dispute_id}
                type="button"
                data-testid={`dispute-tab-${presDispute.dispute_id}`}
                aria-pressed={isSelected}
                onClick={() => {
                  if (isReplayMode) onStopReplay()
                  onChangeView('apuracao')
                  onSelectDispute(presDispute.dispute_id, presDispute.route_path)
                }}
                className={`group flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition focus:outline-none focus:ring-1 focus:ring-slate-500 ${
                  isSelected
                    ? 'border-slate-900 bg-slate-900 text-white shadow-xs dark:border-white dark:bg-white dark:text-slate-950'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <StateFlag
                  uf="BR"
                  className="w-4 h-3 rounded-xs object-cover ring-1 ring-black/10 dark:ring-white/15 shadow-2xs"
                  alt="Brasil"
                />
                <span className="flex items-center gap-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${t1.dotClass}`} />
                  <span className={`h-1.5 w-1.5 rounded-full ${t2.dotClass}`} />
                </span>
                <span>Presidente (BR)</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-medium ${
                    isSelected
                      ? 'bg-slate-700 text-slate-100 dark:bg-slate-200 dark:text-slate-900'
                      : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {formatPct(presDispute.pct_counted, 0)}
                </span>
              </button>
            )
          })()}

          {/* Seletor Governadores ▾ com Lista Completa */}
          {govDisputes.length > 0 && (
            <div ref={govDropdownRef} className="relative">
              <button
                type="button"
                data-testid="governors-dropdown-btn"
                onClick={() => setIsGovDropdownOpen((p) => !p)}
                aria-expanded={isGovDropdownOpen}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition ${
                  isGovSelected && !isReplayMode
                    ? 'border-slate-900 bg-slate-900 text-white shadow-xs dark:border-white dark:bg-white dark:text-slate-950'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {isGovSelected ? (
                  <>
                    <StateFlag
                      uf={currentDispute.uf}
                      className="w-4 h-3 rounded-xs object-cover ring-1 ring-black/10 dark:ring-white/15 shadow-2xs"
                      alt={currentDispute.uf_name}
                    />
                    <span>Gov. {currentDispute.uf}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-medium ${
                        !isReplayMode
                          ? 'bg-slate-700 text-slate-100 dark:bg-slate-200 dark:text-slate-900'
                          : 'bg-slate-200/80 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {formatPct(currentDispute.pct_counted, 0)}
                    </span>
                  </>
                ) : (
                  <span>Governadores ({govDisputes.length})</span>
                )}
                <ChevronDown className="h-3 w-3 opacity-75" />
              </button>

              {isGovDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 z-50 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-[#1F1F24] dark:bg-[#0A0A0C]">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    2º Turno para Governador
                  </div>
                  {govDisputes.map((item) => {
                    const isSelected =
                      item.dispute_id === selectedDisputeId && !isReplayMode
                    const [t1, t2] = getDisputePairThemes(
                      { number: item.cand1_number, ballot_name: item.cand1_name },
                      { number: item.cand2_number, ballot_name: item.cand2_name },
                    )
                    return (
                      <button
                        key={item.dispute_id}
                        type="button"
                        data-testid={`dispute-tab-${item.dispute_id}`}
                        onClick={() => {
                          setIsGovDropdownOpen(false)
                          if (isReplayMode) onStopReplay()
                          onChangeView('apuracao')
                          onSelectDispute(item.dispute_id, item.route_path)
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          isSelected
                            ? 'bg-slate-100 font-bold text-slate-950 dark:bg-slate-800 dark:text-white'
                            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <StateFlag
                            uf={item.uf}
                            className="w-4 h-3 rounded-xs object-cover ring-1 ring-black/10 dark:ring-white/15 shadow-2xs"
                            alt={item.uf_name}
                          />
                          <span>
                            {item.uf_name} ({item.uf})
                          </span>
                          <span className="flex items-center gap-0.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${t1.dotClass}`} />
                            <span className={`h-1.5 w-1.5 rounded-full ${t2.dotClass}`} />
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {formatPct(item.pct_counted, 0)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Painel Recolhível de Estágios de Simulação (0% -> 100% e Replay 2022) */}
        {(isSimulationOpen || isReplayMode) && !isFocusMode && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/80 bg-amber-50/80 p-2 text-xs dark:border-amber-900/60 dark:bg-amber-950/30">
            <div className="flex flex-wrap items-center gap-1">
              {SIMULATION_ENABLED && (
                <span className="mr-1 text-[11px] font-semibold text-amber-900 dark:text-amber-300">
                  Simular estágio:
                </span>
              )}
              {(SIMULATION_ENABLED ? STAGE_OPTIONS : []).map((opt) => {
                const active = !isReplayMode && stage === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`stage-btn-${opt.id}`}
                    onClick={() => {
                      if (isReplayMode) onStopReplay()
                      onChangeStage(opt.id)
                    }}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? 'bg-amber-600 text-white font-bold dark:bg-amber-400 dark:text-slate-950'
                        : 'text-amber-950 hover:bg-amber-200/60 dark:text-amber-200 dark:hover:bg-amber-900/50'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {catalog?.feature_flags?.replay !== false && (
              <button
                type="button"
                data-testid="toggle-replay-2022-btn"
                onClick={() => {
                  if (isReplayMode) {
                    onStopReplay()
                  } else {
                    onChangeView('apuracao')
                    onStartReplay()
                  }
                }}
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold transition ${
                  isReplayMode
                    ? 'border-amber-600 bg-amber-600 text-white dark:bg-amber-400 dark:text-slate-950'
                    : 'border-amber-400 bg-white text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800'
                }`}
              >
                <History className="h-3 w-3" aria-hidden="true" />
                {isReplayMode ? 'Sair do Replay' : 'Replay 2022'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
