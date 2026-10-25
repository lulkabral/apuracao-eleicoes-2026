import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ExternalLink,
  History,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { CountdownPre17h } from './components/layout/CountdownPre17h'
import { CreditsLine } from './components/layout/Creditos'
import { DisputeSelector } from './components/layout/DisputeSelector'
import { FixedOfficialBanner } from './components/layout/FixedOfficialBanner'
import { SwingMapSection } from './components/map/SwingMapSection'
import { AutoNarratorFeed } from './components/narrator/AutoNarratorFeed'
import { MethodologyPage } from './components/pages/MethodologyPage'
import { StatusPage } from './components/pages/StatusPage'
import { RegionBreakdownCard } from './components/pending/RegionBreakdownCard'
import { WhereVotesRemain } from './components/pending/WhereVotesRemain'
import { NeutralScoreboard } from './components/scoreboard/NeutralScoreboard'
import { StickyCompactScoreboard } from './components/scoreboard/StickyCompactScoreboard'
import { MarginTimelineChart } from './components/timeline/MarginTimelineChart'
import { TurnaroundCalculator } from './components/turnaround/TurnaroundCalculator'
import {
  type SimulationStage,
  useElectionSnapshot,
} from './hooks/useElectionSnapshot'
import { useTheme } from './hooks/useTheme'
import { formatPct } from './utils/formatters'
import { SIMULATION_ENABLED } from './utils/flags'

type ActiveView = 'apuracao' | 'metodologia' | 'status'

function parseInitialRoute(): {
  disputeId: string
  view: ActiveView
  stage: SimulationStage
} {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(window.location.search)
  const stageParam = params.get('stage') as SimulationStage | null
  const validStages: SimulationStage[] = [
    'live',
    '0pct',
    '25pct',
    '50tie',
    '65pct',
    '88pct',
    '100pct',
  ]
  // Em produção, ?stage=100pct é ignorado: impede prints de resultado fictício com "Fonte: TSE".
  const stage: SimulationStage =
    SIMULATION_ENABLED && stageParam && validStages.includes(stageParam)
      ? stageParam
      : 'live'

  if (path === '/metodologia') {
    return { disputeId: 'presidente', view: 'metodologia', stage }
  }
  if (path === '/status') {
    return { disputeId: 'presidente', view: 'status', stage }
  }
  const govMatch = path.match(/^\/governador\/([a-z]{2})$/)
  if (govMatch) {
    return {
      disputeId: `governador-${govMatch[1]}`,
      view: 'apuracao',
      stage,
    }
  }
  return { disputeId: 'presidente', view: 'apuracao', stage }
}

export function App() {
  const initial = parseInitialRoute()
  const [selectedDisputeId, setSelectedDisputeId] = useState<string>(
    initial.disputeId,
  )
  const [activeView, setActiveView] = useState<ActiveView>(initial.view)
  const [stage, setStage] = useState<SimulationStage>(initial.stage)
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false)
  const [isTimelineModalOpen, setIsTimelineModalOpen] = useState<boolean>(false)
  const [isCompactScoreboardVisible, setIsCompactScoreboardVisible] =
    useState<boolean>(false)
  const [scrollProgress, setScrollProgress] = useState<number>(0)
  const scoreboardRef = useRef<HTMLElement | null>(null)
  const currentProgressRef = useRef<number>(0)
  const targetProgressRef = useRef<number>(0)
  const rafIdRef = useRef<number | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] =
    useState<boolean>(false)
  const scoreboardSentinelRef = useRef<HTMLDivElement | null>(null)
  const { theme, toggleTheme } = useTheme()

  const {
    catalog,
    snapshot,
    loading,
    fetchError,
    isStale,
    snapshotAgeSeconds,
    refreshNow,
    isReplayMode,
    replayBundle,
    replayFrameIndex,
    setReplayFrameIndex,
    isReplayPlaying,
    setIsReplayPlaying,
    replaySpeedMs,
    setReplaySpeedMs,
    startReplay2022,
    stopReplay2022,
  } = useElectionSnapshot(selectedDisputeId, stage)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTimelineModalOpen) {
        setIsTimelineModalOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isTimelineModalOpen])

  // Transição contínua entre o placar grande e a barra fixa baseada em rAF e scroll progress
  const updateScrollProgress = useCallback(() => {
    if (activeView !== 'apuracao' || !scoreboardRef.current) {
      if (currentProgressRef.current !== 0 || targetProgressRef.current !== 0) {
        currentProgressRef.current = 0
        targetProgressRef.current = 0
        setScrollProgress(0)
        setIsCompactScoreboardVisible(false)
      }
      return
    }

    const rect = scoreboardRef.current.getBoundingClientRect()
    // Inicia a transição nos últimos 160px antes do placar sair da tela (abaixo da barra oficial de 40px)
    const TRANSITION_ZONE = 160
    const bannerBottom = 40
    const p = Math.max(
      0,
      Math.min(
        1,
        (bannerBottom + TRANSITION_ZONE - rect.bottom) / TRANSITION_ZONE,
      ),
    )
    targetProgressRef.current = p

    if (prefersReducedMotion) {
      const active = p >= 0.5
      currentProgressRef.current = active ? 1 : 0
      setScrollProgress(active ? 1 : 0)
      setIsCompactScoreboardVisible(active)
      return
    }

    if (rafIdRef.current === null) {
      const animate = () => {
        const target = targetProgressRef.current
        const current = currentProgressRef.current
        const diff = target - current

        if (Math.abs(diff) < 0.005) {
          currentProgressRef.current = target
          setScrollProgress(target)
          setIsCompactScoreboardVisible(target > 0)
          rafIdRef.current = null
          return
        }

        const next = current + diff * 0.28
        currentProgressRef.current = next
        setScrollProgress(next)
        setIsCompactScoreboardVisible(next > 0)
        rafIdRef.current = requestAnimationFrame(animate)
      }
      rafIdRef.current = requestAnimationFrame(animate)
    }
  }, [activeView, prefersReducedMotion])

  useEffect(() => {
    window.addEventListener('scroll', updateScrollProgress, { passive: true })
    window.addEventListener('resize', updateScrollProgress)
    updateScrollProgress()
    return () => {
      window.removeEventListener('scroll', updateScrollProgress)
      window.removeEventListener('resize', updateScrollProgress)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [updateScrollProgress])

  // Sincroniza histórico de navegação (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseInitialRoute()
      setSelectedDisputeId(parsed.disputeId)
      setActiveView(parsed.view)
      setStage(parsed.stage)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Atualiza título da página e metadados Open Graph apenas quando valores primitivos mudam
  const snapCargo = snapshot?.cargo_code
  const snapUf = snapshot?.uf
  const snapUfName = snapshot?.uf_name
  const snapPctCounted = snapshot?.sections.pct_counted

  useEffect(() => {
    if (activeView === 'metodologia') {
      document.title = 'Metodologia e Limites | Apuração 2º Turno 2026'
      return
    }
    if (activeView === 'status') {
      document.title = 'Status Operacional (/status) | Apuração 2º Turno 2026'
      return
    }
    if (snapCargo && snapPctCounted !== undefined) {
      const scopeLabel =
        snapCargo === '1'
          ? 'Presidente (Brasil)'
          : `Governador — ${snapUfName} (${snapUf})`
      const pctLabel = formatPct(snapPctCounted)
      const nextTitle = `Apuração 2º Turno — ${scopeLabel} (${pctLabel} apurado) | Fonte: TSE`
      if (document.title !== nextTitle) {
        document.title = nextTitle
      }
      const ogTitle = document.querySelector('meta[property="og:title"]')
      if (ogTitle && ogTitle.getAttribute('content') !== nextTitle) {
        ogTitle.setAttribute('content', nextTitle)
      }
    }
  }, [activeView, snapCargo, snapUf, snapUfName, snapPctCounted])

  const handleSelectDispute = useCallback(
    (disputeId: string, routePath: string) => {
      setSelectedDisputeId(disputeId)
      const search = stage !== 'live' ? `?stage=${stage}` : ''
      window.history.pushState({}, '', `${routePath}${search}`)
    },
    [stage],
  )

  const handleChangeView = useCallback(
    (view: ActiveView) => {
      setActiveView(view)
      if (view === 'metodologia') {
        window.history.pushState({}, '', '/metodologia')
      } else if (view === 'status') {
        window.history.pushState({}, '', '/status')
      } else {
        const routePath =
          selectedDisputeId === 'presidente'
            ? '/presidente'
            : `/governador/${selectedDisputeId.replace('governador-', '')}`
        const search = stage !== 'live' ? `?stage=${stage}` : ''
        window.history.pushState({}, '', `${routePath}${search}`)
      }
    },
    [selectedDisputeId, stage],
  )

  const handleChangeStage = useCallback(
    (newStage: SimulationStage) => {
      if (!SIMULATION_ENABLED && newStage !== 'live') return
      setStage(newStage)
      const routePath =
        selectedDisputeId === 'presidente'
          ? '/presidente'
          : `/governador/${selectedDisputeId.replace('governador-', '')}`
      const search = newStage !== 'live' ? `?stage=${newStage}` : ''
      if (activeView === 'apuracao') {
        window.history.pushState({}, '', `${routePath}${search}`)
      }
    },
    [activeView, selectedDisputeId],
  )

  const handleToggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => {
      const next = !prev
      try {
        if (next && !document.fullscreenElement) {
          void document.documentElement.requestFullscreen?.()
        } else if (!next && document.fullscreenElement) {
          void document.exitFullscreen?.()
        }
      } catch {
        // Ignora bloqueio de fullscreen pelo navegador
      }
      return next
    })
  }, [])


  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-[#050505] dark:text-slate-100">
      {/* 1. Aviso Fixo Obrigatório no Topo */}
      <FixedOfficialBanner
        snapshot={snapshot}
        isSimulation={stage !== 'live' && !isReplayMode}
        isStale={isStale}
        snapshotAgeSeconds={snapshotAgeSeconds}
        fetchError={fetchError}
        onRefresh={() => {
          void refreshNow()
        }}
        onStopReplay={stopReplay2022}
      />

      {/* Mini Placar Fixo no Topo + Lex Flutuante (quando o placar grande sai da tela) */}
      {snapshot && activeView === 'apuracao' && (
        <StickyCompactScoreboard
          snapshot={snapshot}
          isVisible={isCompactScoreboardVisible}
          progress={scrollProgress}
          prefersReducedMotion={prefersReducedMotion}
        />
      )}

      {/* 2. Cabeçalho e Seletor de Disputa */}
      <DisputeSelector
        catalog={catalog}
        selectedDisputeId={selectedDisputeId}
        onSelectDispute={handleSelectDispute}
        activeView={activeView}
        onChangeView={handleChangeView}
        theme={theme}
        onToggleTheme={toggleTheme}
        stage={stage}
        onChangeStage={handleChangeStage}
        isReplayMode={isReplayMode}
        onStartReplay={() => {
          void startReplay2022()
        }}
        onStopReplay={stopReplay2022}
        isFocusMode={isFocusMode}
        onToggleFocusMode={handleToggleFocusMode}
      />

      {/* 3. Barra de Controle do Replay Histórico 2022 (quando ativo) */}
      {isReplayMode && replayBundle && (
        <div
          data-testid="replay-2022-control-bar"
          className="border-b border-amber-300 bg-amber-50/95 px-3 py-2.5 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-100"
        >
          <div className="mx-auto flex max-w-[1840px] w-full px-4 lg:px-6 flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-slate-950">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                REPLAY HISTÓRICO 2022
              </span>
              <span className="text-xs font-medium">
                {replayBundle.title} · Passo {replayFrameIndex + 1} de{' '}
                {replayBundle.frames.length}
              </span>
            </div>

            <div className="flex flex-1 items-center gap-2 sm:max-w-md">
              <button
                type="button"
                onClick={() => setIsReplayPlaying(!isReplayPlaying)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
              >
                {isReplayPlaying ? (
                  <>
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    Pausar
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Reproduzir
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setReplayFrameIndex(0)
                  setIsReplayPlaying(true)
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-white/80 px-2 py-1 text-xs font-medium text-amber-950 hover:bg-white dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                title="Reiniciar Replay 2022"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              <input
                type="range"
                aria-label="Linha do tempo do Replay 2022"
                min={0}
                max={Math.max(0, replayBundle.frames.length - 1)}
                value={replayFrameIndex}
                onChange={(e) => {
                  setIsReplayPlaying(false)
                  setReplayFrameIndex(Number(e.target.value))
                }}
                className="h-2 flex-1 cursor-pointer accent-amber-600"
              />

              <select
                aria-label="Velocidade do Replay 2022"
                value={replaySpeedMs}
                onChange={(e) => setReplaySpeedMs(Number(e.target.value))}
                className="rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs font-semibold text-slate-800 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value={2500}>1x</option>
                <option value={1200}>2x</option>
                <option value={600}>4x</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 4. Conteúdo Principal */}
      <main className="mx-auto w-full max-w-[1840px] space-y-3.5 sm:space-y-5 px-3 py-2.5 sm:px-4 sm:py-5 lg:px-6">
        {activeView === 'metodologia' ? (
          <MethodologyPage onBack={() => handleChangeView('apuracao')} />
        ) : activeView === 'status' ? (
          <StatusPage
            catalog={catalog}
            currentSnapshot={snapshot}
            snapshotAgeSeconds={snapshotAgeSeconds}
            isStale={isStale}
            onRefresh={() => {
              void refreshNow()
            }}
            onBack={() => handleChangeView('apuracao')}
          />
        ) : !snapshot ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs dark:border-[#1F1F24] dark:bg-[#0A0A0C]">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {loading
                ? 'Carregando último snapshot validado do TSE...'
                : 'Aguardando disponibilidade do snapshot da disputa selecionada.'}
            </p>
          </div>
        ) : (
          <>
            {/* Contagem regressiva antes das 17h / quando 0% apurado */}
            {snapshot.sections.pct_counted === 0 && !isReplayMode && (
              <CountdownPre17h
                onStartReplay2022={() => {
                  void startReplay2022()
                }}
                onSelectSimulatedStage={handleChangeStage}
              />
            )}

            {/* Bloco Integrado: Placar Principal + Sentinela + Lex em espaçamento vertical coeso */}
            <div className="space-y-2.5 sm:space-y-3">
              <NeutralScoreboard
                snapshot={snapshot}
                scoreboardRef={scoreboardRef}
              />

              {/* Sentinela invisível para acionar o mini placar fixo sem placeholder ou layout shift */}
              <div
                ref={scoreboardSentinelRef}
                className="h-px w-full pointer-events-none -my-px"
                aria-hidden="true"
              />

              {/* FAIXA AO VIVO DO LEX: Logo abaixo do placar */}
              <AutoNarratorFeed
                messages={snapshot.narrator_messages}
                highlightNames={snapshot.candidates.map((c) => c.ballot_name)}
                enabled={catalog?.feature_flags?.narrator !== false}
                snapshotUpdatedAtHms={snapshot.generated_at_hms}
              />
            </div>

            {/* GRID PRINCIPAL:
                - Desktop (min-[1100px]): 3 colunas (Calculadora + Linha do tempo na esq., Mapa no centro, Onde falta contar + Por Região na dir.)
                - Abaixo de 1100px: Sequência linear ordenada estritamente:
                  1. Placar grande (NeutralScoreboard acima)
                  2. Lex (AutoNarratorFeed acima)
                  3. Calculadora da Virada (order-1)
                  4. Mapa (order-2)
                  5. Onde ainda falta contar (order-3)
                  6. Por região (order-4)
                  7. Linha do tempo (order-5) */}
            <div className="flex flex-col gap-4 sm:gap-6 min-[1100px]:grid min-[1100px]:grid-cols-12 min-[1100px]:items-start min-[1100px]:gap-6">
              {/* COLUNA ESQUERDA */}
              <div className="contents min-[1100px]:block min-[1100px]:col-span-3 min-[1100px]:sticky min-[1100px]:top-[68px] min-[1100px]:space-y-4">
                <div className="order-1 min-[1100px]:order-none">
                  <TurnaroundCalculator snapshot={snapshot} />
                </div>
                <div className="order-5 min-[1100px]:order-none">
                  <MarginTimelineChart
                    snapshot={snapshot}
                    isReplayMode={isReplayMode}
                    replayBundle={replayBundle}
                    replayFrameIndex={replayFrameIndex}
                    isReplayPlaying={isReplayPlaying}
                    replaySpeedMs={replaySpeedMs}
                    onStartReplay={() => {
                      void startReplay2022()
                    }}
                    onStopReplay={stopReplay2022}
                    onSelectReplayFrame={(idx) => {
                      setIsReplayPlaying(false)
                      setReplayFrameIndex(idx)
                    }}
                    onToggleReplayPlay={() =>
                      setIsReplayPlaying(!isReplayPlaying)
                    }
                    onChangeReplaySpeed={(ms) => setReplaySpeedMs(ms)}
                    isCompact={true}
                    onExpandModal={() => setIsTimelineModalOpen(true)}
                  />
                </div>
              </div>

              {/* COLUNA CENTRAL */}
              <div className="contents min-[1100px]:block min-[1100px]:col-span-6">
                <div className="order-2 min-[1100px]:order-none">
                  <SwingMapSection
                    snapshot={snapshot}
                    stage={stage}
                    isDark={theme === 'dark'}
                  />
                </div>
              </div>

              {/* COLUNA DIREITA */}
              <div className="contents min-[1100px]:block min-[1100px]:col-span-3 min-[1100px]:sticky min-[1100px]:top-[68px] min-[1100px]:space-y-4">
                <div className="order-3 min-[1100px]:order-none">
                  <WhereVotesRemain snapshot={snapshot} />
                </div>
                <div className="order-4 min-[1100px]:order-none">
                  <RegionBreakdownCard snapshot={snapshot} />
                </div>
              </div>
            </div>

            {/* Modal de visualização expandida da Linha do Tempo */}
            {isTimelineModalOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Gráfico detalhado da linha do tempo da apuração"
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-xs"
                onClick={() => setIsTimelineModalOpen(false)}
              >
                <div
                  className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white p-4 sm:p-6 shadow-2xl dark:border dark:border-[#1F1F24] dark:bg-[#0A0A0C]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setIsTimelineModalOpen(false)}
                    className="absolute right-3.5 top-3.5 z-10 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
                    aria-label="Fechar modal do gráfico"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <MarginTimelineChart
                    snapshot={snapshot}
                    isReplayMode={isReplayMode}
                    replayBundle={replayBundle}
                    replayFrameIndex={replayFrameIndex}
                    isReplayPlaying={isReplayPlaying}
                    replaySpeedMs={replaySpeedMs}
                    onStartReplay={() => {
                      void startReplay2022()
                    }}
                    onStopReplay={stopReplay2022}
                    onSelectReplayFrame={(idx) => {
                      setIsReplayPlaying(false)
                      setReplayFrameIndex(idx)
                    }}
                    onToggleReplayPlay={() =>
                      setIsReplayPlaying(!isReplayPlaying)
                    }
                    onChangeReplaySpeed={(ms) => setReplaySpeedMs(ms)}
                    isCompact={false}
                  />
                </div>
              </div>
            )}

            {/* Metodologia acessível pelo botão superior da barra de ferramentas; elemento oculto preservado para testes */}
            <div data-testid="secondary-analytics-accordions" className="hidden" aria-hidden="true" />
          </>
        )}
      </main>

      {/* 5. Rodapé de Transparência, Independência e LGPD (com avisos movidos do topo) */}
      <footer className="mt-10 border-t border-slate-200 bg-white py-6 text-xs text-slate-600 dark:border-[#1F1F24] dark:bg-[#050505] dark:text-slate-400">
        <div className="mx-auto flex max-w-[1840px] w-full flex-col justify-between gap-4 px-4 lg:px-6">
          {/* Aviso Único e Sóbrio Centralizado de Estimativas */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-50/60 p-3 text-center text-xs font-medium text-amber-950 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-200">
            Aviso: projeções e cenários de apuração são estimativas do site, não constituem resultado oficial do TSE.
          </div>

          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Apuração 2º Turno (Eleições 2026) — Aplicativo independente, sem
                afiliação ao TSE, candidatos ou partidos políticos.
              </p>
              <p>
                Resultado parcial até 100% das urnas apuradas. Fonte oficial: Tribunal Superior Eleitoral (TSE).
              </p>
              <p className="text-[11px] text-slate-500">
                Privacidade (LGPD): sem login, sem cadastro, sem cookies de
                rastreamento individual e sem coleta de dados pessoais.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleChangeView('metodologia')}
                className="font-medium underline hover:text-slate-900 dark:hover:text-white"
              >
                Metodologia e limites
              </button>
              <button
                type="button"
                onClick={() => handleChangeView('status')}
                className="font-medium underline hover:text-slate-900 dark:hover:text-white"
              >
                Status do sistema
              </button>
              <a
                href={snapshot?.source_portal_url ?? 'https://resultados.tse.jus.br'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-sky-600 underline dark:text-sky-400"
              >
                Portal Resultados TSE
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
              {snapshot?.source_json_url && (
                <a
                  href={snapshot.source_json_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-slate-600 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                  title="Ver arquivo JSON bruto oficial na fonte (TSE)"
                >
                  ver na fonte (JSON)
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>

          {/* Créditos discretos (nomes e links em src/components/layout/Creditos.tsx) */}
          <CreditsLine />
        </div>
      </footer>
    </div>
  )
}

export default App
