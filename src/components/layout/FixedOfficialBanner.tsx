import {
  AlertTriangle,
  CheckCircle2,
  History,
  RefreshCw,
} from 'lucide-react'
import type { DisputeSnapshot } from '../../types/election'
import { CreatorsMenu } from './Creditos'

interface FixedOfficialBannerProps {
  snapshot: DisputeSnapshot | null
  isSimulation?: boolean
  isStale: boolean
  snapshotAgeSeconds: number
  fetchError: string | null
  onRefresh: () => void
  onStopReplay?: () => void
}

export function FixedOfficialBanner({
  snapshot,
  isSimulation = false,
  isStale,
  snapshotAgeSeconds,
  fetchError,
  onRefresh,
  onStopReplay,
}: FixedOfficialBannerProps) {
  // Horário da totalização do TSE; o horário do nosso servidor fica só como reserva.
  const hms =
    snapshot?.tse_totalization_ht || snapshot?.generated_at_hms || '--:--:--'
  const isUnderVerification = snapshot?.validation_status === 'em_verificacao'
  const isReplay = snapshot?.is_replay === true

  return (
    <header
      role="banner"
      aria-label="Aviso oficial de fonte e horário de atualização"
      className="sticky top-0 z-40 w-full border-b border-slate-200 bg-[#050505] text-slate-100 shadow-sm dark:border-[#1F1F24] dark:bg-[#050505]"
    >
      <div className="mx-auto flex h-10 w-full max-w-[1840px] items-center justify-between px-3 sm:px-4 lg:px-6">
        {/* Esquerda: Indicação sutil de status e horário */}
        <div className="flex items-center gap-2">
          {/* Ponto "ao vivo" só fica verde quando os dados estão em dia */}
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {!isStale && !isSimulation && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                isSimulation ? 'bg-amber-500' : isStale ? 'bg-rose-500' : 'bg-emerald-500'
              }`}
            />
          </span>
          <span
            data-testid="fixed-official-banner-text"
            className="text-[11px] font-medium tracking-tight text-slate-300 sm:text-xs"
          >
            {isSimulation ? (
              <strong className="rounded bg-amber-500 px-1.5 py-0.5 text-slate-950">
                SIMULAÇÃO — dados fictícios, não é resultado do TSE
              </strong>
            ) : (
              <>
                <span className="hidden sm:inline">Resultado parcial • </span>
                <span className="text-slate-400">Totalização TSE às</span>{' '}
                <span className="font-mono text-slate-100">{hms}</span>
              </>
            )}
          </span>
        </div>

        {/* Direita: Botão Atualizar + Criadores */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900/90 px-2 py-1 text-[11px] font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-1 focus:ring-slate-400"
            title="Verificar atualização agora"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          <div className="h-3.5 w-px bg-slate-800" aria-hidden="true" />

          {/* Créditos: botão compacto com popover (nomes, X e GitHub) */}
          <CreatorsMenu />
        </div>
      </div>

      {/* Faixa de alerta se houver dados desatualizados (> 3 min), verificação de sanidade ou modo Replay */}
      {isReplay && (
        <div
          role="status"
          className="border-t border-amber-500/30 bg-amber-950/90 px-3 py-1 text-xs text-amber-200"
        >
          <div className="mx-auto flex max-w-[1840px] flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <History className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              <strong>REPLAY HISTÓRICO (2022):</strong>{' '}
              {snapshot?.replay_label ??
                'Reprodução acelerada do 2º turno de 2022 a partir de dados históricos do TSE.'}
            </span>
            {onStopReplay && (
              <button
                type="button"
                onClick={onStopReplay}
                className="rounded bg-amber-400 px-2 py-0.5 text-xs font-semibold text-slate-950 hover:bg-amber-300"
              >
                Voltar para Eleição 2026
              </button>
            )}
          </div>
        </div>
      )}

      {isUnderVerification && (
        <div
          role="alert"
          data-testid="sanity-verification-banner"
          className="border-t border-amber-500/40 bg-amber-900/90 px-3 py-1 text-xs text-amber-100"
        >
          <div className="mx-auto flex max-w-[1840px] items-center gap-2">
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-amber-300"
              aria-hidden="true"
            />
            <span>
              <strong>Atualização em verificação:</strong> O ciclo mais recente
              apresentou inconsistência na validação de sanidade. Exibindo o
              último snapshot íntegro validado às {hms}.
            </span>
          </div>
        </div>
      )}

      {isStale && !isReplay && (
        <div
          role="alert"
          data-testid="stale-data-banner"
          className="border-t border-rose-500/40 bg-rose-950/95 px-3 py-1 text-xs text-rose-100"
        >
          <div className="mx-auto flex max-w-[1840px] items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle
                className="h-3.5 w-3.5 shrink-0 text-rose-300"
                aria-hidden="true"
              />
              <strong>Dados desatualizados:</strong> A última leitura validada
              tem mais de 3 minutos ({Math.floor(snapshotAgeSeconds / 60)} min{' '}
              {snapshotAgeSeconds % 60} s atrás
              {fetchError ? ` — ${fetchError}` : ''}). O aplicativo mantém o
              último snapshot em cache.
            </span>
          </div>
        </div>
      )}

      {!isStale && !isUnderVerification && !isReplay && snapshot && (
        <div className="sr-only" role="status">
          <CheckCircle2 className="h-3 w-3" /> Snapshot validado e atualizado.
        </div>
      )}
    </header>
  )
}
