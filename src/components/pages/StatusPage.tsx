import { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
} from 'lucide-react'
import type {
  DisputeSnapshot,
  ElectionCatalogSnapshot,
  OperationalStatusResponse,
} from '../../types/election'
import { formatInt, formatPct } from '../../utils/formatters'

interface StatusPageProps {
  catalog: ElectionCatalogSnapshot | null
  currentSnapshot: DisputeSnapshot | null
  snapshotAgeSeconds: number
  isStale: boolean
  onRefresh: () => void
  onBack: () => void
}

export function StatusPage({
  catalog,
  currentSnapshot,
  snapshotAgeSeconds,
  isStale,
  onRefresh,
  onBack,
}: StatusPageProps) {
  const [apiStatus, setApiStatus] = useState<OperationalStatusResponse | null>(
    null,
  )
  const [checkingApi, setCheckingApi] = useState<boolean>(true)

  useEffect(() => {
    let active = true
    const fetchStatus = async () => {
      try {
        // status.json é publicado pelo poller a cada ciclo e servido pelo CDN (a /api não é pública).
        const res = await fetch('/snapshots/status.json', { cache: 'no-cache' })
        if (res.ok) {
          const data = (await res.json()) as OperationalStatusResponse
          if (active) {
            setApiStatus(data)
            setCheckingApi(false)
            return
          }
        }
      } catch {
        // Fallback para snapshot estático de status no CDN
      }
      try {
        const fallbackRes = await fetch('/snapshots/status.json', {
          cache: 'no-cache',
        })
        if (fallbackRes.ok) {
          const data = (await fallbackRes.json()) as OperationalStatusResponse
          if (active) setApiStatus(data)
        }
      } catch {
        // Utiliza metadados do catalog.json caso offline
      } finally {
        if (active) setCheckingApi(false)
      }
    }
    void fetchStatus()
    return () => {
      active = false
    }
  }, [])

  const overallHealthy =
    !isStale &&
    currentSnapshot?.validation_status !== 'em_verificacao' &&
    apiStatus?.status !== 'degraded'

  return (
    <section
      aria-labelledby="status-page-heading"
      className="mx-auto max-w-4xl space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="status-page-heading"
              className="text-xl font-bold text-slate-900 dark:text-white"
            >
              Status Operacional do Sistema (`/status`)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Monitoramento de coleta no TSE, idade dos snapshots estáticos e
              validação de sanidade
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Atualizar agora
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Voltar
          </button>
        </div>
      </div>

      {/* Indicador Geral */}
      <div
        className={`flex items-center justify-between rounded-xl border p-4 ${
          overallHealthy
            ? 'border-emerald-300 bg-emerald-50/70 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200'
            : 'border-amber-300 bg-amber-50/70 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200'
        }`}
      >
        <div className="flex items-center gap-3">
          {overallHealthy ? (
            <CheckCircle2
              className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
          )}
          <div>
            <p className="text-sm font-bold">
              {overallHealthy
                ? 'Operação Normal — Snapshots Estáticos Íntegros'
                : 'Atenção Operacional — Verificação ou Atraso Detectado'}
            </p>
            <p className="text-xs opacity-90">
              {overallHealthy
                ? 'Coleta controlada respeitando intervalo de 45–60s com ETag/If-Modified-Since.'
                : 'O aplicativo mantém o último snapshot validado disponível enquanto aguarda nova coleta.'}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-white/80 px-2.5 py-1 font-mono text-xs font-semibold text-slate-800 dark:bg-slate-900/80 dark:text-slate-200">
          Idade: {snapshotAgeSeconds}s
        </span>
      </div>

      {/* Métricas de Coleta e CDN */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Último dado oficial (TSE)
          </div>
          <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-white">
            {currentSnapshot
              ? `${currentSnapshot.tse_file_dg} ${currentSnapshot.tse_file_hg}`
              : '--:--:--'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Snapshot publicado às:{' '}
            {catalog?.generated_at_iso
              ? new Date(catalog.generated_at_iso).toLocaleTimeString('pt-BR')
              : 'N/D'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <Server className="h-3.5 w-3.5" aria-hidden="true" />
            Poller Backend / CDN
          </div>
          <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-white">
            {checkingApi
              ? 'Verificando...'
              : apiStatus
                ? `Ciclo #${formatInt(apiStatus.poll_cycles)}`
                : 'CDN Estático Ativo'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {apiStatus
              ? `HTTP 304 (ETag): ${formatInt(apiStatus.tse_client_stats?.not_modified_304)} · Erros: ${formatInt(apiStatus.consecutive_errors)}`
              : 'Leitura direta de arquivos JSON estáticos pré-validados'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/50">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Validação de Sanidade
          </div>
          <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            {currentSnapshot?.validation_status === 'em_verificacao'
              ? 'Em verificação'
              : 'Aprovado (OK)'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Soma de votos, faixas [0–100%] e monotonicidade verificadas
          </p>
        </div>
      </div>

      {/* Tabela de Disputas Monitoradas */}
      <div>
        <h3 className="mb-2.5 text-sm font-bold text-slate-900 dark:text-white">
          Disputas de 2º Turno Monitoradas ({catalog?.disputes.length ?? 0})
        </h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Disputa</th>
                <th className="px-3 py-2.5 font-semibold">UF</th>
                <th className="px-3 py-2.5 font-semibold">% Apurado</th>
                <th className="px-3 py-2.5 font-semibold">Horário TSE</th>
                <th className="px-3 py-2.5 font-semibold">Sanidade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {(catalog?.disputes ?? []).map((d) => (
                <tr
                  key={d.dispute_id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                >
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                    {d.cargo_name} — {d.uf_name}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">
                    {d.uf}
                  </td>
                  <td className="px-3 py-2 font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {formatPct(d.pct_counted)}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">
                    {d.updated_at_hms}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        d.validation_status === 'ok'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {d.validation_status === 'ok'
                        ? 'Íntegro'
                        : 'Em verificação'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
