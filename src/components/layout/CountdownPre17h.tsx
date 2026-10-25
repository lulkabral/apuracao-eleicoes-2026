import { useEffect, useState } from 'react'
import { Clock, History, Play } from 'lucide-react'
import type { SimulationStage } from '../../hooks/useElectionSnapshot'
import { SIMULATION_ENABLED } from '../../utils/flags'

interface CountdownPre17hProps {
  onStartReplay2022: () => void
  onSelectSimulatedStage: (stage: SimulationStage) => void
}

// Domingo, 25/10/2026 às 17:00:00 (Horário de Brasília -03:00)
const TARGET_17H_MS = Date.parse('2026-10-25T17:00:00-03:00')

export function CountdownPre17h({
  onStartReplay2022,
  onSelectSimulatedStage,
}: CountdownPre17hProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const diffSeconds = Math.max(0, Math.floor((TARGET_17H_MS - nowMs) / 1000))
  const days = Math.floor(diffSeconds / 86400)
  const hours = Math.floor((diffSeconds % 86400) / 3600)
  const minutes = Math.floor((diffSeconds % 3600) / 60)
  const seconds = diffSeconds % 60

  return (
    <section
      aria-label="Contagem regressiva para o início da divulgação oficial às 17h"
      data-testid="countdown-pre17h-card"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Votação das 8h às 17h • Divulgação oficial a partir das 17h (Brasília)
          </div>
          <h2 className="text-base font-bold text-slate-900 sm:text-lg dark:text-white">
            Aguardando abertura da totalização do 2º Turno (25/10/2026 às 17h)
          </h2>
          <p className="text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-400">
            Com 0,00% das urnas apuradas no momento, você pode reproduzir o{' '}
            <strong>Replay Histórico de 2022</strong> ou explorar a simulação de
            apuração para testar a Calculadora da Virada e os mapas.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center dark:border-slate-800 dark:bg-slate-800/70">
            <div className="font-mono text-lg font-bold text-slate-900 dark:text-white">
              {String(days).padStart(2, '0')}d : {String(hours).padStart(2, '0')}
              h : {String(minutes).padStart(2, '0')}m :{' '}
              {String(seconds).padStart(2, '0')}s
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Até 25/10 às 17h00
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button
          type="button"
          onClick={onStartReplay2022}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Assistir Replay 2º Turno 2022
        </button>

        {/* Antes chamava 'live' (não fazia nada). Agora usa o estágio 65% e só existe fora de produção. */}
        {SIMULATION_ENABLED && (
          <button
            type="button"
            onClick={() => onSelectSimulatedStage('65pct')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Simular Apuração em 65%
          </button>
        )}
      </div>
    </section>
  )
}
