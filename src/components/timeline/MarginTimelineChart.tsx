import { useEffect, useRef, useState } from 'react'
import {
  Clock,
  History,
  Info,
  LineChart,
  Maximize2,
  Pause,
  Percent,
  Play,
  Radio,
  RotateCcw,
} from 'lucide-react'
import type {
  DisputeSnapshot,
  ReplayBundle,
  TimelinePoint,
} from '../../types/election'
import { getDisputePairThemes } from '../../utils/candidatePalette'
import {
  formatPct,
  formatPP,
  formatSignedPP,
} from '../../utils/formatters'

interface MarginTimelineChartProps {
  snapshot: DisputeSnapshot
  isReplayMode: boolean
  replayBundle: ReplayBundle | null
  replayFrameIndex: number
  isReplayPlaying: boolean
  replaySpeedMs: number
  onStartReplay: () => void
  onStopReplay: () => void
  onSelectReplayFrame: (idx: number) => void
  onToggleReplayPlay: () => void
  onChangeReplaySpeed: (ms: number) => void
  isCompact?: boolean
  onExpandModal?: () => void
}

export function MarginTimelineChart({
  snapshot,
  isReplayMode,
  replayBundle,
  replayFrameIndex,
  isReplayPlaying,
  replaySpeedMs,
  onStartReplay,
  onStopReplay,
  onSelectReplayFrame,
  onToggleReplayPlay,
  onChangeReplaySpeed,
  isCompact = false,
  onExpandModal,
}: MarginTimelineChartProps) {
  const [cand1, cand2] = snapshot.candidates
  const [theme1, theme2] = getDisputePairThemes(cand1, cand2)
  const [xAxisMode, setXAxisMode] = useState<'pct' | 'time'>('pct')
  const [chartType, setChartType] = useState<'margin' | 'both_candidates'>(
    'both_candidates',
  )
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  // Medição da largura real da área disponível via ResizeObserver
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(360)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) setContainerWidth(Math.round(rect.width))
    }
    update()
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        if (w > 0) setContainerWidth(Math.round(w))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rawPoints: TimelinePoint[] = snapshot.timeline ?? []
  // Inicia o gráfico no primeiro ponto real da apuração (>0% ou com votos apurados)
  const firstRealIdx = rawPoints.findIndex(
    (p) => p.pct_counted > 0 || (p.cand1_pct > 0 && p.cand2_pct > 0),
  )
  const points: TimelinePoint[] =
    firstRealIdx > 0 ? rawPoints.slice(firstRealIdx) : rawPoints

  // Dimensões reais em px (desktop: 360px, mobile: 280px; modal: 460px)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640
  const chartHeight = isCompact ? (isMobile ? 280 : 360) : 460
  const chartWidth = Math.max(260, containerWidth)

  const PAD_LEFT = 48
  const PAD_RIGHT = 62
  const PAD_TOP = 20
  const PAD_BOTTOM = 36

  const plotW = Math.max(80, chartWidth - PAD_LEFT - PAD_RIGHT)
  const plotH = Math.max(80, chartHeight - PAD_TOP - PAD_BOTTOM)

  const activePoint: TimelinePoint | null =
    points.length > 0
      ? (points[hoveredIdx ?? points.length - 1] ?? points[points.length - 1])
      : null

  // Escala horizontal X: por % de urnas apuradas (0..100) ou por índice temporal
  const getX = (pt: TimelinePoint, idx: number): number => {
    if (points.length <= 1) return PAD_LEFT + plotW / 2
    if (xAxisMode === 'pct') {
      return PAD_LEFT + (Math.max(0, Math.min(100, pt.pct_counted)) / 100) * plotW
    }
    return PAD_LEFT + (idx / (points.length - 1)) * plotW
  }

  // Escala vertical Y para o gráfico de Margem: simétrico em torno de zero com linha marcada
  const maxAbsMargin = Math.max(
    3.5,
    ...points.map((p) => Math.abs(p.margin_cand1_minus_cand2_pp)),
  )
  const yBoundMargin = Number((maxAbsMargin * 1.25).toFixed(1))
  const zeroY = PAD_TOP + plotH / 2

  const getYMargin = (marginPP: number): number => {
    const clamped = Math.max(-yBoundMargin, Math.min(yBoundMargin, marginPP))
    return zeroY - (clamped / yBoundMargin) * (plotH / 2)
  }

  // Escala vertical Y para o gráfico de ambos os candidatos:
  // Ajuste automático aos dados com span mínimo de ~6 pontos percentuais para separação nítida
  const validPcts = points
    .flatMap((p) => [p.cand1_pct, p.cand2_pct])
    .filter((v) => v > 0 && Number.isFinite(v))

  const minObserved = validPcts.length > 0 ? Math.min(...validPcts) : 48
  const maxObserved = validPcts.length > 0 ? Math.max(...validPcts) : 52
  const center = (minObserved + maxObserved) / 2
  const observedSpan = maxObserved - minObserved
  const targetSpan = Math.max(6, observedSpan + 2.5)
  const minCandPct = Math.max(0, Number((center - targetSpan / 2).toFixed(1)))
  const maxCandPct = Math.min(100, Number((center + targetSpan / 2).toFixed(1)))
  const spanCandPct = Math.max(2, maxCandPct - minCandPct)

  const getYCandPct = (pct: number): number => {
    return PAD_TOP + (1 - (pct - minCandPct) / spanCandPct) * plotH
  }

  const marginPolyline = points
    .map((pt, idx) => `${getX(pt, idx).toFixed(1)},${getYMargin(pt.margin_cand1_minus_cand2_pp).toFixed(1)}`)
    .join(' ')

  const cand1Polyline = points
    .map((pt, idx) => `${getX(pt, idx).toFixed(1)},${getYCandPct(pt.cand1_pct).toFixed(1)}`)
    .join(' ')
  const cand2Polyline = points
    .map((pt, idx) => `${getX(pt, idx).toFixed(1)},${getYCandPct(pt.cand2_pct).toFixed(1)}`)
    .join(' ')

  const lastPt = points.length > 0 ? points[points.length - 1] : null
  const lastIdx = points.length - 1
  const lastX = lastPt ? getX(lastPt, lastIdx) : 0
  const rawLastY1 = lastPt ? getYCandPct(lastPt.cand1_pct) : 0
  const rawLastY2 = lastPt ? getYCandPct(lastPt.cand2_pct) : 0

  let badgeY1 = rawLastY1
  let badgeY2 = rawLastY2
  const minBadgeGap = 26
  if (Math.abs(badgeY1 - badgeY2) < minBadgeGap) {
    if (badgeY1 <= badgeY2) {
      badgeY1 -= minBadgeGap / 2
      badgeY2 += minBadgeGap / 2
    } else {
      badgeY1 += minBadgeGap / 2
      badgeY2 -= minBadgeGap / 2
    }
  }
  const badgeWidth = 54
  const badgeHeight = 20
  const badgeX =
    lastX + badgeWidth > chartWidth - 4
      ? Math.max(PAD_LEFT + 2, lastX - badgeWidth - 6)
      : lastX + 6

  return (
    <section
      aria-label="Linha do tempo da apuração e Replay 2022"
      data-testid="margin-timeline-section"
      className={
        isCompact
          ? 'rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs dark:border-[#1F1F24] dark:bg-[#0A0A0C]'
          : 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-[#1F1F24] dark:bg-[#0A0A0C]'
      }
    >
      {/* 1. Cabeçalho Limpo: Ícone Azul + Título + Expandir quando compacto */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5 dark:border-[#1F1F24]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
            <LineChart className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            <span
              className="absolute -top-1 -right-1 flex h-2 w-2"
              title="Indicador da Linha do Tempo"
            >
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </div>

          <h2 className="text-sm font-bold text-slate-900 sm:text-base dark:text-white truncate">
            Linha do Tempo
          </h2>

          {/* Ícone ⓘ discreto com Tooltip dinâmico */}
          {!isCompact && (
            <div className="group relative inline-flex items-center shrink-0">
              <button
                type="button"
                className="rounded-full p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none dark:text-slate-500 dark:hover:text-slate-300"
                aria-label="Informações sobre a linha do tempo"
              >
                <Info className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-72 rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs leading-relaxed text-slate-200 shadow-2xl group-hover:block group-focus-within:block">
                <p className="font-medium text-white">Trajetória e Cruzamento</p>
                <p className="mt-1 text-slate-300">
                  Evolução temporal da diferença em pontos percentuais ({cand1.ballot_name} − {cand2.ballot_name}) correlacionada com a porcentagem de urnas apuradas e o horário oficial de divulgação do TSE.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Badges e Botão Expandir */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isReplayMode ? (
            <span
              data-testid="timeline-replay-badge"
              className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-slate-950 whitespace-nowrap"
            >
              <History className="h-2.5 w-2.5" aria-hidden="true" />
              REPLAY
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-[#0F0F12] dark:border dark:border-[#1F1F24] dark:text-slate-300 whitespace-nowrap">
              <Radio className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Ao Vivo
            </span>
          )}

          {isCompact && onExpandModal && (
            <button
              type="button"
              onClick={onExpandModal}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.1] dark:hover:text-white transition"
              title="Expandir gráfico da linha do tempo em modal"
              aria-label="Expandir gráfico da linha do tempo"
            >
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
              <span className="hidden sm:inline">Expandir</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Barra de Controles numa ÚNICA linha, sem quebrar */}
      <div className="mt-2 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar pb-1 text-xs whitespace-nowrap">
        {/* Alternador de Séries: Candidatos vs Margem */}
        <div
          role="group"
          aria-label="Série exibida no gráfico"
          className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.04]"
        >
          <button
            type="button"
            data-testid="timeline-series-both-btn"
            aria-pressed={chartType === 'both_candidates'}
            onClick={() => setChartType('both_candidates')}
            className={`rounded-md px-1.5 py-0.5 text-[10px] sm:text-[10.5px] font-semibold transition ${
              chartType === 'both_candidates'
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Candidatos
          </button>
          <button
            type="button"
            data-testid="timeline-series-margin-btn"
            aria-pressed={chartType === 'margin'}
            onClick={() => setChartType('margin')}
            className={`rounded-md px-1.5 py-0.5 text-[10px] sm:text-[10.5px] font-semibold transition ${
              chartType === 'margin'
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Margem
          </button>
        </div>

        {/* Eixo X: Urnas vs Horário */}
        <div
          role="group"
          aria-label="Eixo horizontal da linha do tempo"
          className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.04]"
        >
          <button
            type="button"
            data-testid="timeline-xaxis-pct-btn"
            aria-pressed={xAxisMode === 'pct'}
            onClick={() => setXAxisMode('pct')}
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] sm:text-[10.5px] font-semibold transition ${
              xAxisMode === 'pct'
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Percent className="h-2 w-2" aria-hidden="true" />
            Urnas
          </button>
          <button
            type="button"
            data-testid="timeline-xaxis-time-btn"
            aria-pressed={xAxisMode === 'time'}
            onClick={() => setXAxisMode('time')}
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] sm:text-[10.5px] font-semibold transition ${
              xAxisMode === 'time'
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Clock className="h-2 w-2" aria-hidden="true" />
            Horário
          </button>
        </div>

        {/* Alternador 2026 vs Replay 22 */}
        <div
          role="group"
          aria-label="Alternar entre Apuração 2026 e Replay Histórico 2022"
          className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.04]"
        >
          <button
            type="button"
            data-testid="timeline-mode-live-btn"
            aria-pressed={!isReplayMode}
            onClick={() => {
              if (isReplayMode) onStopReplay()
            }}
            className={`rounded-md px-1.5 py-0.5 text-[10px] sm:text-[10.5px] font-semibold transition ${
              !isReplayMode
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            2026
          </button>
          <button
            type="button"
            data-testid="timeline-mode-replay-btn"
            aria-pressed={isReplayMode}
            onClick={() => {
              if (!isReplayMode) onStartReplay()
            }}
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] sm:text-[10.5px] font-semibold transition ${
              isReplayMode
                ? 'bg-amber-500 text-slate-950 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <History className="h-2 w-2" aria-hidden="true" />
            Replay 22
          </button>
        </div>
      </div>

      {/* Painel de controle do Replay 2022 integrado */}
      {isReplayMode && replayBundle && (
        <div
          data-testid="timeline-replay-controls"
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50/90 p-3 text-xs text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold">
                {replayBundle.title} — Quadro {replayFrameIndex + 1} de{' '}
                {replayBundle.frames.length}
              </p>
              <p className="text-[11px] opacity-90">
                {replayBundle.disclaimer}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="timeline-replay-play-pause"
                onClick={onToggleReplayPlay}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950"
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
                onClick={() => onSelectReplayFrame(0)}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-950 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                title="Voltar ao início do Replay 2022 (0%)"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                0%
              </button>
              <select
                aria-label="Velocidade do Replay 2022 na linha do tempo"
                value={replaySpeedMs}
                onChange={(e) => onChangeReplaySpeed(Number(e.target.value))}
                className="rounded-lg border border-amber-400 bg-white px-2 py-1 text-xs font-semibold text-slate-900 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value={2500}>Velocidade 1x</option>
                <option value={1200}>Velocidade 2x</option>
                <option value={600}>Velocidade 4x</option>
              </select>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[11px]">17:00 (0%)</span>
            <input
              type="range"
              aria-label="Selecionar instante do Replay 2022"
              min={0}
              max={Math.max(0, replayBundle.frames.length - 1)}
              value={replayFrameIndex}
              onChange={(e) => onSelectReplayFrame(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-amber-600"
            />
            <span className="font-mono text-[11px]">21:30 (100%)</span>
          </div>
        </div>
      )}

      {/* Gráfico SVG ou Estado Inicial (0% apurado) */}
      {points.length === 0 ? (
        <div
          data-testid="timeline-empty-state"
          className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center text-xs text-slate-600 dark:border-[#1F1F24] dark:bg-[#0F0F12] dark:text-slate-400"
        >
          Aguardando os primeiros snapshots com votos válidos apurados para
          traçar a curva da margem ao longo do tempo. Experimente acionar o
          botão <strong>Replay 2022</strong> acima para ver a curva histórica
          completa de 0% a 100%.
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          {/* Resumo em linha compacta única */}
          {activePoint && (
            <div
              data-testid="timeline-active-point-summary"
              className="flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar rounded-lg border border-slate-200/90 bg-slate-50/90 px-2.5 py-1 text-[11px] whitespace-nowrap dark:border-[#1F1F24] dark:bg-[#0F0F12]"
            >
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  TSE: <strong className="font-mono text-slate-900 dark:text-white">{activePoint.timestamp.slice(0, 5)}</strong>
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {formatPct(activePoint.pct_counted)} apurado
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {(() => {
                  const diff = activePoint.margin_cand1_minus_cand2_pp
                  if (diff > 0) {
                    return (
                      <span className={`inline-flex items-center gap-1 font-bold ${theme1.textAccentClass}`}>
                        <span className={`h-2 w-2 rounded-full ${theme1.dotClass}`} />
                        {cand1.ballot_name} +{formatPP(diff)}
                      </span>
                    )
                  }
                  if (diff < 0) {
                    return (
                      <span className={`inline-flex items-center gap-1 font-bold ${theme2.textAccentClass}`}>
                        <span className={`h-2 w-2 rounded-full ${theme2.dotClass}`} />
                        {cand2.ballot_name} +{formatPP(Math.abs(diff))}
                      </span>
                    )
                  }
                  return (
                    <span className="text-slate-500 font-medium">Empate</span>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Área gráfica SVG com dimensões reais e fontes legíveis */}
          <div
            ref={containerRef}
            className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white p-2 dark:border-[#1F1F24] dark:bg-[#0F0F12]"
          >
            <svg
              width="100%"
              height={chartHeight}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              role="img"
              aria-label={`Gráfico da linha do tempo da apuração (${points.length} snapshots registrados)`}
              className="w-full select-none"
            >
              {/* Área sombreada sutil na porção futura ainda não apurada */}
              {xAxisMode === 'pct' && lastPt && lastPt.pct_counted < 100 && (
                <g>
                  <rect
                    x={lastX}
                    y={PAD_TOP}
                    width={Math.max(0, PAD_LEFT + plotW - lastX)}
                    height={plotH}
                    fill="currentColor"
                    className="text-slate-400/[0.05] dark:text-white/[0.03]"
                  />
                  <line
                    x1={lastX}
                    y1={PAD_TOP}
                    x2={lastX}
                    y2={PAD_TOP + plotH}
                    stroke="rgba(148, 163, 184, 0.35)"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                  />
                  {PAD_LEFT + plotW - lastX > 75 && (
                    <text
                      x={lastX + (PAD_LEFT + plotW - lastX) / 2}
                      y={PAD_TOP + 14}
                      textAnchor="middle"
                      className="fill-slate-400 font-mono text-[10px] uppercase tracking-wider dark:fill-slate-500 select-none font-semibold"
                    >
                      A apurar ({formatPct(100 - lastPt.pct_counted)})
                    </text>
                  )}
                </g>
              )}

              {/* Grade Horizontal */}
              {chartType === 'margin' ? (
                <>
                  {[-yBoundMargin, -yBoundMargin / 2, 0, yBoundMargin / 2, yBoundMargin].map(
                    (val) => {
                      const y = getYMargin(val)
                      const isZero = Math.abs(val) < 1e-6
                      return (
                        <g key={val}>
                          <line
                            x1={PAD_LEFT}
                            y1={y}
                            x2={PAD_LEFT + plotW}
                            y2={y}
                            stroke={
                              isZero
                                ? '#64748b'
                                : 'rgba(148, 163, 184, 0.22)'
                            }
                            strokeWidth={isZero ? 1.5 : 1}
                            strokeDasharray={isZero ? '4 3' : undefined}
                          />
                          <text
                            x={PAD_LEFT - 8}
                            y={y}
                            textAnchor="end"
                            dominantBaseline="central"
                            className="fill-slate-500 font-mono text-[11px] font-semibold dark:fill-slate-400"
                          >
                            {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                          </text>
                        </g>
                      )
                    },
                  )}
                </>
              ) : (
                <>
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                    const val = minCandPct + t * spanCandPct
                    const y = getYCandPct(val)
                    return (
                      <g key={t}>
                        <line
                          x1={PAD_LEFT}
                          y1={y}
                          x2={PAD_LEFT + plotW}
                          y2={y}
                          stroke="rgba(148, 163, 184, 0.22)"
                          strokeWidth="1"
                        />
                        <text
                          x={PAD_LEFT - 8}
                          y={y}
                          textAnchor="end"
                          dominantBaseline="central"
                          className="fill-slate-500 font-mono text-[11px] font-semibold dark:fill-slate-400"
                        >
                          {val.toFixed(1)}%
                        </text>
                      </g>
                    )
                  })}
                </>
              )}

              {/* Eixo X: marcas de % de urnas apuradas ou horários */}
              {xAxisMode === 'pct'
                ? [0, 20, 40, 60, 80, 100].map((pctTick) => {
                    const x = PAD_LEFT + (pctTick / 100) * plotW
                    return (
                      <g key={pctTick}>
                        <line
                          x1={x}
                          y1={PAD_TOP}
                          x2={x}
                          y2={PAD_TOP + plotH}
                          stroke="rgba(148, 163, 184, 0.16)"
                          strokeWidth="1"
                        />
                        <text
                          x={x}
                          y={PAD_TOP + plotH + 15}
                          textAnchor="middle"
                          className="fill-slate-500 font-mono text-[11px] font-semibold dark:fill-slate-400"
                        >
                          {pctTick}%
                        </text>
                      </g>
                    )
                  })
                : points.map((pt, idx) => {
                    const step = Math.max(1, Math.floor(points.length / 5))
                    if (idx % step !== 0 && idx !== points.length - 1) {
                      return null
                    }
                    const x = getX(pt, idx)
                    return (
                      <g key={`t-${pt.timestamp}-${idx}`}>
                        <line
                          x1={x}
                          y1={PAD_TOP}
                          x2={x}
                          y2={PAD_TOP + plotH}
                          stroke="rgba(148, 163, 184, 0.16)"
                          strokeWidth="1"
                        />
                        <text
                          x={x}
                          y={PAD_TOP + plotH + 15}
                          textAnchor="middle"
                          className="fill-slate-500 font-mono text-[11px] font-semibold dark:fill-slate-400"
                        >
                          {pt.timestamp.slice(0, 5)}
                        </text>
                      </g>
                    )
                  })}

              {/* Rótulo do eixo X */}
              <text
                x={PAD_LEFT + plotW / 2}
                y={chartHeight - 6}
                textAnchor="middle"
                className="fill-slate-500 font-sans text-[11px] font-semibold dark:fill-slate-400"
              >
                {xAxisMode === 'pct'
                  ? 'Percentual de urnas apuradas (%)'
                  : 'Horário oficial do snapshot (Brasília)'}
              </text>

              {/* Séries de Dados */}
              {chartType === 'margin' ? (
                <>
                  <polyline
                    fill="none"
                    stroke="#475569"
                    strokeWidth="2.5"
                    points={marginPolyline}
                  />
                  {points.map((pt, idx) => {
                    const cx = getX(pt, idx)
                    const cy = getYMargin(pt.margin_cand1_minus_cand2_pp)
                    const isHovered =
                      (hoveredIdx ?? points.length - 1) === idx
                    const dotColor =
                      pt.margin_cand1_minus_cand2_pp > 0
                        ? theme1.hexLight
                        : pt.margin_cand1_minus_cand2_pp < 0
                          ? theme2.hexLight
                          : '#64748b'
                    return (
                      <g
                        key={`pt-${pt.timestamp}-${idx}`}
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onClick={() => setHoveredIdx(idx)}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isHovered ? 6 : 4}
                          fill={dotColor}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                        <title>
                          {`${pt.timestamp} (${formatPct(pt.pct_counted)} apurado): Margem ${formatSignedPP(pt.margin_cand1_minus_cand2_pp)}`}
                        </title>
                      </g>
                    )
                  })}
                </>
              ) : (
                <>
                  {/* Curva Candidato 1 */}
                  <polyline
                    fill="none"
                    stroke={theme1.hexLight}
                    strokeWidth="2.5"
                    points={cand1Polyline}
                  />
                  {/* Curva Candidato 2 */}
                  <polyline
                    fill="none"
                    stroke={theme2.hexLight}
                    strokeWidth="2.5"
                    points={cand2Polyline}
                  />

                  {/* Pontos nítidos em cada snapshot */}
                  {points.map((pt, idx) => {
                    const cx = getX(pt, idx)
                    const cy1 = getYCandPct(pt.cand1_pct)
                    const cy2 = getYCandPct(pt.cand2_pct)
                    const isHovered =
                      (hoveredIdx ?? points.length - 1) === idx
                    return (
                      <g
                        key={`both-${pt.timestamp}-${idx}`}
                        onMouseEnter={() => setHoveredIdx(idx)}
                        onClick={() => setHoveredIdx(idx)}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={cx}
                          cy={cy1}
                          r={isHovered ? 5.5 : 3.5}
                          fill={theme1.hexLight}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={cx}
                          cy={cy2}
                          r={isHovered ? 5.5 : 3.5}
                          fill={theme2.hexLight}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                        <title>
                          {`${pt.timestamp} (${formatPct(pt.pct_counted)} apurado): ${cand1.ballot_name} ${formatPct(pt.cand1_pct)} × ${cand2.ballot_name} ${formatPct(pt.cand2_pct)}`}
                        </title>
                      </g>
                    )
                  })}

                  {/* Rótulos com a porcentagem final no final da linha */}
                  {lastPt && (
                    <g data-testid="timeline-final-pct-badges">
                      <g>
                        <rect
                          x={badgeX}
                          y={badgeY1 - 10}
                          width={badgeWidth}
                          height={badgeHeight}
                          rx={5}
                          fill={theme1.hexLight}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                        <text
                          x={badgeX + badgeWidth / 2}
                          y={badgeY1}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="fill-white font-mono text-[12px] font-black"
                        >
                          {formatPct(lastPt.cand1_pct)}
                        </text>
                      </g>
                      <g>
                        <rect
                          x={badgeX}
                          y={badgeY2 - 10}
                          width={badgeWidth}
                          height={badgeHeight}
                          rx={5}
                          fill={theme2.hexLight}
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                        <text
                          x={badgeX + badgeWidth / 2}
                          y={badgeY2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="fill-white font-mono text-[12px] font-black"
                        >
                          {formatPct(lastPt.cand2_pct)}
                        </text>
                      </g>
                    </g>
                  )}
                </>
              )}
            </svg>
          </div>

          <div className={`flex flex-wrap items-center justify-between gap-2 ${isCompact ? 'text-[10px]' : 'text-[11px]'} text-slate-500 dark:text-slate-400`}>
            {chartType === 'margin' ? (
              <span>
                Acima de 0,00 p.p.:{' '}
                <strong className={theme1.textAccentClass}>
                  {cand1.ballot_name}
                </strong>{' '}
                · Abaixo de 0,00 p.p.:{' '}
                <strong className={theme2.textAccentClass}>
                  {cand2.ballot_name}
                </strong>
              </span>
            ) : (
              <span>
                <strong className={theme1.textAccentClass}>{cand1.ballot_name}</strong> vs.{' '}
                <strong className={theme2.textAccentClass}>{cand2.ballot_name}</strong> (% válidos)
              </span>
            )}
            <span>
              Maior dif.: {formatPP(maxAbsMargin)}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
