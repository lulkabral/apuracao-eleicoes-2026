import { useEffect, useRef, useState } from 'react'
import {
  History,
  Sparkles,
  X,
} from 'lucide-react'
import type { DisputeSnapshot, NarratorMessage } from '../../types/election'
import type { CandidateVisualTheme } from '../../utils/candidatePalette'
import { getDisputePairThemes } from '../../utils/candidatePalette'
import {
  formatCompactNumber,
  formatInt,
  formatPct,
  formatPP,
} from '../../utils/formatters'

interface StickyCompactScoreboardProps {
  snapshot: DisputeSnapshot
  isVisible: boolean
  progress?: number
  prefersReducedMotion?: boolean
}

function getShortCandidateName(ballotName: string): string {
  const norm = ballotName.trim().toUpperCase()
  if (norm.includes('LULA') && !norm.includes('CADU')) return 'LULA'
  if (
    norm.includes('FLAVIO') ||
    norm.includes('FLÁVIO') ||
    norm.includes('BOLSONARO')
  ) {
    return 'FLÁVIO'
  }
  if (norm.includes('CADU')) return 'CADU'
  if (norm.includes('ALLYSON')) return 'ALLYSON'
  if (norm.includes('CELINA')) return 'CELINA'
  if (norm.includes('LEANDRO')) return 'LEANDRO'
  if (norm.includes('ALAN')) return 'ALAN RICK'
  if (norm.includes('MAILZA')) return 'MAILZA'
  if (norm.includes('OMAR')) return 'OMAR AZIZ'
  if (norm.includes('MARIA DO CARMO')) return 'M. DO CARMO'
  if (norm.includes('FERRAÇO') || norm.includes('FERRACO')) return 'FERRAÇO'
  if (norm.includes('PAZOLINI')) return 'PAZOLINI'
  if (norm.includes('DORINHA')) return 'DORINHA'
  if (norm.includes('VICENTINHO')) return 'VICENTINHO'

  // Limpa títulos e prefixos
  const clean = ballotName.replace(
    /^(PROFESSOR[A]?|DEPUTAD[OA]|CORONEL|PASTOR[A]?|CAPIT[AÃ]O)\s+/i,
    '',
  )
  const parts = clean.trim().split(/\s+/)
  return parts[0] || ballotName
}

const CATEGORY_MAP: Record<
  NarratorMessage['category'],
  { label: string; pillClass: string }
> = {
  turnaround_math: {
    label: 'Virada',
    pillClass:
      'border-amber-400/50 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/70 dark:text-amber-200',
  },
  pending_hotspots: {
    label: 'Falta contar',
    pillClass:
      'border-emerald-400/50 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/70 dark:text-emerald-200',
  },
  margin_change: {
    label: 'Margem',
    pillClass:
      'border-purple-400/50 bg-purple-500/15 text-purple-800 dark:border-purple-500/40 dark:bg-purple-950/70 dark:text-purple-200',
  },
  progress: {
    label: 'Ritmo',
    pillClass:
      'border-cyan-400/50 bg-cyan-500/15 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-950/70 dark:text-cyan-200',
  },
  official_status: {
    label: 'Status',
    pillClass:
      'border-indigo-400/50 bg-indigo-500/15 text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-950/70 dark:text-indigo-200',
  },
  swing_highlight: {
    label: 'Variação',
    pillClass:
      'border-teal-400/50 bg-teal-500/15 text-teal-800 dark:border-teal-500/40 dark:bg-teal-950/70 dark:text-teal-200',
  },
}

function getCandidateAvatar(cand: DisputeSnapshot['candidates'][number]) {
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
  return { avatarSrc, fallbackSvgSrc }
}

function cleanMessageText(text: string): string {
  return text
    .replace(/\s*\(Estimativa do site, não é resultado oficial\)\.?\s*/gi, '')
    .replace(/\bFLAVIO\b/g, 'FLÁVIO')
    .trim()
}

function formatDisplayName(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

interface CompactDuelingBarProps {
  bar1Width: number
  bar2Width: number
  theme1: CandidateVisualTheme
  theme2: CandidateVisualTheme
  className?: string
}

function CompactDuelingBar({
  bar1Width,
  bar2Width,
  theme1,
  theme2,
  className = '',
}: CompactDuelingBarProps) {
  return (
    <div
      className={`relative flex rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800 ${className}`}
      role="progressbar"
      aria-label="Proporção de votos válidos entre os candidatos"
      aria-valuenow={bar1Width}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full transition-all duration-300 ${theme1.barClass}`}
        style={{ width: `${bar1Width}%`, flexShrink: 0 }}
      />
      <div
        className={`h-full transition-all duration-300 ${theme2.barClass}`}
        style={{ width: `${bar2Width}%`, flexShrink: 0 }}
      />
      {/* Marcador dos 50% */}
      <div
        className="pointer-events-none absolute left-1/2 inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_4px_rgba(255,255,255,0.9)] z-10"
        aria-hidden="true"
      />
    </div>
  )
}

export function StickyCompactScoreboard({
  snapshot,
  isVisible,
  progress,
  prefersReducedMotion = false,
}: StickyCompactScoreboardProps) {
  const [cand1, cand2] = snapshot.candidates
  const [theme1, theme2] = getDisputePairThemes(cand1, cand2)
  const { sections, narrator_messages = [] } = snapshot

  const voteDiff = Math.abs(cand1.votes - cand2.votes)
  const marginPP = Math.abs(cand1.pct_valid - cand2.pct_valid)

  const cand1Short = getShortCandidateName(cand1.ballot_name)
  const cand2Short = getShortCandidateName(cand2.ballot_name)

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

  const avatar1 = getCandidateAvatar(cand1)
  const avatar2 = getCandidateAvatar(cand2)

  // Mensagem mais recente do Lex
  const latestMessage: NarratorMessage | null =
    narrator_messages.length > 0 ? narrator_messages[0] : null
  const categoryInfo = latestMessage
    ? CATEGORY_MAP[latestMessage.category] ?? {
        label: 'Análise',
        pillClass: 'border-slate-300 bg-slate-100 text-slate-700',
      }
    : null

  // Histórico sobreposto
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement | null>(null)

  // Fecha histórico ao clicar fora ou pressionar Escape
  useEffect(() => {
    if (!isHistoryOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setIsHistoryOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsHistoryOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isHistoryOpen])

  // Cálculo do mini anel circular de progresso (raio 14, diâmetro 28-36px)
  const ringRadius = 14
  const ringCircumference = 2 * Math.PI * ringRadius
  const pctCounted = sections.pct_counted
  const strokeDashoffset =
    ringCircumference -
    (Math.min(100, Math.max(0, pctCounted)) / 100) * ringCircumference

  // Transição contínua baseada no scroll (progresso p de 0 a 1)
  const p = progress !== undefined ? progress : isVisible ? 1 : 0
  const innerP = Math.max(0, Math.min(1, (p - 0.4) / 0.6))
  const isPointerActive = p > 0.15

  const containerStyle: React.CSSProperties = prefersReducedMotion
    ? {
        opacity: isVisible || p >= 0.5 ? 1 : 0,
        pointerEvents: isVisible || p >= 0.5 ? 'auto' : 'none',
      }
    : {
        opacity: p,
        transform: `translateY(${(1 - p) * -100}%) scaleY(${0.92 + 0.08 * p})`,
        transformOrigin: 'top center',
        pointerEvents: isPointerActive ? 'auto' : 'none',
        willChange: 'transform, opacity',
      }

  const innerStyle = prefersReducedMotion
    ? {}
    : {
        opacity: innerP,
        transform: `translateY(${(1 - innerP) * -4}px)`,
        willChange: 'transform, opacity',
      }

  const leaderShort = leader ? getShortCandidateName(leader.ballot_name) : ''

  return (
    <aside
      aria-label="Placar fixo resumido e análises do Lex em tempo real"
      data-testid="compact-sticky-scoreboard"
      aria-hidden={!isVisible && p === 0}
      style={containerStyle}
      className="fixed top-10 inset-x-0 z-40 border-b border-slate-200/90 bg-white/95 shadow-md backdrop-blur-md dark:border-[#1F1F24] dark:bg-[#0A0A0C]/95 pt-[env(safe-area-inset-top,0px)]"
    >
      {/* LINHA 1 (e 2 em <1100px): Mini Placar Fixo Informativo */}
      <div
        style={innerStyle}
        className="mx-auto w-full max-w-[1840px] px-3 py-1.5 sm:px-4 sm:py-2 min-[1100px]:py-2.5 lg:px-6"
      >
        {/* LAYOUT TABLET / CELULAR (< 1100px): rigorosamente inalterado */}
        <div className="min-[1100px]:hidden grid grid-cols-2 gap-y-1.5 min-[640px]:gap-y-2">
          {/* BLOCO 1: Duelo */}
          <div className="col-span-2 flex items-center justify-between gap-1.5 min-[640px]:gap-3 min-w-0 w-full">
            {/* Candidato 1 */}
            <div className="flex items-center gap-1.5 min-[640px]:gap-2 shrink-0 min-w-0">
              <img
                src={avatar1.avatarSrc}
                alt={cand1.ballot_name}
                loading="eager"
                onError={(e) => {
                  const target = e.currentTarget
                  if (!target.src.endsWith(avatar1.fallbackSvgSrc)) {
                    target.src = avatar1.fallbackSvgSrc
                  }
                }}
                className={`h-8 w-8 min-[640px]:h-10 min-[640px]:w-10 rounded-full object-cover object-top ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#0A0A0C] shrink-0 ${theme1.avatarRingClass}`}
              />
              {/* Celular (<640px): coluna com % em cima (20-22px) e nome embaixo (11px). Em >=640px: lado a lado */}
              <div className="flex flex-col min-[640px]:flex-row min-[640px]:items-baseline gap-0 min-[640px]:gap-1.5 min-w-0">
                <span
                  className={`order-1 min-[640px]:order-2 font-sans text-[20px] min-[640px]:text-2xl font-black tabular-nums tracking-tight leading-none ${theme1.textAccentClass}`}
                >
                  {formatPct(cand1.pct_valid)}
                </span>
                <span className="order-2 min-[640px]:order-1 font-bold text-[11px] min-[640px]:text-xs text-slate-700 dark:text-slate-200 uppercase tracking-tight whitespace-nowrap mt-0.5 min-[640px]:mt-0">
                  {cand1Short}
                </span>
              </div>
            </div>

            {/* Barra Central de Duelo com Marcador de 50% (sempre visível, flexível) */}
            <CompactDuelingBar
              bar1Width={bar1Width}
              bar2Width={bar2Width}
              theme1={theme1}
              theme2={theme2}
              className="flex-1 min-w-[56px] min-[640px]:min-w-[80px] h-2.5 min-[640px]:h-3 mx-1 sm:mx-2 shrink-1"
            />

            {/* Candidato 2 */}
            <div className="flex items-center gap-1.5 min-[640px]:gap-2 shrink-0 min-w-0 text-right">
              {/* Celular (<640px): coluna com % em cima (20-22px) e nome embaixo (11px). Em >=640px: lado a lado */}
              <div className="flex flex-col items-end min-[640px]:flex-row min-[640px]:items-baseline gap-0 min-[640px]:gap-1.5 min-w-0">
                <span
                  className={`font-sans text-[20px] min-[640px]:text-2xl font-black tabular-nums tracking-tight leading-none ${theme2.textAccentClass}`}
                >
                  {formatPct(cand2.pct_valid)}
                </span>
                <span className="font-bold text-[11px] min-[640px]:text-xs text-slate-700 dark:text-slate-200 uppercase tracking-tight whitespace-nowrap mt-0.5 min-[640px]:mt-0">
                  {cand2Short}
                </span>
              </div>
              <img
                src={avatar2.avatarSrc}
                alt={cand2.ballot_name}
                loading="eager"
                onError={(e) => {
                  const target = e.currentTarget
                  if (!target.src.endsWith(avatar2.fallbackSvgSrc)) {
                    target.src = avatar2.fallbackSvgSrc
                  }
                }}
                className={`h-8 w-8 min-[640px]:h-10 min-[640px]:w-10 rounded-full object-cover object-top ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#0A0A0C] shrink-0 ${theme2.avatarRingClass}`}
              />
            </div>
          </div>

          {/* BLOCO 2: Anel de Progresso + % Apurado */}
          <div className="col-span-1 flex items-center justify-start gap-1.5 min-[640px]:gap-2 min-w-0">
            {/* Anel de Progresso SVG (28px mobile, 36px tablet) */}
            <div className="relative h-7 w-7 min-[640px]:h-9 min-[640px]:w-9 shrink-0">
              <svg viewBox="0 0 36 36" className="h-full w-full select-none" role="img" aria-hidden="true">
                <circle
                  cx="18"
                  cy="18"
                  r={14}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  className="text-slate-200 dark:text-[#1F1F24]"
                />
                <circle
                  cx="18"
                  cy="18"
                  r={14}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={strokeDashoffset}
                  transform="rotate(-90 18 18)"
                  className="transition-all duration-500"
                />
                <text
                  x="18"
                  y="19"
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-sans font-black text-[9px] min-[640px]:text-[10px] fill-slate-900 dark:fill-white tabular-nums"
                >
                  {Math.round(pctCounted)}%
                </text>
              </svg>
            </div>

            <div className="flex flex-col min-w-0">
              <span className="font-sans text-xs min-[640px]:text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums leading-tight whitespace-nowrap">
                {formatPct(pctCounted)} apurado
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 hidden min-[640px]:inline">
                {formatInt(sections.counted_sections)} seções
              </span>
            </div>
          </div>

          {/* BLOCO 3: Pílula da Diferença */}
          <div className="col-span-1 flex items-center justify-end min-w-0">
            <div
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 min-[640px]:px-2.5 min-[640px]:py-1 text-[10.5px] min-[640px]:text-xs font-bold border transition truncate max-w-full ${
                leaderTheme
                  ? `${leaderTheme.badgeClass} ${leaderTheme.borderClass}`
                  : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
              }`}
            >
              {/* Celular (<640px): pílula curta */}
              <span className="min-[640px]:hidden font-sans tabular-nums truncate">
                +{formatPP(marginPP)} {leaderShort}
              </span>

              {/* Tablet / Janela dividida (640 - 1099px): média */}
              <span className="hidden min-[640px]:inline font-sans tabular-nums truncate">
                Diferença {formatCompactNumber(voteDiff)}, +{formatPP(marginPP)} {leaderShort}
              </span>
            </div>
          </div>
        </div>

        {/* LAYOUT DESKTOP LARGO (>= 1100px): Grid de 4 colunas perfeitamente conectadas */}
        <div className="hidden min-[1100px]:grid min-[1100px]:grid-cols-[auto_1fr_auto_auto] items-center gap-x-3.5 xl:gap-x-4 min-w-0 w-full">
          {/* 1. Bloco A: foto + nome + % */}
          <div className="flex items-center gap-2.5 shrink-0 min-w-0">
            <img
              src={avatar1.avatarSrc}
              alt={cand1.ballot_name}
              loading="eager"
              onError={(e) => {
                const target = e.currentTarget
                if (!target.src.endsWith(avatar1.fallbackSvgSrc)) {
                  target.src = avatar1.fallbackSvgSrc
                }
              }}
              className={`h-10 w-10 min-[1280px]:h-11 min-[1280px]:w-11 rounded-full object-cover object-top ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#0A0A0C] shrink-0 ${theme1.avatarRingClass}`}
            />
            <span className="font-bold text-xs min-[1280px]:text-sm text-slate-700 dark:text-slate-200 uppercase tracking-tight whitespace-nowrap">
              {cand1Short}
            </span>
            <span
              className={`font-sans text-2xl min-[1280px]:text-[26px] font-black tabular-nums tracking-tight leading-none whitespace-nowrap ${theme1.textAccentClass}`}
            >
              {formatPct(cand1.pct_valid)}
            </span>
          </div>

          {/* 2. Barra Central: 1fr (ocupa TODO o espaço livre entre Bloco A e Bloco B, min-w 240px) */}
          <CompactDuelingBar
            bar1Width={bar1Width}
            bar2Width={bar2Width}
            theme1={theme1}
            theme2={theme2}
            className="flex-1 min-w-[240px] h-3 shrink-1"
          />

          {/* 3. Bloco B: % + nome + foto */}
          <div className="flex items-center gap-2.5 shrink-0 min-w-0">
            <span
              className={`font-sans text-2xl min-[1280px]:text-[26px] font-black tabular-nums tracking-tight leading-none whitespace-nowrap ${theme2.textAccentClass}`}
            >
              {formatPct(cand2.pct_valid)}
            </span>
            <span className="font-bold text-xs min-[1280px]:text-sm text-slate-700 dark:text-slate-200 uppercase tracking-tight whitespace-nowrap">
              {cand2Short}
            </span>
            <img
              src={avatar2.avatarSrc}
              alt={cand2.ballot_name}
              loading="eager"
              onError={(e) => {
                const target = e.currentTarget
                if (!target.src.endsWith(avatar2.fallbackSvgSrc)) {
                  target.src = avatar2.fallbackSvgSrc
                }
              }}
              className={`h-10 w-10 min-[1280px]:h-11 min-[1280px]:w-11 rounded-full object-cover object-top ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#0A0A0C] shrink-0 ${theme2.avatarRingClass}`}
            />
          </div>

          {/* 4. Bloco da Direita: Divisor vertical sutil + Anel + Apurado + Pílula de Diferença */}
          <div className="flex items-center gap-3 xl:gap-4 shrink-0 min-w-0 justify-end ml-2 pl-6 border-l border-slate-200 dark:border-[#1F1F24]">
            {/* Anel de Progresso SVG */}
            <div className="relative h-9 w-9 min-[1280px]:h-10 min-[1280px]:w-10 shrink-0">
              <svg viewBox="0 0 36 36" className="h-full w-full select-none" role="img" aria-hidden="true">
                <circle
                  cx="18"
                  cy="18"
                  r={14}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  className="text-slate-200 dark:text-[#1F1F24]"
                />
                <circle
                  cx="18"
                  cy="18"
                  r={14}
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={strokeDashoffset}
                  transform="rotate(-90 18 18)"
                  className="transition-all duration-500"
                />
                <text
                  x="18"
                  y="19"
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="font-sans font-black text-[10px] fill-slate-900 dark:fill-white tabular-nums"
                >
                  {Math.round(pctCounted)}%
                </text>
              </svg>
            </div>

            <div className="flex flex-col min-w-0">
              <span className="font-sans text-xs min-[1280px]:text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums leading-tight whitespace-nowrap">
                {formatPct(pctCounted)} apurado
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {formatInt(sections.counted_sections)} seções
              </span>
            </div>

            {/* Pílula de Diferença */}
            <div
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold border transition whitespace-nowrap shrink-0 ${
                leaderTheme
                  ? `${leaderTheme.badgeClass} ${leaderTheme.borderClass}`
                  : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700'
              }`}
              title={`Diferença de ${formatInt(voteDiff)} votos (+${formatPP(marginPP)} para ${leader ? leader.ballot_name : 'líder'})`}
            >
              <span className="font-sans tabular-nums whitespace-nowrap">
                {leader
                  ? `Diferença de ${formatCompactNumber(voteDiff)} votos, +${formatPP(marginPP)} ${formatDisplayName(leaderShort)}`
                  : // "Empate técnico" é termo de pesquisa; aqui há contagem exata (M5)
                    snapshot.votes.valid_votes === 0
                    ? 'Aguardando votos'
                    : 'Empate'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* LINHA 2 (ou 3 no celular): Faixa do Lex (32px no celular, 38px no desktop) */}
      <div
        style={innerStyle}
        aria-hidden="true"
        className="relative border-t border-slate-200/80 bg-slate-50/70 dark:border-[#1F1F24] dark:bg-[#08080A]/90"
      >
        <div className="mx-auto w-full max-w-[1840px] h-8 min-[640px]:h-9 min-[1100px]:h-10 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-1.5 min-[640px]:gap-2 text-[11px] min-[640px]:text-xs">
          <div className="flex items-center gap-1.5 min-[640px]:gap-2 min-w-0 flex-1">
            <div className="relative flex h-4 w-4 min-[640px]:h-5 min-[640px]:w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-tr from-purple-600 to-cyan-500 text-white shadow-2xs">
              <Sparkles className="h-2.5 w-2.5 min-[640px]:h-3 min-[640px]:w-3" strokeWidth={2} aria-hidden="true" />
            </div>

            <span className="font-black text-[10.5px] min-[640px]:text-[11px] text-purple-600 dark:text-purple-400 shrink-0">
              Lex
            </span>

            {categoryInfo && (
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.2 text-[9.5px] min-[640px]:text-[10px] font-bold shrink-0 ${categoryInfo.pillClass}`}
              >
                {categoryInfo.label}
              </span>
            )}

            {latestMessage ? (
              <p className="truncate text-[11px] min-[640px]:text-xs text-slate-700 dark:text-slate-200 font-medium flex-1 min-w-0">
                {cleanMessageText(latestMessage.text)}
              </p>
            ) : (
              <span className="text-slate-400 text-xs italic truncate">
                Acompanhando atualização contínua dos dados...
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 min-[640px]:gap-2 shrink-0">
            <span className="text-slate-400 dark:text-slate-500 text-[10px] min-[640px]:text-[11px] whitespace-nowrap hidden sm:inline font-sans tabular-nums">
              {snapshot.generated_at_hms ? `às ${snapshot.generated_at_hms}` : 'agora'}
            </span>

            <button
              type="button"
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              aria-expanded={isHistoryOpen}
              aria-label="Ver histórico de mensagens do Lex"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 min-[640px]:px-2 text-[10px] min-[640px]:text-[11px] font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white transition whitespace-nowrap shadow-2xs"
            >
              <History className="h-2.5 w-2.5 min-[640px]:h-3 min-[640px]:w-3 text-purple-500" aria-hidden="true" />
              <span className="hidden xs:inline sm:inline">Histórico</span>
            </button>
          </div>
        </div>

        {/* Painel Sobreposto de Histórico (Dropdown / Sheet que NÃO empurra conteúdo) */}
        {isHistoryOpen && (
          <div
            ref={historyRef}
            role="dialog"
            aria-modal="false"
            aria-label="Histórico de análises do Lex"
            className="absolute right-2 sm:right-4 top-full mt-1.5 w-[calc(100vw-24px)] max-w-lg max-h-[75vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-[#1F1F24] dark:bg-[#0D0D10] z-50 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5 dark:border-[#1F1F24]">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                  Histórico de Análises — Lex
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Fechar painel de histórico"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-2.5 divide-y divide-slate-100 dark:divide-white/[0.04]">
              {narrator_messages.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-3 text-center">
                  Nenhuma análise registrada até o momento.
                </p>
              ) : (
                narrator_messages.map((msg, idx) => {
                  const cat = CATEGORY_MAP[msg.category] ?? {
                    label: 'Análise',
                    pillClass: 'border-slate-300 bg-slate-100 text-slate-700',
                  }
                  return (
                    <div key={`${msg.timestamp}-${idx}`} className="pt-2.5 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center rounded-md border px-1.5 py-0.2 text-[10px] font-bold ${cat.pillClass}`}
                        >
                          {cat.label}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {msg.timestamp}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-medium">
                        {cleanMessageText(msg.text)}
                      </p>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
