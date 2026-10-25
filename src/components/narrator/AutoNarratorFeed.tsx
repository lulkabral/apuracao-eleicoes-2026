import { type ComponentType, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Crosshair,
  GitCompare,
  Info,
  Landmark,
  MapPin,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import type { NarratorMessage } from '../../types/election'
import { formatOfficialCandidateName } from '../../utils/formatters'

interface AutoNarratorFeedProps {
  messages: NarratorMessage[]
  enabled: boolean
  /** Nomes de urna dos DOIS candidatos da disputa exibida (destaque simétrico). */
  highlightNames?: string[]
  snapshotUpdatedAtHms?: string
}

interface CategoryConfig {
  label: string
  shortPill: string
  icon: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>
  pillClass: string
  iconBadgeClass: string
}

const CATEGORY_META: Record<NarratorMessage['category'], CategoryConfig> = {
  turnaround_math: {
    label: 'Matemática da virada',
    shortPill: 'Virada',
    icon: Crosshair,
    pillClass:
      'border-amber-400/50 bg-amber-500/15 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/70 dark:text-amber-200',
    iconBadgeClass:
      'bg-amber-500/15 text-amber-600 border border-amber-500/25 dark:bg-amber-500/20 dark:text-amber-300',
  },
  pending_hotspots: {
    label: 'Onde falta contar',
    shortPill: 'Falta contar',
    icon: MapPin,
    pillClass:
      'border-emerald-400/50 bg-emerald-500/15 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/70 dark:text-emerald-200',
    iconBadgeClass:
      'bg-emerald-500/15 text-emerald-600 border border-emerald-500/25 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
  margin_change: {
    label: 'Evolução da margem',
    shortPill: 'Margem',
    icon: Activity,
    pillClass:
      'border-purple-400/50 bg-purple-500/15 text-purple-900 dark:border-purple-500/40 dark:bg-purple-950/70 dark:text-purple-200',
    iconBadgeClass:
      'bg-purple-500/15 text-purple-600 border border-purple-500/25 dark:bg-purple-500/20 dark:text-purple-300',
  },
  progress: {
    label: 'Progresso da apuração',
    shortPill: 'Ritmo',
    icon: TrendingUp,
    pillClass:
      'border-cyan-400/50 bg-cyan-500/15 text-cyan-900 dark:border-cyan-500/40 dark:bg-cyan-950/70 dark:text-cyan-200',
    iconBadgeClass:
      'bg-cyan-500/15 text-cyan-600 border border-cyan-500/25 dark:bg-cyan-500/20 dark:text-cyan-300',
  },
  official_status: {
    label: 'Status oficial TSE',
    shortPill: 'Status',
    icon: Landmark,
    pillClass:
      'border-indigo-400/50 bg-indigo-500/15 text-indigo-900 dark:border-indigo-500/40 dark:bg-indigo-950/70 dark:text-indigo-200',
    iconBadgeClass:
      'bg-indigo-500/15 text-indigo-600 border border-indigo-500/25 dark:bg-indigo-500/20 dark:text-indigo-300',
  },
  swing_highlight: {
    label: 'Variação 1ºT → 2ºT',
    shortPill: 'Variação',
    icon: GitCompare,
    pillClass:
      'border-teal-400/50 bg-teal-500/15 text-teal-900 dark:border-teal-500/40 dark:bg-teal-950/70 dark:text-teal-200',
    iconBadgeClass:
      'bg-teal-500/15 text-teal-600 border border-teal-500/25 dark:bg-teal-500/20 dark:text-teal-300',
  },
}

/**
 * Remove qualquer menção residual a estimativas entre parênteses
 * e destaca termos-chave (números, porcentagens, pontos percentuais e nomes de candidatos).
 */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderCleanTickerContent(rawText: string, highlightNames: string[]) {
  // Limpa o texto residual entre parênteses e garante a grafia acentuada FLÁVIO
  const sanitized = rawText
    .replace(/\s*\(Estimativa do site, não é resultado oficial\)\.?\s*/gi, '')
    .replace(/\bFLAVIO\b/g, 'FLÁVIO')
    .trim()

  // Antes: lista fixa "Lula|Flávio Bolsonaro|Tarcísio". O TSE grava "FLAVIO BOLSONARO" sem
  // acento, então só um dos dois candidatos ficava em negrito. Agora destaca os dois nomes
  // reais da disputa (inclusive Governadores).
  const nomes = highlightNames.filter(Boolean).map(formatOfficialCandidateName)
  const names = nomes.map(escapeRegExp)
  const namePattern = names.length ? `|${names.join('|')}` : ''
  const splitter = new RegExp(
    `(\\b\\d{1,3}(?:\\.\\d{3})*(?:,\\d+)?%?|\\b[+-]?\\d+(?:,\\d+)?\\s?p\\.p\\.|\\bTSE\\b${namePattern})`,
    'gi',
  )
  const nameSet = new Set(nomes.map((n) => n.toLowerCase()))
  const parts = sanitized.split(splitter)

  return parts.map((part, i) => {
    if (
      /^\d{1,3}(?:\.\d{3})*(?:,\d+)?%?$/i.test(part) ||
      /^[+-]?\d+(?:,\d+)?\s?p\.p\.$/i.test(part) ||
      /^TSE$/i.test(part) ||
      nameSet.has(part.toLowerCase())
    ) {
      return (
        <strong
          key={i}
          className="font-black text-slate-950 dark:text-white"
        >
          {part}
        </strong>
      )
    }
    return part
  })
}

export function AutoNarratorFeed({
  messages,
  enabled,
  highlightNames = [],
  snapshotUpdatedAtHms,
}: AutoNarratorFeedProps) {
  const [selectedCategory, setSelectedCategory] = useState<
    NarratorMessage['category'] | 'all'
  >('all')
  const [pulseActive, setPulseActive] = useState(true)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(14)

  // Dispara pulso visual e reinicia contador de tempo decorrido a cada novo snapshot recebido
  useEffect(() => {
    setPulseActive(true)
    setElapsedSec(3)
    const timer = window.setTimeout(() => setPulseActive(false), 3500)
    return () => window.clearTimeout(timer)
  }, [snapshotUpdatedAtHms, messages.length])

  // Incrementa tempo decorrido a cada segundo
  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSec((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  if (!enabled) {
    return null
  }

  const availableCategories = useMemo(
    () => Array.from(new Set(messages.map((m) => m.category))),
    [messages],
  )

  const filteredMessages =
    selectedCategory === 'all'
      ? messages
      : messages.filter((m) => m.category === selectedCategory)

  const latestMessage = messages[0]
  const latestCategory = latestMessage ? CATEGORY_META[latestMessage.category] : null

  return (
    <section
      aria-label="Lex News — Atualizações analíticas determinísticas em tempo real"
      data-testid="auto-narrator-feed"
      className="relative overflow-hidden rounded-2xl border border-purple-500/40 bg-gradient-to-r from-purple-500/[0.04] via-transparent to-cyan-500/[0.04] p-3 sm:px-4 sm:py-3.5 shadow-[0_0_20px_rgba(168,85,247,0.12)] transition-all duration-300 dark:border-purple-400/30 dark:bg-[#0A0A0C]"
    >
      {/* Linha superior de acento com gradiente roxo/ciano */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-purple-500 via-cyan-400 to-purple-600 opacity-80" />

      {/* 1. Faixa Ticker "AO VIVO": Destaque Visual, Avatar Lex e Tipografia 15-16px */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Avatar e Nome do Lex com Indicador de Pulso */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-purple-600 to-cyan-500 text-white shadow-xs">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-black text-sm text-slate-900 dark:text-white">
                Lex
              </span>
              <span
                data-testid="lex-pulse-indicator"
                className="relative flex h-2 w-2"
                title="Indicador de atividade em tempo real do Lex"
              >
                <span
                  className={`absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75 ${
                    pulseActive ? 'animate-ping' : 'animate-pulse'
                  }`}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
              </span>
            </div>

            {/* Etiqueta colorida por tipo de mensagem */}
            {latestCategory && (
              <span
                className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider shrink-0 ${latestCategory.pillClass}`}
              >
                {latestCategory.shortPill}
              </span>
            )}
          </div>

          {/* Frase analítica com animação de entrada e tempo discreto */}
          {latestMessage ? (
            <div
              key={`${latestMessage.timestamp}-${latestMessage.text.slice(0, 15)}`}
              className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 animate-in fade-in slide-in-from-right-2 duration-300"
            >
              <p className="text-[15px] sm:text-base font-medium text-slate-800 dark:text-slate-200 leading-snug line-clamp-3 sm:line-clamp-2 lg:line-clamp-1">
                {renderCleanTickerContent(latestMessage.text, highlightNames)}
              </p>
              <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500 shrink-0 whitespace-nowrap">
                há {elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}min`}
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Aguardando primeiros boletins...</p>
          )}
        </div>

        {/* Botão para Expandir / Colapsar Histórico */}
        <div className="flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            aria-expanded={isHistoryOpen}
            className="inline-flex items-center gap-1 rounded-lg border border-purple-500/25 bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-900 hover:bg-purple-500/20 dark:border-purple-500/30 dark:bg-purple-950/40 dark:text-purple-200 dark:hover:bg-purple-900/50 transition"
          >
            <span>{isHistoryOpen ? 'Ocultar histórico' : `Ver histórico (${messages.length})`}</span>
            {isHistoryOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* 2. Conteúdo Expandido do Histórico e Filtros */}
      {isHistoryOpen && (
        <div className="mt-3.5 border-t border-slate-200/80 pt-3 dark:border-[#1F1F24]">
          {/* Cabeçalho do Histórico com Tooltip */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Pílulas Analíticas
              </span>
              <div className="group relative inline-flex items-center">
                <button
                  type="button"
                  className="rounded-full p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none dark:text-slate-500 dark:hover:text-slate-300"
                  aria-label="Informações sobre o Lex News"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                </button>
                <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-64 rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-xs leading-relaxed text-slate-200 shadow-2xl group-hover:block group-focus-within:block">
                  <p className="font-medium text-white">Síntese Determinística</p>
                  <p className="mt-1 text-slate-300">
                    Pílulas analíticas em tempo real geradas matematicamente a partir dos dados do TSE, sem uso de modelos generativos no ciclo de apuração.
                  </p>
                </div>
              </div>
            </div>

            {snapshotUpdatedAtHms && (
              <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Atualizado: {snapshotUpdatedAtHms}
              </span>
            )}
          </div>

          {/* Filtros de Categorias */}
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Filtrar pílulas analíticas do Lex News"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === 'all'}
              onClick={() => setSelectedCategory('all')}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition ${
                selectedCategory === 'all'
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-[#1F1F24] dark:bg-[#0F0F12] dark:text-slate-300'
              }`}
            >
              Todas ({messages.length})
            </button>
            {availableCategories.map((cat) => {
              const meta = CATEGORY_META[cat] ?? CATEGORY_META.progress
              const isSelected = selectedCategory === cat
              const IconComp = meta.icon
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedCategory(cat)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    isSelected
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950'
                      : meta.pillClass
                  }`}
                >
                  <IconComp className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                  <span>{meta.shortPill}</span>
                </button>
              )
            })}
          </div>

          {/* Feed com rolagem */}
          <ol
            className="mt-3 max-h-[340px] space-y-2 overflow-y-auto pr-1 scrollbar-thin [scrollbar-width:thin]"
            aria-live="polite"
          >
            {filteredMessages.map((msg, idx) => {
              const meta = CATEGORY_META[msg.category] ?? CATEGORY_META.progress
              const isLatest = idx === 0
              const IconComp = meta.icon

              return (
                <li
                  key={msg.id}
                  data-testid={`narrator-item-${msg.category}`}
                  className={`group rounded-xl border p-2.5 text-xs transition ${
                    isLatest
                      ? 'border-slate-300 bg-slate-50 shadow-2xs dark:border-[#1F1F24] dark:bg-[#0F0F12]'
                      : 'border-slate-200/80 bg-slate-50/50 hover:bg-slate-50 dark:border-[#1F1F24] dark:bg-[#0F0F12]/60 dark:hover:bg-[#0F0F12]'
                  } text-slate-800 dark:text-slate-200`}
                >
                  <div className="mb-1 flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${meta.iconBadgeClass}`}
                        aria-hidden="true"
                      >
                        <IconComp className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-black uppercase tracking-wider ${meta.pillClass}`}
                      >
                        {meta.shortPill}
                      </span>
                      {isLatest && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Agora
                        </span>
                      )}
                    </div>

                    <time className="font-mono text-[10px] text-slate-500">
                      {msg.timestamp}
                    </time>
                  </div>

                  <p className="text-xs font-medium leading-relaxed text-slate-700 dark:text-slate-300">
                    {renderCleanTickerContent(msg.text, highlightNames)}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
